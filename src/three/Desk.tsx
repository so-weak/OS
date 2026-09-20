import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import {
  CatmullRomCurve3,
  TubeGeometry,
  Vector3,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
} from 'three'
import { identity } from '../data/resume'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import Clickable from './Clickable'
import Halo from './Halo'
import Mouse from './Mouse'
import { DESK, DESK_TOP, P } from './layout'
import {
  disposeSurface,
  makeLabelLines,
  makeSoftCircle,
  makeWoodMaps,
  repeatSurface,
} from './textures'
import { rb } from './rbox'

/* =====================================================================
   The desk itself plus desk props: the live mouse + pad, a coffee mug
   that steams (and jiggles when poked), and the cable runs that tie the
   hardware together. The drawer pedestal lives in Drawers.tsx; the
   paper stack in Papers.tsx.
   ===================================================================== */

export default function Desk() {
  const gl = useThree((s) => s.gl)
  const aniso = gl.capabilities.getMaxAnisotropy()
  const wood = useMemo(
    () => repeatSurface(makeWoodMaps(P.deskWood, '#3d2a18', 9, aniso), 2, 1),
    [aniso],
  )
  useEffect(() => () => disposeSurface(wood), [wood])

  const legX = DESK.w / 2 - 0.06
  const legY = (DESK_TOP - DESK.thick) / 2

  return (
    <group position={[DESK.x, 0, DESK.z]}>
      {/* top */}
      <mesh position={[0, DESK_TOP - DESK.thick / 2, 0]} castShadow receiveShadow>
        <roundedBoxGeometry args={rb(DESK.w, DESK.thick, DESK.d)} />
        <meshStandardMaterial
          map={wood.map}
          bumpMap={wood.bumpMap}
          bumpScale={0.002}
          roughnessMap={wood.roughnessMap}
          roughness={0.85}
        />
      </mesh>
      {/* contact darkening under the desk props (monitor base, keyboard,
          mouse pad, mug, papers). Baked once — frames=1, never Infinity
          (agreed in review); renderOrder -1 keeps it under the paper. */}
      <ContactShadows
        frames={1}
        position={[0, DESK_TOP + 0.0005, 0]}
        scale={[DESK.w, DESK.d]}
        resolution={512}
        blur={1.6}
        far={0.45}
        opacity={0.5}
        renderOrder={-1}
      />
      {/* side panels */}
      {[-legX, legX].map((x) => (
        <mesh key={x} position={[x, legY, 0]} castShadow>
          <roundedBoxGeometry args={rb(0.05, DESK_TOP - DESK.thick, DESK.d - 0.08)} />
          <meshStandardMaterial color="#503620" roughness={0.85} />
        </mesh>
      ))}
      {/* back modesty panel */}
      <mesh position={[0, legY + 0.1, -DESK.d / 2 + 0.05]}>
        <roundedBoxGeometry args={rb(DESK.w - 0.14, DESK_TOP - 0.25, 0.025)} />
        <meshStandardMaterial color="#463017" roughness={0.9} />
      </mesh>

      <Mouse />
      <Mug />
      <Nameplate />
    </group>
  )
}

/* ---------- brass nameplate at the front edge (U-P3) ---------- */
const NAME_TITLE = 'AI / ML ENGINEER' // identity.title, abbreviated to fit

function Nameplate() {
  const tex = useMemo(
    () =>
      makeLabelLines(
        [identity.name.toUpperCase(), NAME_TITLE],
        '#2a1c08',
        '#d4ad55',
        4,
        6,
        3.6,
      ),
    [],
  )
  useEffect(() => () => tex.dispose(), [tex])

  /* desk-local: front edge inside the lamp's pool, between the paperwork
     and the keyboard, so it reads at night too (the right side is dark) */
  return (
    <group position={[-0.33, DESK_TOP, 0.28]} rotation-y={0.1}>
      {/* base bar */}
      <mesh position={[0, 0.004, 0]} castShadow>
        <roundedBoxGeometry args={rb(0.2, 0.008, 0.032)} />
        <meshStandardMaterial color="#8a6a2c" metalness={0.85} roughness={0.32} />
      </mesh>
      {/* the plate, hinged at its foot and leaning back */}
      <group position={[0, 0.008, -0.006]} rotation-x={-0.42}>
        <mesh position={[0, 0.0275, 0]} castShadow>
          <roundedBoxGeometry args={rb(0.2, 0.055, 0.004)} />
          <meshStandardMaterial color="#b8913f" metalness={0.85} roughness={0.28} />
        </mesh>
        {/* enamelled face, not bare metal, so the fill light reads it */}
        <mesh position={[0, 0.0275, 0.0021]}>
          <planeGeometry args={[0.19, 0.0528]} />
          <meshStandardMaterial map={tex} metalness={0.15} roughness={0.45} />
        </mesh>
      </group>
    </group>
  )
}

/* ---------- coffee mug: steams gently, jiggles when poked ---------- */
const PUFFS = 4

function Mug() {
  const view = useSystem((s) => s.view)
  const rig = useRef<Group>(null!)
  const squash = useRef({ s: 0, v: 0 })
  const boost = useRef(0)
  const puffs = useRef<(Mesh | null)[]>(Array.from({ length: PUFFS }, () => null))

  const steamTex = useMemo(() => makeSoftCircle(), [])
  useEffect(() => () => steamTex.dispose(), [steamTex])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime

    // poke jiggle (underdamped spring)
    const sq = squash.current
    sq.v += (-110 * sq.s - 8 * sq.v) * dt
    sq.s += sq.v * dt
    rig.current.scale.set(1 - sq.s * 0.5, 1 + sq.s, 1 - sq.s * 0.5)

    boost.current = Math.max(0, boost.current - dt / 1.4)

    // steam puffs — loop upward, sway, fade; billboarded to the camera
    puffs.current.forEach((m, i) => {
      if (!m) return
      const cycle = (t * (0.22 + i * 0.045) + i * 0.37) % 1
      m.position.set(
        Math.sin(cycle * 6.1 + i * 1.7) * 0.009,
        0.1 + cycle * 0.13,
        Math.cos(cycle * 5.3 + i) * 0.006,
      )
      const s = 0.014 + cycle * 0.03
      m.scale.set(s, s, s)
      m.quaternion.copy(state.camera.quaternion)
      const mat = m.material as MeshBasicMaterial
      mat.opacity = (1 - cycle) * cycle * 4 * (0.1 + boost.current * 0.5)
    })
  })

  return (
    <group position={[0.6, DESK_TOP, -0.1]}>
      <Clickable
        enabled={view === 'room'}
        label="80 percent coffee"
        onActivate={() => {
          squash.current.v = -1.6
          boost.current = 1
          playClick()
        }}
      >
        <group ref={rig}>
          <mesh position={[0, 0.045, 0]} castShadow>
            <cylinderGeometry args={[0.035, 0.032, 0.09, 14]} />
            <meshStandardMaterial color="#a63c2e" roughness={0.5} />
          </mesh>
          {/* coffee */}
          <mesh position={[0, 0.0895, 0]} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[0.03, 14]} />
            <meshStandardMaterial color="#22140c" roughness={0.3} />
          </mesh>
          {/* handle */}
          <mesh position={[0.042, 0.048, 0]} rotation-y={Math.PI / 2}>
            <torusGeometry args={[0.02, 0.005, 8, 14, Math.PI]} />
            <meshStandardMaterial color="#a63c2e" roughness={0.5} />
          </mesh>
        </group>
      </Clickable>

      {/* steam (outside the jiggle rig so it keeps rising) */}
      {Array.from({ length: PUFFS }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            puffs.current[i] = el
          }}
          position={[0, 0.11, 0]}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={steamTex}
            color="#cfd8e8"
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

/* ---------- cables ---------- */
export function Cables() {
  return (
    <group>
      {/* monitor -> tower */}
      <Cable
        points={[
          [0.02, 0.95, -0.9],
          [0.3, 0.78, -1.0],
          [0.68, 0.32, -1.02],
          [1.02, 0.16, -0.85],
        ]}
      />
      {/* keyboard -> back of desk */}
      <Cable
        points={[
          [0.16, 0.75, -0.47],
          [0.28, 0.755, -0.75],
          [0.22, 0.6, -0.98],
          [0.5, 0.22, -1.0],
        ]}
        radius={0.004}
      />
      {/* lamp cord dropping behind the desk to the power strip */}
      <Cable
        points={[
          [-0.58, 0.75, -0.88],
          [-0.68, 0.42, -1.0],
          [-0.62, 0.06, -1.02],
          [-0.42, 0.035, -1.0],
        ]}
        radius={0.004}
      />
      {/* strip -> wall socket */}
      <Cable
        points={[
          [-0.32, 0.035, -1.02],
          [0.2, 0.03, -1.05],
          [0.72, 0.16, -1.06],
        ]}
        radius={0.005}
      />
      <PowerStrip />
    </group>
  )
}

function Cable({
  points,
  radius = 0.006,
}: {
  points: [number, number, number][]
  radius?: number
}) {
  const geo = useMemo(() => {
    const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)))
    return new TubeGeometry(curve, 48, radius, 6, false)
  }, [points, radius])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={P.cable} roughness={0.9} />
    </mesh>
  )
}

function PowerStrip() {
  return (
    <group position={[-0.42, 0.022, -1.0]} rotation-y={0.12}>
      <mesh castShadow>
        <roundedBoxGeometry args={rb(0.2, 0.04, 0.07)} />
        <meshStandardMaterial color={P.chassis} roughness={0.8} />
      </mesh>
      {[-0.05, 0.01].map((x) => (
        <mesh key={x} position={[x, 0.021, 0]}>
          <roundedBoxGeometry args={rb(0.035, 0.004, 0.04)} />
          <meshStandardMaterial color={P.plasticDark} roughness={0.8} />
        </mesh>
      ))}
      {/* glowing rocker switch */}
      <mesh position={[0.075, 0.021, 0]}>
        <roundedBoxGeometry args={rb(0.02, 0.005, 0.03)} />
        <meshStandardMaterial
          color={P.ledRed}
          emissive={P.ledRed}
          emissiveIntensity={0.9}
        />
      </mesh>
      <Halo color={P.ledRed} size={0.06} intensity={0.35} position={[0.075, 0.03, 0]} />
    </group>
  )
}
