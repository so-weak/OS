import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  PointsMaterial,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Group,
  type Mesh,
  type RectAreaLight,
  type SpotLight,
  type Texture,
} from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import { useWorld } from '../world'
import Clickable from './Clickable'
import { WINDOW } from './layout'
import { live } from './live'
import { useRoom } from './roomState'
import { makeSoftCircle } from './textures'
import { brushedMetalMaps } from './tex/noise'
import {
  buildBlindRails,
  buildBlindTapes,
  buildBlindWand,
  buildCordPull,
  buildSlat,
  buildWindowFrame,
  glassTexture,
  teakMaps,
} from './tex/window'
import {
  BLIND_SLATS,
  LAYER,
  beaconPositions,
  makeDayCity,
  makeBoltAtlas,
  makeDayHigh,
  makeDaySky,
  makeFlashTexture,
  makeGobo,
  makeNightScene,
  makeRainBeads,
  makeRainStreaks,
  moonFrame,
  patchToWorld,
  placeLayer,
  trafficPath,
  type Placement,
  starField,
  sunFrame,
  sunPatch,
} from './windowArt'

/* =====================================================================
   The window — the room's one scenery control and the explanation for
   most of its light. Night by default; clicking it lets the sun in
   (roomState.toggleDay, which also records the visitor's override in
   the world store). Everything here fades with `live.day`, damped once
   per frame in WorldFrame so the whole room moves as one.

   It is an OPENING now, not a picture (BackWall.tsx cuts the hole):
   - the unit      a moulded teak casing on the wall, a stool and apron,
                   a fixed frame in the reveal, two casement sashes with
                   bevelled glazing bars, a brass fastener, weather-strip
                   (all swept profiles: see tex/window.ts)
   - the glass     one faint pane that keeps dust and reflections, and
                   the rain that runs on its outer face
   - the outside   painted layers hung at real depths behind the hole
                   (windowArt.ts), so the sky slides against the frame
                   when the camera moves — night AND day sets
   - the light     RectAreaLight spill, the sun spot with its blind gobo
                   attached AT MOUNT, and a day-only shaft (R-P9/R-P5)
   - weather       rain greys the layers and beads the glass; lightning
                   washes the sky behind the skylines and forks a bolt
                   across it (S-P2)
   - life          red aircraft lights breathing on the towers, a few cars'
                   lamps sliding along the road, stars thinned by rain
   - blinds        18 slats on a cord, a gobo on the sun that throws
                   their stripes across the desk (S-P3)
   - the moon      its real phase, painted in windowArt.ts (S-P7)

   Draw order: the outside layers use NEGATIVE renderOrder so they draw
   before every other transparent thing in the room (dust, halos, the
   moth) and can never paint over them; they only ever show through the
   hole because the wall is opaque and writes depth first.
   ===================================================================== */

/* rect area lights need the LTC tables in the uniform library — once,
   before the first lit shader compiles */
RectAreaLightUniformsLib.init()

/* ---------- palette ---------- */
const WHITE = new Color('#ffffff')
const MOON_SPILL = new Color('#7b93c9')
const SUN_SPILL = new Color('#ffdfae')
const DUSK_SPILL = new Color('#ff9a4a')
const FLASH_TINT = new Color('#dfe6ff')
/* what the pane's dust and sheen are multiplied by (they are unlit) */
const NIGHT_DUST = new Color('#93a3cc')
const DAY_DUST = new Color('#f2f6ff')

/* how each layer greys in rain (multiplied into the texture) */
const RAIN_SKY = new Color('#7d8296')
const RAIN_CLOUD = new Color('#8b8fa6')
const RAIN_CITY = new Color('#6f7690')
const DAY_RAIN_SKY = new Color('#8c95a3')
const DAY_RAIN_CLOUD = new Color('#98a0ac')
const DAY_RAIN_CITY = new Color('#8993a2')
/* golden-hour multiply per day layer: the farther, the more it warms */
const GOLD_FAR = new Color('#ffcfa6')
const GOLD_MID = new Color('#f2b48d')
const GOLD_NEAR = new Color('#dd9e7d')
const GOLD_SUN = new Color('#ffb072')

/* the sun leans down-right across the rug; at golden hour it drops
   lower and further, so the desk's shadows stretch across the floor */
const SUN_TARGET_NOON = new Vector3(0.9, -1.35, 1.45)
const SUN_TARGET_DUSK = new Vector3(1.4, -1.1, 1.9)
/* in the window's local space (origin: centre of the opening on the wall) */
const SUN_POS = new Vector3(0.05, 0.15, 0.04)

/* ---------- blinds (window-local) ---------- */
const BLIND_MAX = 1.3 // rad, fully drawn
const SLAT_TOP = 0.385
const SLAT_STEP = 0.773 / (BLIND_SLATS - 1)
const SLAT_Z = -0.035
const CORD_X = 0.318
const CORD_LEN = 0.722
const WAND_X = -0.318

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

/* =====================================================================
   The outside: painted layers behind the hole
   ===================================================================== */

type LayerMat = MeshBasicMaterial | PointsMaterial

const PLACE = {
  sky: placeLayer(LAYER.sky.z, LAYER.sky.f),
  flash: placeLayer(LAYER.clouds.z + 0.04, LAYER.sky.f),
  moon: placeLayer(LAYER.moon.z, moonFrame()),
  clouds: placeLayer(LAYER.clouds.z, LAYER.clouds.f),
  cloudsNear: placeLayer(LAYER.cloudsNear.z, LAYER.cloudsNear.f),
  far: placeLayer(LAYER.far.z, LAYER.far.f),
  mid: placeLayer(LAYER.mid.z, LAYER.mid.f),
  bokeh: placeLayer(LAYER.bokeh.z, LAYER.bokeh.f),
  near: placeLayer(LAYER.near.z, LAYER.near.f),
}

/* render order: night stack, the flash wash, then the day stack on top
   (the day sky fades in OVER the night stack, so the night needs no
   fade of its own) */
const RO = {
  nSky: -30,
  nStars: -29,
  nMoon: -28,
  nClouds: -27,
  flash: -26,
  nFar: -25,
  nBeacon: -24,
  nMid: -23,
  nBokeh: -22,
  nNear: -21,
  dSky: -20,
  dSun: -19,
  dClouds: -18,
  dCloudsNear: -17,
  dFar: -16,
  dMid: -15,
  dNear: -14,
}

function put(m: LayerMat, c: Color, opacity: number, visible = true): void {
  m.color.copy(c)
  m.opacity = opacity
  m.visible = visible && opacity > 0.004
}

type LayerKind =
  | 'nSky'
  | 'nMoon'
  | 'nClouds'
  | 'flash'
  | 'nFar'
  | 'nMid'
  | 'nBokeh'
  | 'nNear'
  | 'dSky'
  | 'dSun'
  | 'dClouds'
  | 'dCloudsNear'
  | 'dFar'
  | 'dMid'
  | 'dNear'

/** What weather, daylight and lightning do to each layer, every frame. */
function shade(kind: LayerKind, m: LayerMat, c: Color, warm: number): void {
  const dayV = live.day
  const rain = live.rain
  const flash = live.flash
  const dusk = live.dusk * dayV
  const nightOn = dayV < 0.995
  const dayOn = dayV > 0.004
  const gold = (g: Color) =>
    c.copy(WHITE).lerp(g, dusk).lerp(DAY_RAIN_CITY, rain * 0.7).lerp(WHITE, flash * 0.6)
  switch (kind) {
    /* ---- night stack ---- */
    case 'nSky':
      put(m, c.copy(WHITE).lerp(RAIN_SKY, rain * 0.75).lerp(FLASH_TINT, flash * 0.3), 1, nightOn)
      break
    case 'nMoon':
      put(m, c.copy(WHITE).lerp(FLASH_TINT, flash * 0.5), 1 - rain * 0.92, nightOn)
      break
    case 'nClouds':
      put(m, c.copy(WHITE).lerp(RAIN_CLOUD, rain * 0.8), 0.8 + 0.2 * rain, nightOn)
      break
    case 'flash':
      // lightning: a wash of the sky, drawn behind the skylines
      put(m, WHITE, Math.min(1, flash * 0.95), flash > 0.005)
      break
    case 'nFar':
      put(m, c.copy(WHITE).lerp(RAIN_CITY, rain * 0.75).multiplyScalar(1 + flash * 0.6), 1 - rain * 0.35, nightOn)
      break
    case 'nMid':
      put(m, c.copy(WHITE).lerp(RAIN_CITY, rain * 0.75).multiplyScalar(1 + flash * 0.6), 1 - rain * 0.12, nightOn)
      break
    case 'nNear':
      put(m, c.copy(WHITE).lerp(RAIN_CITY, rain * 0.75).multiplyScalar(1 + flash * 0.6), 1, nightOn)
      break
    case 'nBokeh':
      put(m, c.copy(WHITE).multiplyScalar(1 + rain * 0.6 + flash * 0.4), 1, nightOn)
      break
    /* ---- day stack (fades in over the night) ---- */
    case 'dSky':
      put(m, c.copy(WHITE).lerp(DAY_RAIN_SKY, rain * 0.85).lerp(WHITE, flash * 0.7), dayV, dayOn)
      break
    case 'dSun':
      put(m, c.copy(WHITE).lerp(GOLD_SUN, Math.max(dusk, warm * dayV)), dayV * (1 - rain * 0.96), dayOn)
      break
    case 'dClouds':
      put(m, c.copy(WHITE).lerp(DAY_RAIN_CLOUD, rain * 0.8), dayV * (0.5 + 0.5 * rain), dayOn)
      break
    case 'dCloudsNear':
      put(
        m,
        c.copy(WHITE).lerp(GOLD_MID, dusk * 0.6).lerp(DAY_RAIN_CLOUD, rain * 0.85),
        dayV * (0.72 + 0.28 * rain),
        dayOn,
      )
      break
    case 'dFar':
      put(m, gold(GOLD_FAR), dayV * (1 - rain * 0.25), dayOn)
      break
    case 'dMid':
      put(m, gold(GOLD_MID), dayV, dayOn)
      break
    case 'dNear':
      put(m, gold(GOLD_NEAR), dayV, dayOn)
      break
  }
}

interface LayerProps {
  kind: LayerKind
  map: Texture
  place: Placement
  order: number
  unit: PlaneGeometry
  /** night sky only: drawn opaque, the floor of the whole stack */
  opaque?: boolean
  additive?: boolean
  /** the sun's golden-hour weight (day sun only) */
  warm?: number
  /** nudge the plane's depth a hair (keeps two skies off the same plane) */
  dz?: number
}

/** One painted layer: a unit plane scaled to its placement, shaded every
    frame by `shade`. */
function Layer({ kind, map, place, order, unit, opaque, additive, warm = 0, dz = 0 }: LayerProps) {
  const mat = useRef<MeshBasicMaterial>(null!)
  const c = useMemo(() => new Color(), [])
  useFrame(() => shade(kind, mat.current, c, warm))
  return (
    <mesh
      geometry={unit}
      position={[place.x, place.y, place.z + dz]}
      scale={[place.w, place.h, 1]}
      renderOrder={order}
    >
      <meshBasicMaterial
        ref={mat}
        map={map}
        transparent={!opaque}
        opacity={opaque ? 1 : 0}
        depthWrite={!!opaque}
        blending={additive ? AdditiveBlending : NormalBlending}
        toneMapped={false}
        fog={false}
      />
    </mesh>
  )
}

/** The stars: a few hundred one-pixel points, thinned out by rain and day. */
function Stars({ geo }: { geo: BufferGeometry }) {
  const mat = useRef<PointsMaterial>(null!)
  useFrame(() => {
    const m = mat.current
    m.opacity = Math.max(0, 1 - live.rain * 1.4) * 0.95
    m.visible = live.day < 0.995 && m.opacity > 0.004
  })
  return (
    <points geometry={geo} renderOrder={RO.nStars} frustumCulled={false}>
      <pointsMaterial
        ref={mat}
        size={1.7}
        sizeAttenuation={false}
        vertexColors
        transparent
        depthWrite={false}
        toneMapped={false}
        fog={false}
      />
    </points>
  )
}

/** Red aircraft-warning lights on the tallest towers, breathing slowly. */
function Beacons({ geo, map }: { geo: BufferGeometry; map: Texture }) {
  const mat = useRef<PointsMaterial>(null!)
  useFrame((state) => {
    const m = mat.current
    const beat = Math.pow(Math.max(0, Math.sin(state.clock.elapsedTime * 2.4)), 5)
    m.opacity = (0.25 + 0.75 * beat) * (1 - live.rain * 0.55)
    m.visible = live.day < 0.995
  })
  return (
    <points geometry={geo} renderOrder={RO.nBeacon} frustumCulled={false}>
      <pointsMaterial
        ref={mat}
        map={map}
        color="#ff3b2f"
        size={11}
        sizeAttenuation={false}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
        fog={false}
      />
    </points>
  )
}

/** The flash itself: one of three forked bolts, dropped at a random spot
    in the sky each time the strike envelope rises from zero, and riding
    that envelope (so it double-flickers the way lightning does). */
function Bolt({ map, unit }: { map: Texture; unit: PlaneGeometry }) {
  const mat = useRef<MeshBasicMaterial>(null!)
  const mesh = useRef<Mesh>(null!)
  const seen = useRef({ armed: true, seed: 0 })
  // the bolt plane: 0.55 patch-widths wide, twice as tall in the world
  const z = LAYER.clouds.z + 0.05
  const place = useMemo(() => {
    const [xa] = patchToWorld(0, 0, z)
    const [xb, y0] = patchToWorld(1, 0.25, z)
    const [, y1] = patchToWorld(1, 1.15, z)
    return { xa, dx: xb - xa, y: (y0 + y1) / 2, h: y1 - y0 }
  }, [z])
  useFrame(() => {
    const m = mat.current
    const flash = live.flash
    const st = seen.current
    if (flash < 0.01) st.armed = true
    else if (st.armed) {
      st.armed = false
      st.seed = (st.seed + 1 + Math.floor(Math.random() * 2)) % 3
      if (m.map) m.map.offset.x = st.seed / 3
      const u = 0.12 + Math.random() * 0.8
      mesh.current.position.x = place.xa + place.dx * u
    }
    m.opacity = Math.min(1, flash * 1.25) * (1 - live.day * 0.55)
    m.visible = flash > 0.01
  })
  return (
    <mesh
      ref={mesh}
      geometry={unit}
      position={[place.xa + place.dx * 0.5, place.y, z]}
      scale={[place.h * 0.5, place.h, 1]}
      renderOrder={RO.flash}
    >
      <meshBasicMaterial
        ref={mat}
        map={map}
        transparent
        opacity={0}
        visible={false}
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
        fog={false}
      />
    </mesh>
  )
}

/** A few cars on the road that climbs away below the skyline: pairs of
    head- and tail-lights sliding along it, out of focus. One additive
    point cloud, its positions rewritten each frame (six points). */
const CAR_COUNT = 4
function Traffic({ map }: { map: Texture }) {
  const mat = useRef<PointsMaterial>(null!)
  const geo = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(CAR_COUNT * 2 * 3), 3))
    g.setAttribute('color', new Float32BufferAttribute(new Float32Array(CAR_COUNT * 2 * 3), 3))
    return g
  }, [])
  useEffect(() => () => geo.dispose(), [geo])
  useFrame((state) => {
    const pos = geo.getAttribute('position')
    const col = geo.getAttribute('color')
    const t = state.clock.elapsedTime
    for (let i = 0; i < CAR_COUNT; i++) {
      const toward = i % 2 === 0
      // each car loops the road on its own period and phase
      const k = (((t * (0.022 + 0.004 * i) + i * 0.29) % 1) + 1) % 1
      const p = trafficPath(toward ? 1 - k : k)
      for (let j = 0; j < 2; j++) {
        const idx = i * 2 + j
        pos.setXYZ(idx, p.x + (j === 0 ? -p.gap : p.gap), p.y, p.z)
        // white headlamps coming toward the window, red tail-lamps going away
        if (toward) col.setXYZ(idx, 1, 0.95, 0.82)
        else col.setXYZ(idx, 1, 0.22, 0.16)
      }
    }
    pos.needsUpdate = true
    col.needsUpdate = true
    const m = mat.current
    m.opacity = 0.85 * (1 - live.rain * 0.3)
    m.visible = live.day < 0.995
  })
  return (
    <points geometry={geo} renderOrder={RO.nBokeh} frustumCulled={false}>
      <pointsMaterial
        ref={mat}
        map={map}
        size={13}
        sizeAttenuation={false}
        vertexColors
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
        fog={false}
      />
    </points>
  )
}

function Exterior() {
  const isDay = useRoom((s) => s.isDay)
  // the day sky is repainted at most once an hour
  const hourBucket = useWorld((s) => Math.floor(s.hour))
  const [stage, setStage] = useState(0)
  // paint the day set in slices a little after the first frames, not at
  // mount, so the room's opening dolly is not spent on canvases; clicking
  // the window before then simply builds what is missing on the spot
  useEffect(() => {
    const ids = [2500, 2900, 3300, 3700].map((ms, i) =>
      window.setTimeout(() => setStage(i + 1), ms),
    )
    return () => ids.forEach((id) => window.clearTimeout(id))
  }, [])
  const wantHigh = isDay || stage >= 1
  const wantFar = isDay || stage >= 2
  const wantMid = isDay || stage >= 3
  const wantNear = isDay || stage >= 4

  const night = useMemo(() => makeNightScene(), [])
  const dayHigh = useMemo(() => (wantHigh ? makeDayHigh() : null), [wantHigh])
  const dayFar = useMemo(() => (wantFar ? makeDayCity('far') : null), [wantFar])
  const dayMid = useMemo(() => (wantMid ? makeDayCity('mid') : null), [wantMid])
  const dayNear = useMemo(() => (wantNear ? makeDayCity('near') : null), [wantNear])
  const daySky = useMemo(
    () => (wantHigh ? makeDaySky(hourBucket + 0.5) : null),
    [wantHigh, hourBucket],
  )
  const flashTex = useMemo(() => makeFlashTexture(), [])
  const boltTex = useMemo(() => makeBoltAtlas(), [])
  const dot = useMemo(() => makeSoftCircle(), [])
  const starGeo = useMemo(() => {
    const stars = starField()
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(stars.pos, 3))
    g.setAttribute('color', new Float32BufferAttribute(stars.col, 3))
    g.computeBoundingSphere()
    return g
  }, [])
  const beaconGeo = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(beaconPositions(), 3))
    g.computeBoundingSphere()
    return g
  }, [])
  const unit = useMemo(() => new PlaneGeometry(1, 1), [])

  useEffect(
    () => () => {
      night.dispose()
      flashTex.dispose()
      boltTex.dispose()
      dot.dispose()
      starGeo.dispose()
      beaconGeo.dispose()
      unit.dispose()
    },
    [night, flashTex, boltTex, dot, starGeo, beaconGeo, unit],
  )
  useEffect(() => () => dayHigh?.dispose(), [dayHigh])
  useEffect(() => () => dayFar?.dispose(), [dayFar])
  useEffect(() => () => dayMid?.dispose(), [dayMid])
  useEffect(() => () => dayNear?.dispose(), [dayNear])
  useEffect(() => () => daySky?.dispose(), [daySky])

  const hourNow = hourBucket + 0.5
  const sunAt = useMemo(() => placeLayer(LAYER.moon.z, sunFrame(hourNow)), [hourNow])
  const sunWarm = sunPatch(hourNow).warm

  return (
    <group>
      {/* ---- night ---- */}
      <Layer kind="nSky" map={night.sky} place={PLACE.sky} order={RO.nSky} unit={unit} opaque />
      <Stars geo={starGeo} />
      <Layer kind="nMoon" map={night.moon} place={PLACE.moon} order={RO.nMoon} unit={unit} />
      <Layer kind="nClouds" map={night.clouds} place={PLACE.clouds} order={RO.nClouds} unit={unit} />
      <Layer kind="flash" map={flashTex} place={PLACE.flash} order={RO.flash} unit={unit} additive />
      <Bolt map={boltTex} unit={unit} />
      <Layer kind="nFar" map={night.far} place={PLACE.far} order={RO.nFar} unit={unit} />
      <Beacons geo={beaconGeo} map={dot} />
      <Layer kind="nMid" map={night.mid} place={PLACE.mid} order={RO.nMid} unit={unit} />
      <Layer kind="nBokeh" map={night.bokeh} place={PLACE.bokeh} order={RO.nBokeh} unit={unit} additive />
      <Traffic map={dot} />
      <Layer kind="nNear" map={night.near} place={PLACE.near} order={RO.nNear} unit={unit} />

      {/* ---- day (built in slices, or on the spot when first wanted) ---- */}
      {daySky && dayHigh && (
        <>
          <Layer kind="dSky" map={daySky} place={PLACE.sky} order={RO.dSky} unit={unit} dz={0.01} />
          <Layer kind="dSun" map={dayHigh.sun} place={sunAt} order={RO.dSun} unit={unit} additive warm={sunWarm} />
          <Layer kind="dClouds" map={dayHigh.clouds} place={PLACE.clouds} order={RO.dClouds} unit={unit} />
          <Layer
            kind="dCloudsNear"
            map={dayHigh.cloudsNear}
            place={PLACE.cloudsNear}
            order={RO.dCloudsNear}
            unit={unit}
          />
        </>
      )}
      {dayFar && <Layer kind="dFar" map={dayFar} place={PLACE.far} order={RO.dFar} unit={unit} />}
      {dayMid && <Layer kind="dMid" map={dayMid} place={PLACE.mid} order={RO.dMid} unit={unit} />}
      {dayNear && <Layer kind="dNear" map={dayNear} place={PLACE.near} order={RO.dNear} unit={unit} />}
    </group>
  )
}

/* =====================================================================
   The unit
   ===================================================================== */

export default function RoomWindow() {
  const view = useSystem((s) => s.view)
  const isDay = useRoom((s) => s.isDay)
  const toggleDay = useRoom((s) => s.toggleDay)
  const blinds = useWorld((s) => s.blinds)

  const frame = useMemo(() => buildWindowFrame(), [])
  const wood = useMemo(() => teakMaps(), [])
  const glassTex = useMemo(() => glassTexture(), [])
  const rainTex = useMemo(() => makeRainStreaks(), [])
  const beadTex = useMemo(() => makeRainBeads(), [])
  const gobo = useMemo(() => makeGobo(), [])
  const alu = useMemo(() => brushedMetalMaps(4, 256, 1), [])

  const slatGeo = useMemo(() => buildSlat(), [])
  const railGeo = useMemo(() => buildBlindRails(), [])
  const tapeGeo = useMemo(() => buildBlindTapes(BLIND_SLATS, SLAT_TOP, SLAT_STEP), [])
  const wandGeo = useMemo(() => buildBlindWand(), [])
  const pull = useMemo(() => buildCordPull(CORD_LEN), [])
  const rainGeo = useMemo(() => new PlaneGeometry(0.612, 0.812), [])

  const woodMat = useMemo(
    () =>
      new MeshPhysicalMaterial({
        color: '#f2e3d3',
        map: wood.map,
        normalMap: wood.normalMap,
        normalScale: new Vector2(0.3, 0.3),
        roughnessMap: wood.roughnessMap,
        roughness: 1,
        clearcoat: 0.28,
        clearcoatRoughness: 0.42,
      }),
    [wood],
  )
  const brassMat = useMemo(
    () => new MeshStandardMaterial({ color: '#c39a4c', metalness: 0.9, roughness: 0.34 }),
    [],
  )
  const rubberMat = useMemo(
    () => new MeshStandardMaterial({ color: '#101114', roughness: 0.85 }),
    [],
  )
  const glassMat = useMemo(
    () =>
      new MeshPhysicalMaterial({
        color: '#e4edff',
        transparent: true,
        opacity: 0.07,
        roughness: 0.05,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        envMapIntensity: 2.6,
        depthWrite: false,
      }),
    [],
  )
  const haloMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#000000',
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        toneMapped: false,
      }),
    [],
  )
  const slatMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#d3d2cb',
        metalness: 0.4,
        roughness: 1,
        roughnessMap: alu.roughnessMap,
        normalMap: alu.normalMap,
        normalScale: new Vector2(0.4, 0.4),
      }),
    [alu],
  )
  const railMat = useMemo(
    () => new MeshStandardMaterial({ color: '#cfcec6', metalness: 0.4, roughness: 0.44 }),
    [],
  )
  const clothMat = useMemo(
    () => new MeshStandardMaterial({ color: '#bdb9ac', roughness: 0.95 }),
    [],
  )
  const wandMat = useMemo(
    () => new MeshStandardMaterial({ color: '#e7e1d2', roughness: 0.38 }),
    [],
  )
  const cordMat = useMemo(
    () => new MeshStandardMaterial({ color: '#e6dfcf', roughness: 0.9 }),
    [],
  )
  const acornMat = useMemo(
    () => new MeshStandardMaterial({ color: '#b39a6e', roughness: 0.5 }),
    [],
  )
  const shaftMat = useMemo(() => makeShaftMaterial(), [])
  const shaftGeo = useMemo(() => makeShaftGeometry(SHAFT_DISTANCE), [])
  useEffect(
    () => () => {
      frame.wood.dispose()
      frame.brass.dispose()
      frame.rubber.dispose()
      frame.glass.dispose()
      frame.halo.dispose()
      wood.dispose()
      glassTex.dispose()
      rainTex.dispose()
      beadTex.dispose()
      gobo.texture.dispose()
      alu.dispose()
      for (const g of [slatGeo, railGeo, tapeGeo, wandGeo, pull.cord, pull.acorn, rainGeo, shaftGeo])
        g.dispose()
      for (const m of [
        woodMat,
        brassMat,
        rubberMat,
        glassMat,
        haloMat,
        slatMat,
        railMat,
        clothMat,
        wandMat,
        cordMat,
        acornMat,
        shaftMat,
      ])
        m.dispose()
    },
    [
      frame,
      wood,
      glassTex,
      rainTex,
      beadTex,
      gobo,
      alu,
      slatGeo,
      railGeo,
      tapeGeo,
      wandGeo,
      pull,
      rainGeo,
      shaftGeo,
      woodMat,
      brassMat,
      rubberMat,
      glassMat,
      haloMat,
      slatMat,
      railMat,
      clothMat,
      wandMat,
      cordMat,
      acornMat,
      shaftMat,
    ],
  )

  const dust = useRef<MeshBasicMaterial>(null!)
  const rainStreaks = useRef<Mesh>(null!)
  const rainBeads = useRef<Mesh>(null!)
  const streakMat = useRef<MeshBasicMaterial>(null!)
  const beadMat = useRef<MeshBasicMaterial>(null!)
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

    /* dust, smudges and the sheen of the room on the pane: unlit, so it is
       dim at night and picks up the sky by day */
    dust.current.color
      .copy(NIGHT_DUST)
      .lerp(DAY_DUST, day)
      .multiplyScalar(1 + flash * 0.9 + 0.35 * live.lamp * (1 - day))

    /* rain on the glass: streaks slide, beads sit */
    const raining = rain > 0.01
    rainStreaks.current.visible = raining
    rainBeads.current.visible = raining
    if (raining) {
      // beads catch more of the night's little light than of the day's
      beadMat.current.opacity = rain * (0.75 + 0.25 * day + flash * 0.4)
      streakMat.current.opacity = rain * 0.8
      const streaks = streakMat.current.map
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

  const glassZ = -WINDOW.glassDepth
  return (
    <>
      <Exterior />
      <group position={[WINDOW.x, WINDOW.y, WINDOW.wallZ]}>
        <Clickable
          enabled={view === 'room'}
          label={isDay ? 'bring back the night' : 'let the sun in'}
          onActivate={() => {
            playClick()
            toggleDay()
          }}
        >
          <mesh geometry={frame.wood} material={woodMat} castShadow />
          <mesh geometry={frame.brass} material={brassMat} />
          <mesh geometry={frame.rubber} material={rubberMat} />
          <mesh geometry={frame.glass} material={glassMat} />
          <mesh geometry={frame.glass} position={[0, 0, 0.0004]}>
            <meshBasicMaterial
              ref={dust}
              map={glassTex}
              transparent
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </Clickable>
        {/* a soft contact shadow round the casing, sill and apron */}
        <mesh geometry={frame.halo} material={haloMat} />

        {/* rain on the outer face of the glass: beads that sit, streaks
            that run */}
        <mesh
          ref={rainBeads}
          geometry={rainGeo}
          position={[0, 0, glassZ - 0.0006]}
          visible={false}
        >
          <meshBasicMaterial
            ref={beadMat}
            map={beadTex}
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh
          ref={rainStreaks}
          geometry={rainGeo}
          position={[0, 0, glassZ - 0.0012]}
          visible={false}
        >
          <meshBasicMaterial
            ref={streakMat}
            map={rainTex}
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* venetian blind, inside the reveal: headrail, ladder tapes,
            eighteen slats, bottom rail */}
        <mesh geometry={railGeo} material={railMat} />
        <mesh geometry={tapeGeo} material={clothMat} />
        <instancedMesh
          ref={slats}
          args={[slatGeo, slatMat, BLIND_SLATS]}
          frustumCulled={false}
        />

        {/* the cord and the tilt wand, on the jambs */}
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
          <group ref={cord} position={[CORD_X, 0.425, SLAT_Z + 0.03]}>
            <mesh geometry={pull.cord} material={cordMat} />
            <mesh geometry={pull.acorn} material={acornMat} />
            {/* invisible hit pad — the cord is a thread from room distance */}
            <mesh position={[0, -CORD_LEN / 2, 0]}>
              <boxGeometry args={[0.04, CORD_LEN + 0.06, 0.024]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </group>
          <group position={[WAND_X, 0.43, SLAT_Z + 0.032]}>
            <mesh geometry={wandGeo} material={wandMat} />
            <mesh position={[0, -0.23, 0]}>
              <boxGeometry args={[0.04, 0.5, 0.024]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </group>
        </Clickable>

        {/* moonlight / sunlight spilling in: a light the size of the glass,
            facing into the room (lights emit down their local -z) */}
        <rectAreaLight
          ref={spill}
          args={['#7b93c9', 0.8, 0.62, 0.82]}
          position={[0, 0, 0.04]}
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
          renderOrder={40}
        />
      </group>
    </>
  )
}
