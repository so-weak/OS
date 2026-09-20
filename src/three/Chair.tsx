import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MathUtils, type Group } from 'three'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import { useWorld } from '../world'
import Clickable from './Clickable'
import { P } from './layout'
import { rb } from './rbox'

/* =====================================================================
   The desk chair. Extracted from Room.tsx so it can be modelled properly
   on its own (it owns its file). Easter egg: click it and it spins on an
   underdamped swivel; it marks the ledger's `chair`.
   ===================================================================== */

/* ---------- desk chair (invented egg: click it and it spins) ---------- */
export default function Chair() {
  const view = useSystem((s) => s.view)
  const rig = useRef<Group>(null!)
  const spin = useRef({ x: 0, v: 0, target: 0 })

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    // underdamped swivel — overshoots, wobbles, settles
    const sp = spin.current
    sp.v += (26 * (sp.target - sp.x) - 4.2 * sp.v) * dt
    sp.x += sp.v * dt
    const g = rig.current
    g.rotation.y = sp.x
    // centrifugal lean while it whips around
    g.rotation.z = MathUtils.clamp(sp.v * 0.01, -0.05, 0.05)
  })

  return (
    /* Parked left of the paperwork on purpose: from the room camera the
       chair back sits in the gap between the bookcase and the desk props
       (paper stack, crumpled shots), so it occludes neither. */
    <group position={[-0.58, 0, -0.02]} rotation-y={0.35}>
      <Clickable
        enabled={view === 'room'}
        label="quality assurance seat"
        onActivate={() => {
          spin.current.target += Math.PI * 2 * (Math.random() < 0.3 ? -1 : 1)
          useWorld.getState().mark('chair')
          playClick()
        }}
      >
        <group ref={rig}>
          {/* seat */}
          <mesh position={[0, 0.47, 0]} castShadow>
            <roundedBoxGeometry args={rb(0.42, 0.07, 0.4)} />
            <meshStandardMaterial color="#3a3f47" roughness={0.9} />
          </mesh>
          {/* backrest */}
          <mesh position={[0, 0.8, -0.2]} rotation-x={-0.14} castShadow>
            <roundedBoxGeometry args={rb(0.4, 0.5, 0.06)} />
            <meshStandardMaterial color="#3a3f47" roughness={0.9} />
          </mesh>
        </group>
      </Clickable>
      {/* gas post */}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.024, 0.03, 0.32, 10]} />
        <meshStandardMaterial color={P.metal} metalness={0.5} roughness={0.5} />
      </mesh>
      {/* star base */}
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2
        return (
          <group key={i} rotation-y={a}>
            <mesh position={[0.14, 0.05, 0]} rotation-z={-0.18}>
              <roundedBoxGeometry args={rb(0.26, 0.03, 0.04)} />
              <meshStandardMaterial
                color="#23262b"
                metalness={0.4}
                roughness={0.6}
              />
            </mesh>
            <mesh position={[0.26, 0.025, 0]}>
              <sphereGeometry args={[0.024, 10, 8]} />
              <meshStandardMaterial color="#17181c" roughness={0.7} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
