import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  MathUtils,
  type Group,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type SpriteMaterial,
} from 'three'
import { certifications } from '../data/resume'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import { useWorld } from '../world'
import Clickable from './Clickable'
import Halo from './Halo'
import { P, TOWER_POS, TOWER_SIZE, TOWER_YAW } from './layout'
import { useRoom } from './roomState'
import { makeLabel, makeLabelLines } from './textures'
import { rb } from './rbox'

/* =====================================================================
   The beige AT tower. Front panel: floppy drive (clickable — the disk
   ejects with a springy pop), LED cluster with a glowing MHz readout,
   the power button (boots the machine just like clicking the monitor),
   and an intake fan that spins while powered. The power LED breathes
   amber on standby and burns green once running — the room's pulse.
   ===================================================================== */

const FRONT = TOWER_SIZE.d / 2 // local z of the chassis front face
const PANEL_Z = FRONT + 0.009 // proud front plate centre
const PANEL_FACE = PANEL_Z + 0.009 // surface details sit here

export default function Tower() {
  const view = useSystem((s) => s.view)
  const powerOn = useSystem((s) => s.powerOn)

  const badgeTex = useMemo(
    () => makeLabel('SOUBHIK SYSTEMS', P.plasticDark, null, 4, 2),
    [],
  )
  const mhzTex = useMemo(
    () => makeLabel('486 66', P.termGreen, '#071009', 6, 6),
    [],
  )
  const floppyTex = useMemo(
    () => makeLabelLines(['SOUBHIKOS 4.01', 'BOOT'], '#1a1812', '#eceadf', 4, 6, 1.75),
    [],
  )
  const cdTex = useMemo(
    () => makeLabel(CD_LABEL, '#1a1812', '#eceadf', 4, 3),
    [],
  )
  useEffect(
    () => () => {
      badgeTex.dispose()
      mhzTex.dispose()
      floppyTex.dispose()
      cdTex.dispose()
    },
    [badgeTex, mhzTex, floppyTex, cdTex],
  )

  return (
    <group position={TOWER_POS} rotation-y={TOWER_YAW}>
      {/* chassis + proud front plate — the whole case is a power switch
          (the dedicated button is tiny from across the room) */}
      <Clickable
        enabled={view === 'room'}
        label="power"
        onActivate={() => {
          playClick()
          powerOn()
        }}
      >
        <mesh castShadow receiveShadow>
          <roundedBoxGeometry args={rb(TOWER_SIZE.w, TOWER_SIZE.h, TOWER_SIZE.d)} />
          <meshStandardMaterial color={P.chassisDark} roughness={0.8} />
        </mesh>
        <mesh position={[0, 0, PANEL_Z]} castShadow>
          <roundedBoxGeometry
            args={rb(TOWER_SIZE.w - 0.01, TOWER_SIZE.h - 0.01, 0.018)}
          />
          <meshStandardMaterial color={P.chassis} roughness={0.72} />
        </mesh>
      </Clickable>

      {/* feet */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            position={[sx * 0.085, -TOWER_SIZE.h / 2 - 0.008, sz * 0.2]}
          >
            <roundedBoxGeometry args={rb(0.03, 0.016, 0.03)} />
            <meshStandardMaterial color={P.plasticDark} roughness={0.9} />
          </mesh>
        )),
      )}

      {/* side vent slits */}
      {[-0.02, 0.02, 0.06].map((y) => (
        <mesh key={y} position={[-TOWER_SIZE.w / 2 - 0.001, y, 0.05]}>
          <roundedBoxGeometry args={rb(0.002, 0.008, 0.3)} />
          <meshStandardMaterial color={P.plasticDark} roughness={0.9} />
        </mesh>
      ))}

      <FloppyDrive enabled={view === 'room'} labelTex={floppyTex} />
      <CdTray labelTex={cdTex} />

      <LedCluster mhzTex={mhzTex} />
      <PowerButton enabled={view === 'room'} onPower={powerOn} />
      <Fan />

      {/* badge */}
      <mesh position={[0, -0.215, PANEL_FACE]}>
        <planeGeometry args={[0.078, 0.0105]} />
        <meshBasicMaterial map={badgeTex} transparent opacity={0.9} />
      </mesh>
    </group>
  )
}

/* ---------- second bay: a CD-ROM drive, its disc labelled (E-5) ----------
   The sticker is a real line from the resume — the shortest
   certification, so it stays readable on a 4 cm tray. */
const CD_LABEL = [...certifications]
  .map((c) => c.replace(/\s*\(.*$/, '').toUpperCase())
  .sort((a, b) => a.length - b.length)[0]

function CdTray({ labelTex }: { labelTex: ReturnType<typeof makeLabel> }) {
  return (
    <group position={[0, 0.095, PANEL_FACE]}>
      {/* bay plate */}
      <mesh>
        <roundedBoxGeometry args={rb(0.15, 0.042, 0.004)} />
        <meshStandardMaterial color={P.chassisDark} roughness={0.8} />
      </mesh>
      {/* tray front, a hair proud of the bay */}
      <mesh position={[-0.008, 0.006, 0.004]}>
        <roundedBoxGeometry args={rb(0.118, 0.017, 0.005)} />
        <meshStandardMaterial color={P.chassis} roughness={0.7} />
      </mesh>
      {/* the disc label showing through the tray's window */}
      <mesh position={[-0.008, 0.006, 0.0066]}>
        <planeGeometry args={[0.052, 0.0105]} />
        <meshBasicMaterial map={labelTex} />
      </mesh>
      {/* seam under the tray, headphone jack, eject */}
      <mesh position={[-0.008, -0.006, 0.0025]}>
        <roundedBoxGeometry args={rb(0.118, 0.0015, 0.001)} />
        <meshStandardMaterial color="#101012" roughness={0.9} />
      </mesh>
      <mesh position={[-0.055, -0.012, 0.0035]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.003, 0.003, 0.003, 10]} />
        <meshStandardMaterial color="#101012" roughness={0.9} />
      </mesh>
      <mesh position={[0.058, -0.012, 0.004]}>
        <roundedBoxGeometry args={rb(0.014, 0.006, 0.005)} />
        <meshStandardMaterial color={P.chassis} roughness={0.7} />
      </mesh>
    </group>
  )
}

/* ---------- floppy drive + springy disk (easter egg) ---------- */
function FloppyDrive({
  enabled,
  labelTex,
}: {
  enabled: boolean
  labelTex: ReturnType<typeof makeLabel>
}) {
  const powered = useSystem((s) => s.power !== 'off')
  const floppyOut = useRoom((s) => s.floppyOut)
  const toggleFloppy = useRoom((s) => s.toggleFloppy)

  const disk = useRef<Group>(null!)
  const spring = useRef({ z: 0.012, v: 0 })
  const driveLed = useRef<MeshStandardMaterial>(null!)
  const driveHalo = useRef<SpriteMaterial>(null!)

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    // underdamped spring so ejecting pops and settles with a wobble
    const target = floppyOut ? 0.062 : 0.012
    const s = spring.current
    const accel = 260 * (target - s.z) - 14 * s.v
    s.v += accel * dt
    s.z += s.v * dt
    disk.current.position.z = PANEL_FACE - 0.05 + s.z
    driveLed.current.emissiveIntensity = MathUtils.damp(
      driveLed.current.emissiveIntensity,
      powered && !floppyOut ? 1.4 : 0,
      8,
      dt,
    )
    driveHalo.current.opacity = driveLed.current.emissiveIntensity * 0.3
  })

  return (
    <Clickable
      enabled={enabled}
      label="the a: drive"
      onActivate={() => {
        playClick()
        if (!useRoom.getState().floppyOut) useWorld.getState().mark('floppy')
        toggleFloppy()
      }}
    >
      {/* bay plate */}
      <mesh position={[0, 0.16, PANEL_FACE]}>
        <roundedBoxGeometry args={rb(0.15, 0.045, 0.006)} />
        <meshStandardMaterial color={P.chassisDark} roughness={0.75} />
      </mesh>
      {/* slot */}
      <mesh position={[-0.008, 0.166, PANEL_FACE + 0.0035]}>
        <roundedBoxGeometry args={rb(0.106, 0.009, 0.002)} />
        <meshStandardMaterial color="#101012" roughness={0.9} />
      </mesh>
      {/* the disk itself, nose poking from the slot */}
      <group ref={disk} position={[-0.008, 0.166, PANEL_FACE - 0.038]}>
        <mesh castShadow>
          <roundedBoxGeometry args={rb(0.096, 0.0075, 0.096)} />
          <meshStandardMaterial color="#2b3a8c" roughness={0.8} />
        </mesh>
        {/* metal shutter */}
        <mesh position={[0.012, 0.0042, -0.024]}>
          <roundedBoxGeometry args={rb(0.036, 0.001, 0.042)} />
          <meshStandardMaterial
            color="#b9bdc9"
            metalness={0.7}
            roughness={0.35}
          />
        </mesh>
        {/* label: the boot disk */}
        <mesh position={[-0.01, 0.0042, 0.026]}>
          <roundedBoxGeometry args={rb(0.06, 0.0008, 0.036)} />
          <meshStandardMaterial color="#eceadf" roughness={0.95} />
        </mesh>
        <mesh position={[-0.01, 0.0047, 0.026]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.056, 0.032]} />
          <meshStandardMaterial map={labelTex} roughness={0.95} />
        </mesh>
      </group>
      {/* eject button */}
      <mesh position={[0.058, 0.152, PANEL_FACE + 0.004]}>
        <roundedBoxGeometry args={rb(0.014, 0.007, 0.005)} />
        <meshStandardMaterial color={P.chassis} roughness={0.7} />
      </mesh>
      {/* drive activity LED */}
      <mesh position={[-0.058, 0.152, PANEL_FACE + 0.0035]}>
        <roundedBoxGeometry args={rb(0.007, 0.004, 0.003)} />
        <meshStandardMaterial
          ref={driveLed}
          color="#1c2f14"
          emissive={P.ledGreen}
          emissiveIntensity={0}
        />
      </mesh>
      <Halo
        ref={driveHalo}
        color={P.ledGreen}
        size={0.024}
        intensity={0}
        position={[-0.058, 0.152, PANEL_FACE + 0.006]}
      />
    </Clickable>
  )
}

/* ---------- LED cluster + MHz display ---------- */
function LedCluster({ mhzTex }: { mhzTex: ReturnType<typeof makeLabel> }) {
  const powerLed = useRef<MeshStandardMaterial>(null!)
  const hddLed = useRef<MeshStandardMaterial>(null!)
  const powerHalo = useRef<SpriteMaterial>(null!)
  const hddHalo = useRef<SpriteMaterial>(null!)
  const mhzMat = useRef<MeshBasicMaterial>(null!)

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    const powered = useSystem.getState().power !== 'off'

    if (powered) {
      powerLed.current.emissive.set(P.ledGreen)
      powerHalo.current.color.set(P.ledGreen)
      powerLed.current.emissiveIntensity = 1.8
      // pseudo-random disk chatter
      const n = Math.sin(Math.floor(t * 12.7) * 947.31) * 0.5 + 0.5
      hddLed.current.emissiveIntensity = n > 0.62 ? 1.6 : 0.04
    } else {
      // standby heartbeat — the blink that keeps the dark room alive
      powerLed.current.emissive.set(P.amber)
      powerHalo.current.color.set(P.amber)
      powerLed.current.emissiveIntensity =
        0.25 + Math.max(0, Math.sin(t * 2.1)) ** 6 * 1.3
      hddLed.current.emissiveIntensity = 0
    }
    powerHalo.current.opacity = powerLed.current.emissiveIntensity * 0.28
    hddHalo.current.opacity = hddLed.current.emissiveIntensity * 0.28
    mhzMat.current.opacity = MathUtils.damp(
      mhzMat.current.opacity,
      powered ? 1 : 0.08,
      6,
      dt,
    )
  })

  return (
    <group position={[0, 0.02, 0]}>
      {/* power + hdd LEDs */}
      <mesh position={[-0.07, 0, PANEL_FACE]}>
        <roundedBoxGeometry args={rb(0.01, 0.006, 0.003)} />
        <meshStandardMaterial
          ref={powerLed}
          color="#2e2416"
          emissive={P.amber}
          emissiveIntensity={0.3}
        />
      </mesh>
      <mesh position={[-0.045, 0, PANEL_FACE]}>
        <roundedBoxGeometry args={rb(0.01, 0.006, 0.003)} />
        <meshStandardMaterial
          ref={hddLed}
          color="#33150f"
          emissive={P.ledRed}
          emissiveIntensity={0}
        />
      </mesh>
      <Halo
        ref={powerHalo}
        color={P.amber}
        size={0.03}
        intensity={0.1}
        position={[-0.07, 0, PANEL_FACE + 0.004]}
      />
      <Halo
        ref={hddHalo}
        color={P.ledRed}
        size={0.026}
        intensity={0}
        position={[-0.045, 0, PANEL_FACE + 0.004]}
      />
      {/* recessed MHz readout */}
      <mesh position={[0.045, 0, PANEL_FACE - 0.001]}>
        <roundedBoxGeometry args={rb(0.062, 0.02, 0.004)} />
        <meshStandardMaterial color="#0a0d0a" roughness={0.5} />
      </mesh>
      <mesh position={[0.045, 0, PANEL_FACE + 0.0015]}>
        <planeGeometry args={[0.05, 0.013]} />
        <meshBasicMaterial
          ref={mhzMat}
          map={mhzTex}
          transparent
          opacity={0.08}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

/* ---------- power button (easter egg: boots the machine) ---------- */
function PowerButton({
  enabled,
  onPower,
}: {
  enabled: boolean
  onPower: () => void
}) {
  const btn = useRef<Group>(null!)
  const pressed = useRef(0)

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    pressed.current = MathUtils.damp(pressed.current, 0, 10, dt)
    btn.current.position.z = PANEL_FACE + 0.006 - pressed.current * 0.006
  })

  return (
    <Clickable
      enabled={enabled}
      label="power"
      onActivate={() => {
        pressed.current = 1
        playClick()
        onPower()
      }}
    >
      {/* surround ring */}
      <mesh position={[0.055, -0.09, PANEL_FACE]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.021, 0.021, 0.006, 20]} />
        <meshStandardMaterial color={P.plasticDark} roughness={0.8} />
      </mesh>
      <group ref={btn} position={[0.055, -0.09, PANEL_FACE + 0.006]}>
        <mesh rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.0145, 0.0145, 0.011, 20]} />
          <meshStandardMaterial color={P.chassis} roughness={0.6} />
        </mesh>
        {/* embossed power dot */}
        <mesh position={[0, 0, 0.006]}>
          <circleGeometry args={[0.004, 12]} />
          <meshStandardMaterial color={P.chassisDarker} roughness={0.7} />
        </mesh>
      </group>
    </Clickable>
  )
}

/* ---------- intake fan, spins while powered ---------- */
function Fan() {
  const blades = useRef<Group>(null!)
  const speed = useRef(0)

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const powered = useSystem.getState().power !== 'off'
    speed.current = MathUtils.damp(speed.current, powered ? 16 : 0, 1.6, dt)
    blades.current.rotation.z -= speed.current * dt
  })

  return (
    <group position={[-0.05, -0.155, 0]}>
      {/* dark recess */}
      <mesh position={[0, 0, PANEL_FACE - 0.002]}>
        <circleGeometry args={[0.037, 20]} />
        <meshStandardMaterial color="#0e0f10" roughness={0.9} />
      </mesh>
      {/* blades */}
      <group ref={blades} position={[0, 0, PANEL_FACE + 0.0005]}>
        <mesh>
          <cylinderGeometry args={[0.008, 0.008, 0.004, 10]} />
          <meshStandardMaterial color={P.plasticDark} roughness={0.8} />
        </mesh>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2
          return (
            <mesh
              key={i}
              rotation-z={a - Math.PI / 2 + 0.35}
              position={[Math.cos(a) * 0.019, Math.sin(a) * 0.019, 0]}
            >
              <roundedBoxGeometry args={rb(0.011, 0.03, 0.002)} />
              <meshStandardMaterial color="#26282c" roughness={0.7} />
            </mesh>
          )
        })}
      </group>
      {/* grille bars */}
      {[-0.018, 0, 0.018].map((y) => (
        <mesh key={y} position={[0, y, PANEL_FACE + 0.004]}>
          <roundedBoxGeometry args={rb(0.074, 0.005, 0.002)} />
          <meshStandardMaterial color={P.chassis} roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}
