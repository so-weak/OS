import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  ShaderMaterial,
  Vector3,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type RectAreaLight,
  type SpotLight,
} from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import { useWorld } from '../world'
import Clickable from './Clickable'
import { live } from './live'
import { useRoom } from './roomState'
import {
  BLIND_SLATS,
  makeDayWindow,
  makeGobo,
  makeNightWindow,
  makeRainStreaks,
} from './windowArt'
import { rb } from './rbox'

/* =====================================================================
   The window — the room's one scenery control and the explanation for
   most of its light. Night by default; clicking it lets the sun in
   (roomState.toggleDay, which also records the visitor's override in
   the world store). Everything here fades with `live.day`, damped once
   per frame in WorldFrame so the whole room moves as one.

   Every hand that wants to touch the light coming through the glass
   works in THIS file:
   - dusk      the sun goes orange, drops and stretches shadows (S-P1)
   - spill     a RectAreaLight the size of the glass, not a point (R-P9)
   - shaft     a day-only volumetric cone that dies before the rug (R-P5)
   - weather   rain greys the sky and streaks the glass; lightning is
               a white sky plane + a burst on the sun spot (S-P2)
   - blinds    18 slats on a cord, and a gobo on the sun that throws
               their stripes across the desk (S-P3)
   - the moon  its real phase, painted in windowArt.ts (S-P7)
   ===================================================================== */

/* rect area lights need the LTC tables in the uniform library — once,
   before the first lit shader compiles */
RectAreaLightUniformsLib.init()

/* ---------- palette ---------- */
const WHITE = new Color('#ffffff')
const NIGHT_TINT = new Color('#b9c4de')
const NIGHT_RAIN_TINT = new Color('#6b7180')
const DAY_RAIN_TINT = new Color('#8b9099')
const MOON_SPILL = new Color('#7b93c9')
const SUN_SPILL = new Color('#ffdfae')
const DUSK_SPILL = new Color('#ff9a4a')
const FLASH_TINT = new Color('#dfe6ff')

/* the sun leans down-right across the rug; at golden hour it drops
   lower and further, so the desk's shadows stretch across the floor */
const SUN_TARGET_NOON = new Vector3(0.9, -1.35, 1.45)
const SUN_TARGET_DUSK = new Vector3(1.4, -1.1, 1.9)
const SUN_POS = new Vector3(0.05, 0.15, 0.03)

/* ---------- blinds ---------- */
const BLIND_MAX = 1.3 // rad, fully drawn
const SLAT_TOP = 0.385
const SLAT_STEP = 0.773 / (BLIND_SLATS - 1)
const SLAT_Z = 0.046

/* ---------- the sun shaft's cone (own shader: no depth pass, no second
   light — drei's <SpotLight volumetric> would add one) ---------- */
function makeShaftMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      opacity: { value: 0 },
      lightColor: { value: new Color(SUN_SPILL) },
      spotPosition: { value: new Vector3() },
      attenuation: { value: 3.0 },
      anglePower: { value: 1.5 },
    },
    vertexShader: /* glsl */ `
      uniform vec3 spotPosition;
      uniform float attenuation;
      varying vec3 vNormal;
      varying float vIntensity;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vIntensity = 1.0 - clamp(distance(worldPosition.xyz, spotPosition) / attenuation, 0.0, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 lightColor;
      uniform float anglePower;
      uniform float opacity;
      varying vec3 vNormal;
      varying float vIntensity;
      void main() {
        vec3 n = vec3(vNormal.x, vNormal.y, abs(vNormal.z));
        float angle = pow(max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0), anglePower);
        gl_FragColor = vec4(lightColor, vIntensity * angle * opacity);
      }
    `,
    transparent: true,
    depthWrite: false,
  })
}

function makeShaftGeometry(distance: number): CylinderGeometry {
  // apex at the origin, opening along +z so mesh.lookAt(target) aims it
  const g = new CylinderGeometry(0.05, 1.1, distance, 48, 6, true)
  g.applyMatrix4(new Matrix4().makeTranslation(0, -distance / 2, 0))
  g.applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2))
  return g
}

const SHAFT_DISTANCE = 2.4

/* ---------- the window ---------- */
export default function RoomWindow() {
  const view = useSystem((s) => s.view)
  const isDay = useRoom((s) => s.isDay)
  const toggleDay = useRoom((s) => s.toggleDay)
  // the day picture is repainted at most once an hour
  const hourBucket = useWorld((s) => Math.floor(s.hour))
  const blinds = useWorld((s) => s.blinds)

  const nightTex = useMemo(() => makeNightWindow(), [])
  const rainTex = useMemo(() => makeRainStreaks(), [])
  const gobo = useMemo(() => makeGobo(), [])
  const dayTex = useMemo(() => makeDayWindow(hourBucket + 0.5), [hourBucket])
  useEffect(
    () => () => {
      nightTex.dispose()
      rainTex.dispose()
      gobo.texture.dispose()
    },
    [nightTex, rainTex, gobo],
  )
  useEffect(() => () => dayTex.dispose(), [dayTex])

  const nightMat = useRef<MeshBasicMaterial>(null!)
  const dayMat = useRef<MeshBasicMaterial>(null!)
  const rainMat = useRef<MeshBasicMaterial>(null!)
  const rainMesh = useRef<Mesh>(null!)
  const spill = useRef<RectAreaLight>(null!)
  const sun = useRef<SpotLight>(null!)
  const shaft = useRef<Mesh>(null!)
  const slats = useRef<InstancedMesh>(null!)
  const cord = useRef<Group>(null!)
  const target = useRef<Object3D>(null!)

  const sunTarget = useMemo(() => {
    const o = new Object3D()
    o.position.copy(SUN_TARGET_NOON)
    return o
  }, [])
  const shaftMat = useMemo(() => makeShaftMaterial(), [])
  const shaftGeo = useMemo(() => makeShaftGeometry(SHAFT_DISTANCE), [])
  const slatGeo = useMemo(() => new BoxGeometry(0.6, 0.004, 0.05), [])
  const slatMat = useMemo(
    () => new MeshStandardMaterial({ color: '#cbc3b0', roughness: 0.75 }),
    [],
  )
  useEffect(
    () => () => {
      shaftMat.dispose()
      shaftGeo.dispose()
      slatGeo.dispose()
      slatMat.dispose()
    },
    [shaftMat, shaftGeo, slatGeo, slatMat],
  )

  // per-frame scratch (no allocation in the loop)
  const scratchRef = useRef({
    color: new Color(),
    v: new Vector3(),
    dummy: new Object3D(),
    pitch: -1, // forces the first layout pass
    tug: 0, // cord pull animation
  })

  /* lay the slats out for a given pitch and repaint the gobo to match */
  const layoutSlats = (pitch: number) => {
    const d = scratchRef.current.dummy
    for (let i = 0; i < BLIND_SLATS; i++) {
      d.position.set(0, SLAT_TOP - i * SLAT_STEP, SLAT_Z)
      d.rotation.set(pitch, 0, 0)
      d.updateMatrix()
      slats.current.setMatrixAt(i, d.matrix)
    }
    slats.current.instanceMatrix.needsUpdate = true
    gobo.paint(pitch / BLIND_MAX)
  }

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const scratch = scratchRef.current
    const day = live.day
    const dusk = live.dusk * day
    const rain = live.rain
    const flash = live.flash

    /* blinds: damped pitch, laid out only while it moves */
    const wantPitch = useWorld.getState().blinds ? BLIND_MAX : 0
    const pitch =
      scratch.pitch < 0 ? wantPitch : MathUtils.damp(scratch.pitch, wantPitch, 5, dt)
    if (Math.abs(pitch - scratch.pitch) > 1e-4) {
      scratch.pitch = pitch
      layoutSlats(pitch)
    }
    const closed = pitch / BLIND_MAX

    /* the cord tugs when pulled, then settles */
    if (scratch.tug > 0.001 || cord.current.position.y !== 0) {
      scratch.tug = MathUtils.damp(scratch.tug, 0, 6, dt)
      cord.current.position.y = -0.035 * scratch.tug
    }

    /* sky planes: rain greys them, lightning whites them */
    dayMat.current.opacity = day
    nightMat.current.color
      .copy(NIGHT_TINT)
      .lerp(NIGHT_RAIN_TINT, rain * 0.85)
      .lerp(WHITE, flash * 0.8)
    dayMat.current.color
      .copy(WHITE)
      .lerp(DAY_RAIN_TINT, rain * 0.85)
      .lerp(WHITE, flash * 0.8)

    /* rain on the glass: one plane, scrolling texture */
    const raining = rain > 0.01
    rainMesh.current.visible = raining
    if (raining) {
      rainMat.current.opacity = rain * 0.55
      const streaks = rainMat.current.map
      // increasing offset.y scrolls the texture toward -V on the plane —
      // i.e. down the glass, the direction rain actually falls (the old
      // "- dt" made drops climb the window instead)
      if (streaks) streaks.offset.y = (streaks.offset.y + dt * 0.75) % 1
    }

    /* the spill: moonlight → sunlight → dusk orange; blinds and rain dim
       it; lightning lifts it a little (the sky-wide part of a strike) */
    spill.current.color
      .copy(MOON_SPILL)
      .lerp(SUN_SPILL, day)
      .lerp(DUSK_SPILL, dusk * 0.7)
      .lerp(FLASH_TINT, flash)
    spill.current.intensity =
      MathUtils.lerp(0.8, 6, day) * (1 - 0.35 * rain) * (1 - 0.8 * closed) +
      flash * 2.5 * (1 - 0.7 * closed)

    /* the sun spot: warmer, weaker and lower at golden hour; it doubles
       as the strobe, capped at +10 (28 clips the desk to paper white) */
    const sunColor = scratch.color
      .copy(SUN_SPILL)
      .lerp(DUSK_SPILL, dusk)
      .lerp(FLASH_TINT, flash)
    sun.current.color.copy(sunColor)
    sun.current.intensity =
      day * MathUtils.lerp(3.4, 2.4, dusk) * (1 - 0.6 * rain) +
      flash * 10 * (1 - 0.7 * closed)
    target.current.position.copy(SUN_TARGET_NOON).lerp(SUN_TARGET_DUSK, dusk)

    /* freeze the sun's shadow pass while nothing lights it — never touch
       castShadow (that recompiles every lit material) */
    const lit = day >= 0.01 || flash > 0
    if (lit !== sun.current.shadow.autoUpdate) {
      sun.current.shadow.autoUpdate = lit
      if (lit) sun.current.shadow.needsUpdate = true
    }

    /* the shaft: day only, dies in the air before the rug */
    const showShaft = day > 0.02
    shaft.current.visible = showShaft
    if (showShaft) {
      const u = (shaft.current.material as ShaderMaterial).uniforms
      u.opacity.value = 1.0 * day * (1 - 0.6 * rain) * (1 - 0.85 * closed)
      ;(u.lightColor.value as Color).copy(sunColor)
      shaft.current.getWorldPosition(u.spotPosition.value as Vector3)
      shaft.current.lookAt(target.current.getWorldPosition(scratch.v))
    }
  })

  const x = -1.18
  const y = 1.52
  return (
    <group position={[x, y, -1.07]}>
      <Clickable
        enabled={view === 'room'}
        label={isDay ? 'bring back the night' : 'let the sun in'}
        onActivate={() => {
          playClick()
          toggleDay()
        }}
      >
        {/* frame */}
        <mesh castShadow>
          <roundedBoxGeometry args={rb(0.72, 0.92, 0.045)} />
          <meshStandardMaterial color="#1c1e22" roughness={0.8} />
        </mesh>
        {/* night sky (unlit so it reads as light) */}
        <mesh position={[0, 0, 0.024]}>
          <planeGeometry args={[0.62, 0.82]} />
          <meshBasicMaterial
            ref={nightMat}
            map={nightTex}
            color="#b9c4de"
            toneMapped={false}
          />
        </mesh>
        {/* day sky cross-fades on top of it */}
        <mesh position={[0, 0, 0.0255]}>
          <planeGeometry args={[0.62, 0.82]} />
          <meshBasicMaterial
            ref={dayMat}
            map={dayTex}
            transparent
            opacity={0}
            toneMapped={false}
          />
        </mesh>
        {/* rain running down the glass */}
        <mesh ref={rainMesh} position={[0, 0, 0.027]} visible={false}>
          <planeGeometry args={[0.62, 0.82]} />
          <meshBasicMaterial
            ref={rainMat}
            map={rainTex}
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        {/* cross mullions */}
        <mesh position={[0, 0, 0.03]}>
          <roundedBoxGeometry args={rb(0.62, 0.024, 0.012)} />
          <meshStandardMaterial color="#1c1e22" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0, 0.03]}>
          <roundedBoxGeometry args={rb(0.024, 0.82, 0.012)} />
          <meshStandardMaterial color="#1c1e22" roughness={0.8} />
        </mesh>
        {/* sill */}
        <mesh position={[0, -0.48, 0.05]} castShadow>
          <roundedBoxGeometry args={rb(0.78, 0.03, 0.09)} />
          <meshStandardMaterial color="#26282e" roughness={0.85} />
        </mesh>
      </Clickable>

      {/* venetian blind: headrail, two ladder tapes, eighteen slats */}
      <mesh position={[0, 0.425, SLAT_Z]}>
        <roundedBoxGeometry args={rb(0.66, 0.036, 0.05)} />
        <meshStandardMaterial color="#cfc8b7" roughness={0.7} />
      </mesh>
      {[-0.19, 0.19].map((tx) => (
        <mesh key={tx} position={[tx, 0.0, SLAT_Z + 0.026]}>
          <roundedBoxGeometry args={rb(0.004, 0.8, 0.002)} />
          <meshStandardMaterial color="#bdb5a3" roughness={0.9} />
        </mesh>
      ))}
      <instancedMesh
        ref={slats}
        args={[slatGeo, slatMat, BLIND_SLATS]}
        frustumCulled={false}
      />

      {/* the pull cord on the right jamb */}
      <Clickable
        enabled={view === 'room'}
        label={blinds ? 'raise the blinds' : 'draw the blinds'}
        onActivate={() => {
          playClick()
          const world = useWorld.getState()
          world.setBlinds(!world.blinds)
          world.mark('blinds')
          scratchRef.current.tug = 1
        }}
      >
        <group ref={cord} position={[0.345, 0, 0.055]}>
          <mesh position={[0, 0.09, 0]}>
            <cylinderGeometry args={[0.0022, 0.0022, 0.67, 6]} />
            <meshStandardMaterial color="#e6dfcf" roughness={0.9} />
          </mesh>
          {/* the tassel */}
          <mesh position={[0, -0.26, 0]}>
            <cylinderGeometry args={[0.004, 0.0065, 0.034, 8]} />
            <meshStandardMaterial color="#b8a684" roughness={0.8} />
          </mesh>
          {/* invisible hit pad — the cord is a thread from room distance */}
          <mesh position={[0, 0.07, 0]}>
            <roundedBoxGeometry args={rb(0.04, 0.74, 0.024)} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      </Clickable>

      {/* moonlight / sunlight spilling in: a light the size of the glass,
          facing into the room (lights emit down their local -z) */}
      <rectAreaLight
        ref={spill}
        args={['#7b93c9', 0.8, 0.62, 0.82]}
        position={[0, 0, 0.03]}
        rotation-y={Math.PI}
      />

      {/* the sun: a shadow-casting spot, with the blind gobo attached at
          mount (white until the blinds close) */}
      <primitive object={sunTarget} ref={target} />
      <spotLight
        ref={sun}
        position={SUN_POS}
        target={sunTarget}
        color={SUN_SPILL}
        intensity={0}
        angle={0.62}
        penumbra={0.7}
        distance={6.5}
        decay={1.1}
        map={gobo.texture}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-near={0.05}
      />
      {/* the shaft the dust motes drift through */}
      <mesh
        ref={shaft}
        position={SUN_POS}
        geometry={shaftGeo}
        material={shaftMat}
        visible={false}
        raycast={() => null}
        frustumCulled={false}
      />
    </group>
  )
}
