import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  MathUtils,
  Object3D,
  type MeshStandardMaterial,
  type PointLight,
  type SpotLight,
} from 'three'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import Clickable from './Clickable'
import { DESK_TOP, P } from './layout'
import { useRoom } from './roomState'

/* =====================================================================
   Articulated desk lamp — the room's main warm light and an easter
   egg: clicking it snaps the light off and the whole mood changes.
   Intensity is damped, so it swells on rather than popping.
   ===================================================================== */

const WARM = '#ffb763'

// arm joints in lamp-local space (x leans over the desk)
const ELBOW: [number, number, number] = [0.089, 0.244, 0]
const HEAD: [number, number, number] = [0.305, 0.205, 0]

export default function Lamp() {
  const view = useSystem((s) => s.view)
  const lampOn = useRoom((s) => s.lampOn)
  const toggleLamp = useRoom((s) => s.toggleLamp)

  const spot = useRef<SpotLight>(null!)
  const spill = useRef<PointLight>(null!)
  const bulbMat = useRef<MeshStandardMaterial>(null!)
  const level = useRef(1)

  const target = useMemo(() => {
    const o = new Object3D()
    o.position.set(0.62, 0, 0.12)
    return o
  }, [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    level.current = MathUtils.damp(level.current, lampOn ? 1 : 0, 7, dt)
    spot.current.intensity = level.current * 3.2
    spill.current.intensity = level.current * 0.55
    bulbMat.current.emissiveIntensity = level.current * 2.4
  })

  return (
    <group position={[-0.55, DESK_TOP, -0.78]} rotation-y={-0.4}>
      <Clickable
        enabled={view === 'room'}
        label="mood lighting"
        onActivate={() => {
          playClick()
          toggleLamp()
        }}
      >
        {/* weighted base */}
        <mesh position={[0, 0.011, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.06, 0.022, 18]} />
          <meshStandardMaterial color={P.plasticDark} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.026, 0]}>
          <cylinderGeometry args={[0.018, 0.026, 0.012, 12]} />
          <meshStandardMaterial color={P.metal} metalness={0.5} roughness={0.5} />
        </mesh>

        {/* lower arm */}
        <mesh
          position={[ELBOW[0] / 2, 0.02 + (ELBOW[1] - 0.02) / 2, 0]}
          rotation-z={-0.35}
          castShadow
        >
          <cylinderGeometry args={[0.0068, 0.0068, 0.245, 8]} />
          <meshStandardMaterial color={P.metal} metalness={0.55} roughness={0.45} />
        </mesh>
        {/* upper arm */}
        <mesh
          position={[
            (ELBOW[0] + HEAD[0]) / 2,
            (ELBOW[1] + HEAD[1]) / 2,
            0,
          ]}
          rotation-z={-1.75}
          castShadow
        >
          <cylinderGeometry args={[0.006, 0.006, 0.22, 8]} />
          <meshStandardMaterial color={P.metal} metalness={0.55} roughness={0.45} />
        </mesh>
        {/* joints */}
        {[[0, 0.03, 0] as const, ELBOW, HEAD].map((p, i) => (
          <mesh key={i} position={[p[0], p[1], p[2]]}>
            <sphereGeometry args={[0.0125, 10, 8]} />
            <meshStandardMaterial color={P.plasticDark} roughness={0.55} />
          </mesh>
        ))}

        {/* shade + bulb, aimed down across the desk */}
        <group position={HEAD} rotation-z={-0.96}>
          <mesh castShadow>
            <cylinderGeometry args={[0.016, 0.052, 0.085, 14, 1, true]} />
            <meshStandardMaterial
              color="#245c48"
              roughness={0.45}
              metalness={0.25}
            />
          </mesh>
          <mesh position={[0, -0.028, 0]}>
            <sphereGeometry args={[0.019, 12, 10]} />
            <meshStandardMaterial
              ref={bulbMat}
              color="#fff4dc"
              emissive={WARM}
              emissiveIntensity={2.4}
              toneMapped={false}
            />
          </mesh>
        </group>
      </Clickable>

      {/* the light itself (outside Clickable so raycasts stay cheap) */}
      <primitive object={target} />
      <spotLight
        ref={spot}
        position={[HEAD[0], HEAD[1] - 0.02, HEAD[2]]}
        target={target}
        color={WARM}
        intensity={3.2}
        angle={0.72}
        penumbra={0.55}
        distance={3.2}
        decay={1.8}
        castShadow
        shadow-mapSize={[512, 512]}
        shadow-bias={-0.002}
      />
      <pointLight
        ref={spill}
        position={[HEAD[0], HEAD[1] + 0.05, HEAD[2]]}
        color={WARM}
        intensity={0.55}
        distance={2.4}
        decay={2}
      />
    </group>
  )
}
