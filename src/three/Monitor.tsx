import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import {
  AdditiveBlending,
  CustomBlending,
  ExtrudeGeometry,
  MathUtils,
  MeshPhysicalMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Path,
  Shape,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
  type SpriteMaterial,
} from 'three'
import { GLASS_H, GLASS_W, HTML_SCALE, SCREEN_H, SCREEN_W } from '../constants'
import { useSystem } from '../os/store'
import { playBeep, playClick } from '../os/sound'
import SoubhikOS from '../os/SoubhikOS'
import { useWorld } from '../world'
import Clickable from './Clickable'
import Halo from './Halo'
import { BEZEL, GLASS_LOCAL, MON_POS, MON_YAW, P } from './layout'
import { KNOB_LEVELS, useRoom } from './roomState'
import { makeFeatheredRect, makeLabel, makeStickyNote } from './textures'
import { rb } from './rbox'

/* =====================================================================
   The CRT monitor. A thick beige bezel frames the glass; the OS itself
   is a 1024×768 DOM node mapped onto the glass plane with drei <Html
   transform occlude="blending">. distanceFactor=400 makes 1 css px equal
   exactly `scale` world units, so scale=HTML_SCALE fits the glass.

   Front-panel extras: the brightness/contrast knobs REALLY work (they
   drive a CSS filter on the OS plane), and the sticky note glows when
   someone types "hire" on the room keyboard.
   ===================================================================== */

/* Bezel frame dimensions derived from the shared layout contract. */
const PLATE_W = BEZEL.halfW * 2
const HOLE_CY = GLASS_LOCAL.y
const BOT_H = HOLE_CY - BEZEL.holeH / 2 - BEZEL.bottom
const PLATE_FRONT = BEZEL.frontZ + BEZEL.depth / 2 // local z of bezel face
const KNOB_Y = BEZEL.bottom + BOT_H / 2

/** The bezel as ONE chamfered frame: a rectangle with a hole, extruded
    with a bevel. ExtrudeGeometry's bevel grows the body and shrinks the
    hole in the mid-section, so the hole is widest at the face and
    narrows toward the recessed glass — a real tube surround. */
function buildBezel(): ExtrudeGeometry {
  const b = BEZEL.bevel
  const shape = new Shape()
  const hw = BEZEL.halfW - b
  shape.moveTo(-hw, BEZEL.bottom + b)
  shape.lineTo(hw, BEZEL.bottom + b)
  shape.lineTo(hw, BEZEL.top - b)
  shape.lineTo(-hw, BEZEL.top - b)
  shape.closePath()
  const hole = new Path()
  const hx = BEZEL.holeW / 2 + b
  const hy = BEZEL.holeH / 2 + b
  hole.moveTo(-hx, HOLE_CY - hy)
  hole.lineTo(-hx, HOLE_CY + hy)
  hole.lineTo(hx, HOLE_CY + hy)
  hole.lineTo(hx, HOLE_CY - hy)
  hole.closePath()
  shape.holes.push(hole)
  const depth = BEZEL.depth - 2 * b
  const geo = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: 0,
    bevelSegments: 2,
    curveSegments: 1,
  })
  // the extrusion spans z ∈ [-b, depth + b]; put its face at PLATE_FRONT
  geo.translate(0, 0, PLATE_FRONT - depth - b)
  return geo
}

/** Reflection-only glass over the OS (R-P4c): black physical material
    whose env reflection is ADDED to the frame, alpha = brightest channel
    so it survives the DOM alpha hole. Room view only — reading is sacred. */
function buildGlass(): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: '#000000',
    roughness: 0.06,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    transparent: true,
    depthWrite: false,
    envMapIntensity: 0.25,
  })
  m.blending = CustomBlending
  m.blendSrc = OneFactor
  m.blendDst = OneFactor
  m.blendSrcAlpha = OneFactor
  m.blendDstAlpha = OneMinusSrcAlphaFactor
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\n\tgl_FragColor.a = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));',
    )
  }
  return m
}

export default function Monitor() {
  const view = useSystem((s) => s.view)
  const powered = useSystem((s) => s.power !== 'off')
  const powerOn = useSystem((s) => s.powerOn)
  const gl = useThree((s) => s.gl)
  /* Scene passes eventSource={#root}, and drei portals Html into
     events.connected by default — #root, OUTSIDE the canvas container.
     There the OS plane composites ON TOP of the canvas and no WebGL
     object (lifted paper, tossed trash ball) can ever occlude it.
     Pinning the portal to the canvas's own parent restores the intended
     occlude="blending" stack: canvas above DOM, alpha hole punched
     through the glass. */
  const htmlPortal = useMemo(
    () => ({ current: gl.domElement.parentNode as HTMLElement }),
    [gl],
  )
  const brightIdx = useRoom((s) => s.brightIdx)
  const contrastIdx = useRoom((s) => s.contrastIdx)
  const cycleBright = useRoom((s) => s.cycleBright)
  const cycleContrast = useRoom((s) => s.cycleContrast)
  const muted = useSystem((s) => s.muted)
  /* the ledger: both tube knobs turned at least once */
  const turned = useRef({ bright: false, contrast: false })
  const noteTurn = (which: 'bright' | 'contrast') => {
    turned.current[which] = true
    if (turned.current.bright && turned.current.contrast)
      useWorld.getState().mark('knobs')
  }

  const glowMat = useRef<MeshBasicMaterial>(null!)
  const glowLight = useRef<PointLight>(null!)
  const ledMat = useRef<MeshStandardMaterial>(null!)
  const ledHalo = useRef<SpriteMaterial>(null!)
  const glass = useRef<Mesh>(null!)
  const level = useRef(0)
  /** 1 in room view, eased to 0 while zooming/reading — the bleed sits
      in front of the bezel, so it must never veil the OS while reading */
  const roomMix = useRef(1)

  const brandTex = useMemo(
    () => makeLabel('SOUBHIK SYNTHVISION 17', P.plasticDark, null, 4, 2),
    [],
  )
  const bleedTex = useMemo(() => makeFeatheredRect(128, 96, 0.34), [])
  const bezelGeo = useMemo(() => buildBezel(), [])
  const glassMat = useMemo(() => buildGlass(), [])
  useEffect(
    () => () => {
      brandTex.dispose()
      bleedTex.dispose()
      bezelGeo.dispose()
      glassMat.dispose()
    },
    [brandTex, bleedTex, bezelGeo, glassMat],
  )

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    level.current = MathUtils.damp(level.current, powered ? 1 : 0, 5, dt)
    // phosphor never sits perfectly still; knob turns brighten the bleed
    const knob = KNOB_LEVELS[useRoom.getState().brightIdx]
    const flicker =
      1 + Math.sin(t * 43.7) * 0.035 + Math.sin(t * 11.3) * 0.045
    roomMix.current = MathUtils.damp(
      roomMix.current,
      useSystem.getState().view === 'room' ? 1 : 0,
      8,
      dt,
    )
    glowMat.current.opacity =
      level.current * 0.3 * flicker * (0.55 + 0.45 * knob) * roomMix.current
    glowLight.current.intensity =
      level.current * 1.6 * flicker * (0.55 + 0.45 * knob)
    ledMat.current.emissiveIntensity = MathUtils.damp(
      ledMat.current.emissiveIntensity,
      powered ? 1.8 : 0,
      8,
      dt,
    )
    ledHalo.current.opacity = ledMat.current.emissiveIntensity * 0.3
    // the glass reflects the room's env explicitly, so its own intensity
    // is honoured (three overrides envMapIntensity for scene-env users)
    const gm = glass.current.material as MeshPhysicalMaterial
    if (gm.envMap !== state.scene.environment)
      gm.envMap = state.scene.environment
    gm.envMapIntensity = 0.25 * state.scene.environmentIntensity
  })

  return (
    <group position={MON_POS} rotation-y={MON_YAW}>
      <Clickable
        enabled={view === 'room'}
        label={powered ? 'lean in' : 'power on'}
        onActivate={() => {
          playClick()
          powerOn()
        }}
      >
        <MonitorShell
          brandTex={brandTex}
          bezelGeo={bezelGeo}
          ledMat={ledMat}
          ledHalo={ledHalo}
        />
      </Clickable>

      <StickyNote />

      {/* volume / brightness / contrast knobs — they actually work.
          Volume has two detents (muted / not) and IS the mute control. */}
      <Knob
        x={0.122}
        idx={muted ? 0 : 4}
        label={muted ? 'volume (muted)' : 'volume'}
        onCycle={() => useSystem.getState().toggleMuted()}
      />
      <Knob
        x={0.15}
        idx={brightIdx}
        label="brightness"
        onCycle={() => {
          noteTurn('bright')
          cycleBright()
        }}
      />
      <Knob
        x={0.178}
        idx={contrastIdx}
        label="contrast"
        onCycle={() => {
          noteTurn('contrast')
          cycleContrast()
        }}
      />

      {/* tube face — dark glass filling the bezel hole */}
      <mesh position={[0, HOLE_CY, GLASS_LOCAL.z - 0.0015]}>
        <planeGeometry args={[BEZEL.holeW, BEZEL.holeH]} />
        <meshStandardMaterial color="#090c0b" roughness={0.35} />
      </mesh>

      {/* phosphor bleed — a feathered additive veil just proud of the
          bezel, so the lit tube blooms softly onto the plastic around it
          while powered. Room view only (roomMix); the lifted paper
          (renderOrder 50, no depth test) still paints over it. */}
      <mesh position={[0, HOLE_CY, PLATE_FRONT + 0.004]} renderOrder={4}>
        <planeGeometry args={[BEZEL.holeW + 0.08, BEZEL.holeH + 0.08]} />
        <meshBasicMaterial
          ref={glowMat}
          map={bleedTex}
          color={P.screenGlow}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* the glass itself: reflections of the lamp and window slide across
          the tube with the camera; hidden the moment you lean in */}
      <mesh
        ref={glass}
        position={[0, HOLE_CY, GLASS_LOCAL.z + 0.0035]}
        material={glassMat}
        renderOrder={10}
        visible={view === 'room'}
      >
        <planeGeometry args={[GLASS_W, GLASS_H]} />
      </mesh>

      {/* screen light spilling onto the keyboard and desk */}
      <pointLight
        ref={glowLight}
        position={[0, HOLE_CY, 0.55]}
        color={P.screenGlow}
        intensity={0}
        distance={1.7}
        decay={2}
      />

      {/* ============ the OS, mapped 1:1 onto the glass ============ */}
      <Html
        transform
        occlude="blending"
        portal={htmlPortal}
        distanceFactor={400}
        scale={HTML_SCALE}
        position={[GLASS_LOCAL.x, GLASS_LOCAL.y, GLASS_LOCAL.z + 0.002]}
        zIndexRange={[40, 0]}
        pointerEvents={view === 'screen' ? 'auto' : 'none'}
      >
        <div
          style={{
            width: SCREEN_W,
            height: SCREEN_H,
            overflow: 'hidden',
            background: 'var(--term-bg)',
            filter: `brightness(${KNOB_LEVELS[brightIdx]}) contrast(${KNOB_LEVELS[contrastIdx]})`,
          }}
        >
          <Suspense fallback={null}>
            <SoubhikOS />
          </Suspense>
        </div>
      </Html>
    </group>
  )
}

/* ---------- bezel knob with detents ---------- */
function Knob({
  x,
  idx,
  label,
  onCycle,
}: {
  x: number
  idx: number
  label: string
  onCycle: () => void
}) {
  const view = useSystem((s) => s.view)
  const grp = useRef<Group>(null!)

  useFrame((_, delta) => {
    grp.current.rotation.z = MathUtils.damp(
      grp.current.rotation.z,
      -(idx - 2) * 0.55,
      12,
      Math.min(delta, 0.05),
    )
  })

  return (
    <Clickable
      enabled={view === 'room'}
      label={label}
      onActivate={() => {
        playClick()
        onCycle()
      }}
    >
      <group ref={grp} position={[x, KNOB_Y, PLATE_FRONT]}>
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.0062, 0.0062, 0.008, 10]} />
          <meshStandardMaterial color={P.plasticDark} roughness={0.75} />
        </mesh>
        {/* indicator notch */}
        <mesh position={[0, 0.0036, 0.0041]}>
          <roundedBoxGeometry args={rb(0.0014, 0.0032, 0.0008)} />
          <meshStandardMaterial color={P.chassis} roughness={0.5} />
        </mesh>
        {/* invisible hit pad — knobs are tiny from room distance */}
        <mesh position={[0, 0, 0.005]}>
          <circleGeometry args={[0.011, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </Clickable>
  )
}

/* ---------- sticky note: the hint, plus the "hire" celebration ---------- */
function StickyNote() {
  const view = useSystem((s) => s.view)
  const noteTex = useMemo(() => makeStickyNote(), [])
  useEffect(() => () => noteTex.dispose(), [noteTex])

  const mat = useRef<MeshStandardMaterial>(null!)
  const rig = useRef<Group>(null!)
  const wiggle = useRef({ s: 0, v: 0 })

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    const celebrating = useRoom.getState().hireActive
    mat.current.emissiveIntensity = MathUtils.damp(
      mat.current.emissiveIntensity,
      celebrating ? 0.55 + Math.sin(t * 11) * 0.35 : 0,
      8,
      dt,
    )
    const w = wiggle.current
    w.v += (-140 * w.s - 9 * w.v) * dt
    w.s += w.v * dt
    rig.current.rotation.z = 0.07 + w.s
  })

  return (
    <group
      ref={rig}
      position={[-0.128, 0.093, PLATE_FRONT + 0.0015]}
      rotation-z={0.07}
    >
      <Clickable
        enabled={view === 'room'}
        label="past me left this"
        onActivate={() => {
          wiggle.current.v = 1.4
          playBeep()
        }}
      >
        <mesh>
          <planeGeometry args={[0.06, 0.06]} />
          <meshStandardMaterial
            ref={mat}
            map={noteTex}
            emissive="#f6d84f"
            emissiveMap={noteTex}
            emissiveIntensity={0}
            roughness={0.95}
          />
        </mesh>
      </Clickable>
    </group>
  )
}

/* NOTE: the "hire" toast is deliberately NOT a drei <Html> here — a
   non-blending Html resets the canvas z-index/pointer-events that
   occlude="blending" depends on (drei clobbers them on mount). It lives
   in the DOM beside the canvas instead: see HireToast in Tooltip.tsx. */

/* ---------- passive shell geometry ---------- */
function MonitorShell({
  brandTex,
  bezelGeo,
  ledMat,
  ledHalo,
}: {
  brandTex: ReturnType<typeof makeLabel>
  bezelGeo: ExtrudeGeometry
  ledMat: React.RefObject<MeshStandardMaterial>
  ledHalo: React.RefObject<SpriteMaterial>
}) {
  return (
    <group>
      {/* swivel base */}
      <mesh position={[0, 0.014, 0.02]} castShadow>
        <roundedBoxGeometry args={rb(0.3, 0.028, 0.26)} />
        <meshStandardMaterial color={P.chassisDark} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.042, 0.01]}>
        <cylinderGeometry args={[0.09, 0.115, 0.03, 18]} />
        <meshStandardMaterial color={P.chassis} roughness={0.8} />
      </mesh>

      {/* main body */}
      <mesh position={[0, 0.26, -0.005]} castShadow>
        <roundedBoxGeometry args={rb(PLATE_W, BEZEL.top - BEZEL.bottom, 0.24)} />
        <meshStandardMaterial color={P.chassis} roughness={0.75} />
      </mesh>
      {/* rear hump */}
      <mesh position={[0, 0.27, -0.17]} castShadow>
        <roundedBoxGeometry args={rb(0.33, 0.3, 0.12)} />
        <meshStandardMaterial color={P.chassisDark} roughness={0.8} />
      </mesh>
      {/* top vents */}
      {[-0.06, -0.09, -0.12].map((z) => (
        <mesh key={z} position={[0, 0.4605, z]}>
          <roundedBoxGeometry args={rb(0.3, 0.0016, 0.012)} />
          <meshStandardMaterial color={P.plasticDark} roughness={0.9} />
        </mesh>
      ))}

      {/* bezel — one chamfered frame around the recessed glass */}
      <mesh geometry={bezelGeo} castShadow>
        <meshStandardMaterial color={P.chassis} roughness={0.7} />
      </mesh>

      {/* etched brand plate */}
      <mesh position={[0.01, KNOB_Y, PLATE_FRONT + 0.001]}>
        <planeGeometry args={[0.104, 0.0115]} />
        <meshBasicMaterial map={brandTex} transparent opacity={0.85} />
      </mesh>

      {/* power LED */}
      <mesh position={[0.202, KNOB_Y, PLATE_FRONT + 0.001]}>
        <roundedBoxGeometry args={rb(0.0085, 0.005, 0.003)} />
        <meshStandardMaterial
          ref={ledMat}
          color="#123a1c"
          emissive={P.ledGreen}
          emissiveIntensity={0}
          roughness={0.4}
        />
      </mesh>
      <Halo
        ref={ledHalo}
        color={P.ledGreen}
        size={0.026}
        intensity={0}
        position={[0.202, KNOB_Y, PLATE_FRONT + 0.004]}
      />
    </group>
  )
}
