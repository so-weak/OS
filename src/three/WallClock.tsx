import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import { useWorld } from '../world'
import Clickable from './Clickable'
import { P } from './layout'
import { makeLabel } from './textures'
import { makeClockFace } from './windowArt'
import { rb } from './rbox'

/* =====================================================================
   The wall clock — the diegetic reason the light follows a clock the
   visitor may not share. It keeps Bengaluru time (useWorld.hour; the
   seconds are the same everywhere) above the monitor, between the two
   posters, with a brass plate that says where it is. The second hand
   ticks: quantised per second with a small overshoot spring, like the
   CRT knobs. Three rotations a frame; nothing else.
   ===================================================================== */

const TAU = Math.PI * 2
const POS: [number, number, number] = [0.0, 1.6, -1.066]
const R = 0.11

export default function WallClock() {
  const view = useSystem((s) => s.view)
  const face = useMemo(() => makeClockFace(), [])
  const plate = useMemo(
    () => makeLabel('BENGALURU', '#2a2012', '#b08d4a', 4, 3),
    [],
  )
  useEffect(
    () => () => {
      face.dispose()
      plate.dispose()
    },
    [face, plate],
  )

  const hour = useRef<Group>(null!)
  const minute = useRef<Group>(null!)
  const second = useRef<Group>(null!)
  const spring = useRef({ x: 0, v: 0 })

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const h = useWorld.getState().hour
    hour.current.rotation.z = -((h % 12) / 12) * TAU
    minute.current.rotation.z = -((h % 1) * 1) * TAU

    // the second hand: snap to the second, overshoot, settle
    const target = ((Math.floor(Date.now() / 1000) % 60) / 60) * TAU
    const sp = spring.current
    if (target < sp.x - Math.PI) sp.x -= TAU // wrapped past 12
    sp.v += (900 * (target - sp.x) - 42 * sp.v) * dt
    sp.x += sp.v * dt
    second.current.rotation.z = -sp.x
  })

  return (
    <group position={POS}>
      <Clickable
        enabled={view === 'room'}
        label="the desk's clock"
        onActivate={() => playClick()}
      >
        {/* case */}
        <mesh position={[0, 0, 0.014]} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[R, R, 0.028, 40]} />
          <meshStandardMaterial color="#1e2024" roughness={0.6} metalness={0.2} />
        </mesh>
        {/* dial */}
        <mesh position={[0, 0, 0.0285]}>
          <circleGeometry args={[R - 0.012, 40]} />
          <meshStandardMaterial map={face} roughness={0.85} />
        </mesh>
        {/* hands pivot at the centre; each is offset so it points up at 0 */}
        <group ref={hour} position={[0, 0, 0.031]}>
          <mesh position={[0, 0.022, 0]}>
            <roundedBoxGeometry args={rb(0.008, 0.058, 0.002)} />
            <meshStandardMaterial color="#1a1812" roughness={0.6} />
          </mesh>
        </group>
        <group ref={minute} position={[0, 0, 0.0335]}>
          <mesh position={[0, 0.034, 0]}>
            <roundedBoxGeometry args={rb(0.006, 0.084, 0.002)} />
            <meshStandardMaterial color="#1a1812" roughness={0.6} />
          </mesh>
        </group>
        <group ref={second} position={[0, 0, 0.036]}>
          <mesh position={[0, 0.03, 0]}>
            <roundedBoxGeometry args={rb(0.0022, 0.1, 0.0015)} />
            <meshStandardMaterial color={P.ledRed} roughness={0.5} />
          </mesh>
          {/* counterweight */}
          <mesh position={[0, -0.018, 0]}>
            <roundedBoxGeometry args={rb(0.005, 0.014, 0.0015)} />
            <meshStandardMaterial color={P.ledRed} roughness={0.5} />
          </mesh>
        </group>
        {/* pivot cap */}
        <mesh position={[0, 0, 0.037]}>
          <sphereGeometry args={[0.005, 10, 8]} />
          <meshStandardMaterial color="#b08d4a" metalness={0.7} roughness={0.35} />
        </mesh>
        {/* the brass plate: where this clock lives */}
        <mesh position={[0, -R - 0.024, 0.004]}>
          <roundedBoxGeometry args={rb(0.1, 0.02, 0.006)} />
          <meshStandardMaterial color="#8d7038" metalness={0.75} roughness={0.4} />
        </mesh>
        <mesh position={[0, -R - 0.024, 0.0075]}>
          <planeGeometry args={[0.092, 0.0164]} />
          <meshStandardMaterial map={plate} roughness={0.5} metalness={0.3} />
        </mesh>
      </Clickable>
    </group>
  )
}
