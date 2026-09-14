import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  MathUtils,
  MeshStandardMaterial,
  Object3D,
  type CanvasTexture,
  type Group,
} from 'three'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import Clickable from './Clickable'
import { P } from './layout'
import {
  makeFloppyPoster,
  makeRocketPoster,
  makeWallNoise,
  makeWood,
} from './textures'

/* =====================================================================
   The dark cozy room: walls, floor, rug, posters, shelf with books,
   chair, baseboards, wall socket. Static decor only — interactive props
   live in their own files, and the window (the room's one scenery
   control) lives in Window.tsx.
   ===================================================================== */

export default function Room() {
  const floorTex = useMemo(() => {
    const t = makeWood(P.floorWood, '#2c1d12', 3)
    t.repeat.set(3, 2.6)
    return t
  }, [])
  const wallTex = useMemo(() => {
    const t = makeWallNoise(P.wallA)
    t.repeat.set(4, 3)
    return t
  }, [])

  useEffect(
    () => () => {
      floorTex.dispose()
      wallTex.dispose()
    },
    [floorTex, wallTex],
  )

  return (
    <group>
      {/* floor */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0.1, 0, 0.35]}
        receiveShadow
      >
        <planeGeometry args={[4.6, 3.9]} />
        <meshStandardMaterial map={floorTex} roughness={0.92} />
      </mesh>

      {/* rug */}
      <mesh rotation-x={-Math.PI / 2} position={[-0.42, 0.004, 0.28]}>
        <circleGeometry args={[0.58, 32]} />
        <meshStandardMaterial color="#1d3a38" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[-0.42, 0.006, 0.28]}>
        <circleGeometry args={[0.4, 32]} />
        <meshStandardMaterial color="#16302e" roughness={1} />
      </mesh>

      {/* back wall */}
      <mesh position={[0.1, 1.3, -1.08]} receiveShadow>
        <planeGeometry args={[4.6, 2.6]} />
        <meshStandardMaterial map={wallTex} roughness={0.96} />
      </mesh>
      {/* left wall */}
      <mesh
        position={[-2.05, 1.3, 0.35]}
        rotation-y={Math.PI / 2}
        receiveShadow
      >
        <planeGeometry args={[3.9, 2.6]} />
        <meshStandardMaterial color="#272b35" roughness={0.96} />
      </mesh>
      {/* right wall */}
      <mesh
        position={[2.25, 1.3, 0.35]}
        rotation-y={-Math.PI / 2}
        receiveShadow
      >
        <planeGeometry args={[3.9, 2.6]} />
        <meshStandardMaterial color="#272b35" roughness={0.96} />
      </mesh>
      {/* ceiling */}
      <mesh position={[0.1, 2.6, 0.35]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[4.6, 3.9]} />
        <meshStandardMaterial color="#181b22" roughness={1} />
      </mesh>

      {/* baseboard along back wall */}
      <mesh position={[0.1, 0.045, -1.065]}>
        <boxGeometry args={[4.6, 0.09, 0.02]} />
        <meshStandardMaterial color="#201f24" roughness={0.85} />
      </mesh>

      <Poster kind="rocket" position={[-0.5, 1.5, -1.07]} w={0.32} h={0.42} tilt={-0.012} />
      <Poster kind="floppy" position={[0.52, 1.56, -1.07]} w={0.24} h={0.32} tilt={0.02} />
      <Shelf />
      <Chair />
      <WallSocket />
    </group>
  )
}

/* ---------- posters ---------- */
function Poster({
  kind,
  position,
  w,
  h,
  tilt = 0,
}: {
  kind: 'rocket' | 'floppy'
  position: [number, number, number]
  w: number
  h: number
  tilt?: number
}) {
  const tex: CanvasTexture = useMemo(
    () => (kind === 'rocket' ? makeRocketPoster() : makeFloppyPoster()),
    [kind],
  )
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <group position={position} rotation-z={tilt}>
      <mesh position={[0, 0, -0.004]}>
        <boxGeometry args={[w + 0.02, h + 0.02, 0.012]} />
        <meshStandardMaterial color="#141519" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.004]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial
          map={tex}
          emissive="#ffffff"
          emissiveMap={tex}
          emissiveIntensity={0.14}
          roughness={0.9}
        />
      </mesh>
    </group>
  )
}

/* ---------- shelf with books, binders and a tiny trophy ---------- */
const BOOK_COLORS = [
  '#7a3b2e',
  '#31504a',
  '#8a6d3b',
  '#26364a',
  '#5b3a56',
  '#3d5a2e',
  '#a0522d',
  '#264a44',
  '#6e4a24',
  '#413a5e',
]

function Shelf() {
  const books = useMemo(() => buildBooks(), [])
  useEffect(
    () => () => {
      books.geometry.dispose()
      ;(books.material as MeshStandardMaterial).dispose()
    },
    [books],
  )

  return (
    <group position={[1.14, 1.52, -0.97]}>
      {/* board */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.68, 0.026, 0.21]} />
        <meshStandardMaterial color={P.deskWood} roughness={0.85} />
      </mesh>
      {/* brackets */}
      {[-0.26, 0.26].map((x) => (
        <mesh key={x} position={[x, -0.05, -0.06]}>
          <boxGeometry args={[0.02, 0.08, 0.08]} />
          <meshStandardMaterial color={P.metal} roughness={0.6} metalness={0.4} />
        </mesh>
      ))}
      <primitive object={books} position={[-0.31, 0.013, 0]} />
      {/* two fat binders */}
      <mesh position={[0.11, 0.098, -0.01]} rotation-y={0.04} castShadow>
        <boxGeometry args={[0.052, 0.17, 0.15]} />
        <meshStandardMaterial color="#8c2f26" roughness={0.85} />
      </mesh>
      <mesh position={[0.168, 0.098, 0]} castShadow>
        <boxGeometry args={[0.052, 0.17, 0.15]} />
        <meshStandardMaterial color="#274a68" roughness={0.85} />
      </mesh>
      {/* label strips on binder spines */}
      {[0.11, 0.168].map((x) => (
        <mesh key={x} position={[x, 0.12, 0.076]}>
          <planeGeometry args={[0.032, 0.05]} />
          <meshStandardMaterial color="#eceadf" roughness={0.9} />
        </mesh>
      ))}
      {/* tiny amber trophy */}
      <group position={[0.28, 0.013, 0.02]}>
        <mesh castShadow>
          <boxGeometry args={[0.045, 0.018, 0.045]} />
          <meshStandardMaterial color="#2e2a26" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.028, 0]}>
          <cylinderGeometry args={[0.006, 0.009, 0.03, 8]} />
          <meshStandardMaterial
            color={P.amber}
            metalness={0.7}
            roughness={0.35}
          />
        </mesh>
        <mesh position={[0, 0.055, 0]}>
          <sphereGeometry args={[0.016, 12, 10]} />
          <meshStandardMaterial
            color={P.amber}
            metalness={0.7}
            roughness={0.35}
            emissive={P.amber}
            emissiveIntensity={0.08}
          />
        </mesh>
      </group>
      {/* spare floppy stack */}
      <group position={[-0.02, 0.02, 0.05]} rotation-y={-0.3}>
        <mesh castShadow>
          <boxGeometry args={[0.09, 0.007, 0.093]} />
          <meshStandardMaterial color="#2b3a8c" roughness={0.8} />
        </mesh>
        <mesh position={[0.006, 0.008, -0.004]} rotation-y={0.18}>
          <boxGeometry args={[0.09, 0.007, 0.093]} />
          <meshStandardMaterial color="#3a3d42" roughness={0.8} />
        </mesh>
      </group>
    </group>
  )
}

function buildBooks(): InstancedMesh {
  const geo = new BoxGeometry(1, 1, 1)
  const mat = new MeshStandardMaterial({ roughness: 0.88 })
  const mesh = new InstancedMesh(geo, mat, BOOK_COLORS.length)
  const dummy = new Object3D()
  const color = new Color()
  let x = 0
  BOOK_COLORS.forEach((c, i) => {
    const w = 0.024 + ((i * 7) % 5) * 0.004
    const h = 0.13 + ((i * 5) % 7) * 0.009
    const d = 0.14 + ((i * 3) % 4) * 0.008
    const lean = i === BOOK_COLORS.length - 1 ? 0.32 : 0
    dummy.position.set(x + w / 2, h / 2 + (lean ? -0.012 : 0), 0)
    dummy.rotation.set(0, 0, lean)
    dummy.scale.set(w, h, d)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    mesh.setColorAt(i, color.set(c))
    x += w + 0.003
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = true
  return mesh
}

/* ---------- desk chair (invented egg: click it and it spins) ---------- */
function Chair() {
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
          playClick()
        }}
      >
        <group ref={rig}>
          {/* seat */}
          <mesh position={[0, 0.47, 0]} castShadow>
            <boxGeometry args={[0.42, 0.07, 0.4]} />
            <meshStandardMaterial color="#3a3f47" roughness={0.9} />
          </mesh>
          {/* backrest */}
          <mesh position={[0, 0.8, -0.2]} rotation-x={-0.14} castShadow>
            <boxGeometry args={[0.4, 0.5, 0.06]} />
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
              <boxGeometry args={[0.26, 0.03, 0.04]} />
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

/* ---------- wall socket the machine plugs into ---------- */
function WallSocket() {
  return (
    <group position={[0.72, 0.22, -1.066]}>
      <mesh>
        <boxGeometry args={[0.09, 0.13, 0.014]} />
        <meshStandardMaterial color={P.chassisDark} roughness={0.85} />
      </mesh>
      {[0.028, -0.028].map((y) => (
        <mesh key={y} position={[0, y, 0.008]}>
          <boxGeometry args={[0.05, 0.045, 0.006]} />
          <meshStandardMaterial color={P.plasticDark} roughness={0.8} />
        </mesh>
      ))}
    </group>
  )
}
