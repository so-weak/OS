import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import {
  MathUtils,
  type Group,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
} from 'three'
import { GLASS_H, GLASS_W, HTML_SCALE, SCREEN_H, SCREEN_W } from '../constants'
import { useSystem } from '../os/store'
import { playBeep, playClick } from '../os/sound'
import SoubhikOS from '../os/SoubhikOS'
import Clickable from './Clickable'
import { BEZEL, GLASS_LOCAL, MON_POS, MON_YAW, P } from './layout'
import { KNOB_LEVELS, useRoom } from './roomState'
import { makeLabel, makeStickyNote } from './textures'

/* =====================================================================
   The CRT monitor. A thick beige bezel frames the glass; the OS itself
   is a 1024×768 DOM node mapped onto the glass plane with drei <Html
   transform occlude="blending">. distanceFactor=400 makes 1 css px equal
   exactly `scale` world units, so scale=HTML_SCALE fits the glass.

   Front-panel extras: the brightness/contrast knobs REALLY work (they
   drive a CSS filter on the OS plane), and the sticky note glows when
   someone types "hire" on the room keyboard.
   ===================================================================== */

/* Bezel frame strips derived from the shared layout contract. */
const PLATE_W = BEZEL.halfW * 2
const HOLE_CY = GLASS_LOCAL.y
const TOP_H = BEZEL.top - (HOLE_CY + BEZEL.holeH / 2)
const BOT_H = HOLE_CY - BEZEL.holeH / 2 - BEZEL.bottom
const SIDE_W = (PLATE_W - BEZEL.holeW) / 2
const PLATE_FRONT = BEZEL.frontZ + BEZEL.depth / 2 // local z of bezel face
const KNOB_Y = BEZEL.bottom + BOT_H / 2

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

  const glowMat = useRef<MeshBasicMaterial>(null!)
  const glowLight = useRef<PointLight>(null!)
  const ledMat = useRef<MeshStandardMaterial>(null!)
  const level = useRef(0)

  const brandTex = useMemo(
    () => makeLabel('SOUBHIK SYNTHVISION 17', P.plasticDark, null, 4, 2),
    [],
  )
  useEffect(() => () => brandTex.dispose(), [brandTex])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    level.current = MathUtils.damp(level.current, powered ? 1 : 0, 5, dt)
    // phosphor never sits perfectly still; knob turns brighten the bleed
    const knob = KNOB_LEVELS[useRoom.getState().brightIdx]
    const flicker =
      1 + Math.sin(t * 43.7) * 0.035 + Math.sin(t * 11.3) * 0.045
    glowMat.current.opacity =
      level.current * 0.5 * flicker * (0.55 + 0.45 * knob)
    glowLight.current.intensity =
      level.current * 1.6 * flicker * (0.55 + 0.45 * knob)
    ledMat.current.emissiveIntensity = MathUtils.damp(
      ledMat.current.emissiveIntensity,
      powered ? 1.8 : 0,
      8,
      dt,
    )
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
        <MonitorShell brandTex={brandTex} ledMat={ledMat} />
      </Clickable>

      <StickyNote />

      {/* brightness / contrast knobs — they actually work */}
      <Knob
        x={0.15}
        idx={brightIdx}
        label="brightness"
        onCycle={cycleBright}
      />
      <Knob
        x={0.178}
        idx={contrastIdx}
        label="contrast"
        onCycle={cycleContrast}
      />

      {/* tube face — dark glass filling the bezel hole */}
      <mesh position={[0, HOLE_CY, GLASS_LOCAL.z - 0.0015]}>
        <planeGeometry args={[BEZEL.holeW, BEZEL.holeH]} />
        <meshStandardMaterial color="#090c0b" roughness={0.35} />
      </mesh>

      {/* phosphor bleed — a whisker larger than the glass so a lit rim
          halos around the OS while powered */}
      <mesh position={[0, HOLE_CY, GLASS_LOCAL.z - 0.0005]}>
        <planeGeometry args={[GLASS_W + 0.012, GLASS_H + 0.012]} />
        <meshBasicMaterial
          ref={glowMat}
          color={P.screenGlow}
          transparent
          opacity={0}
          toneMapped={false}
        />
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
          <boxGeometry args={[0.0014, 0.0032, 0.0008]} />
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
  ledMat,
}: {
  brandTex: ReturnType<typeof makeLabel>
  ledMat: React.RefObject<MeshStandardMaterial>
}) {
  return (
    <group>
      {/* swivel base */}
      <mesh position={[0, 0.014, 0.02]} castShadow>
        <boxGeometry args={[0.3, 0.028, 0.26]} />
        <meshStandardMaterial color={P.chassisDark} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.042, 0.01]}>
        <cylinderGeometry args={[0.09, 0.115, 0.03, 18]} />
        <meshStandardMaterial color={P.chassis} roughness={0.8} />
      </mesh>

      {/* main body */}
      <mesh position={[0, 0.26, -0.005]} castShadow>
        <boxGeometry args={[PLATE_W, BEZEL.top - BEZEL.bottom, 0.24]} />
        <meshStandardMaterial color={P.chassis} roughness={0.75} />
      </mesh>
      {/* rear hump */}
      <mesh position={[0, 0.27, -0.17]} castShadow>
        <boxGeometry args={[0.33, 0.3, 0.12]} />
        <meshStandardMaterial color={P.chassisDark} roughness={0.8} />
      </mesh>
      {/* top vents */}
      {[-0.06, -0.09, -0.12].map((z) => (
        <mesh key={z} position={[0, 0.4605, z]}>
          <boxGeometry args={[0.3, 0.0016, 0.012]} />
          <meshStandardMaterial color={P.plasticDark} roughness={0.9} />
        </mesh>
      ))}

      {/* bezel frame — four strips around the glass hole */}
      <mesh
        position={[0, BEZEL.top - TOP_H / 2, BEZEL.frontZ]}
        castShadow
      >
        <boxGeometry args={[PLATE_W, TOP_H, BEZEL.depth]} />
        <meshStandardMaterial color={P.chassis} roughness={0.7} />
      </mesh>
      <mesh position={[0, BEZEL.bottom + BOT_H / 2, BEZEL.frontZ]}>
        <boxGeometry args={[PLATE_W, BOT_H, BEZEL.depth]} />
        <meshStandardMaterial color={P.chassis} roughness={0.7} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[
            s * (BEZEL.holeW / 2 + SIDE_W / 2),
            HOLE_CY,
            BEZEL.frontZ,
          ]}
        >
          <boxGeometry args={[SIDE_W, BEZEL.holeH, BEZEL.depth]} />
          <meshStandardMaterial color={P.chassis} roughness={0.7} />
        </mesh>
      ))}
      {/* darker inner lip around the tube */}
      <mesh position={[0, HOLE_CY, BEZEL.frontZ - 0.004]}>
        <boxGeometry args={[BEZEL.holeW + 0.016, BEZEL.holeH + 0.016, 0.018]} />
        <meshStandardMaterial color={P.chassisDarker} roughness={0.85} />
      </mesh>

      {/* etched brand plate */}
      <mesh position={[0.01, KNOB_Y, PLATE_FRONT + 0.001]}>
        <planeGeometry args={[0.104, 0.0115]} />
        <meshBasicMaterial map={brandTex} transparent opacity={0.85} />
      </mesh>

      {/* power LED */}
      <mesh position={[0.202, KNOB_Y, PLATE_FRONT + 0.001]}>
        <boxGeometry args={[0.0085, 0.005, 0.003]} />
        <meshStandardMaterial
          ref={ledMat}
          color="#123a1c"
          emissive={P.ledGreen}
          emissiveIntensity={0}
          roughness={0.4}
        />
      </mesh>
    </group>
  )
}
