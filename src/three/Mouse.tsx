import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import { MathUtils, type Group } from 'three'
import { useSystem } from '../os/store'
import { DESK_TOP, P } from './layout'
import { makeSoftCircle } from './textures'

/** The mouse lives on render layer 1: the desk's baked ContactShadows
    (a layer-0 ortho camera) must not freeze a blob at its rest position
    while the live mouse glides away. The main camera and the lamp's
    shadow camera enable layer 1 (Lamp.tsx); its own shadow travels with
    it as a soft dark disc. */
export const MOUSE_LAYER = 1

/* =====================================================================
   The beige two-button mouse, alive on its pad: in room view it glides
   around mirroring YOUR cursor (clamped to the pad), with a little yaw
   into the direction of travel. When you zoom into the screen it drifts
   politely back to rest. Rendered desk-local (inside the Desk group).
   ===================================================================== */

const LIM_X = 0.072 // pad-local travel limits
const LIM_Z = 0.056

export default function Mouse() {
  const body = useRef<Group>(null!)
  const prevX = useRef(0)
  const camera = useThree((s) => s.camera)
  const shadowTex = useMemo(() => makeSoftCircle(), [])
  useEffect(() => () => shadowTex.dispose(), [shadowTex])

  useLayoutEffect(() => {
    camera.layers.enable(MOUSE_LAYER)
    body.current.traverse((o) => o.layers.set(MOUSE_LAYER))
  }, [camera])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const inRoom = useSystem.getState().view === 'room'
    const tx = inRoom
      ? MathUtils.clamp(state.pointer.x, -1, 1) * LIM_X
      : 0.01
    const tz = inRoom
      ? MathUtils.clamp(-state.pointer.y, -1, 1) * LIM_Z
      : 0.015

    const g = body.current
    g.position.x = MathUtils.damp(g.position.x, tx, 7, dt)
    g.position.z = MathUtils.damp(g.position.z, tz, 7, dt)

    // lean into the direction of travel
    const vx = (g.position.x - prevX.current) / Math.max(dt, 1e-4)
    prevX.current = g.position.x
    g.rotation.y = MathUtils.damp(
      g.rotation.y,
      0.18 - MathUtils.clamp(vx * 2.4, -0.38, 0.38),
      6,
      dt,
    )
  })

  return (
    <group position={[0.42, DESK_TOP, 0.16]} rotation-y={-0.12}>
      {/* pad */}
      <mesh position={[0, 0.0025, 0]} receiveShadow>
        <boxGeometry args={[0.24, 0.005, 0.2]} />
        <meshStandardMaterial color="#173735" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.0055, 0]}>
        <boxGeometry args={[0.22, 0.001, 0.18]} />
        <meshStandardMaterial color="#1d4341" roughness={0.95} />
      </mesh>

      {/* two-button beige mouse */}
      <group ref={body} position={[0.01, 0.006, 0.015]} rotation-y={0.18}>
        {/* its contact shadow, riding along underneath */}
        <mesh position={[0, 0.0004, 0.004]} rotation-x={-Math.PI / 2} renderOrder={-1}>
          <planeGeometry args={[0.09, 0.13]} />
          <meshBasicMaterial
            map={shadowTex}
            color="#000000"
            transparent
            opacity={0.5}
            depthWrite={false}
          />
        </mesh>
        <RoundedBox
          args={[0.06, 0.03, 0.1]}
          radius={0.013}
          smoothness={3}
          position={[0, 0.015, 0]}
          castShadow
        >
          <meshStandardMaterial color={P.chassis} roughness={0.6} />
        </RoundedBox>
        {/* button seam */}
        <mesh position={[0, 0.028, -0.026]}>
          <boxGeometry args={[0.054, 0.004, 0.002]} />
          <meshStandardMaterial color={P.chassisDarker} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.0285, -0.036]} rotation-x={-0.25}>
          <boxGeometry args={[0.002, 0.004, 0.024]} />
          <meshStandardMaterial color={P.chassisDarker} roughness={0.7} />
        </mesh>
        {/* tail */}
        <mesh position={[0, 0.012, -0.055]} rotation-x={0.5}>
          <cylinderGeometry args={[0.0028, 0.0028, 0.03, 6]} />
          <meshStandardMaterial color={P.cable} roughness={0.9} />
        </mesh>
      </group>
    </group>
  )
}
