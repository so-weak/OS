import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  type CanvasTexture,
} from 'three'
import { awards, experience } from '../data/resume'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import BackWall from './BackWall'
import Chair from './Chair'
import Clickable from './Clickable'
import { P } from './layout'
import {
  disposeSurface,
  makeFloppyPoster,
  makeLabel,
  makeRocketPoster,
  makeWallMaps,
  makeWoodMaps,
  repeatSurface,
} from './textures'
import { rb } from './rbox'

/* =====================================================================
   The dark cozy room: walls, floor, rug, posters, shelf with books,
   chair, baseboards, wall socket. Static decor only — interactive props
   live in their own files, and the window (the room's one scenery
   control) lives in Window.tsx.
   ===================================================================== */

export default function Room() {
  const gl = useThree((s) => s.gl)
  const aniso = gl.capabilities.getMaxAnisotropy()
  const floor = useMemo(
    () => repeatSurface(makeWoodMaps(P.floorWood, '#2c1d12', 3, aniso), 3, 2.6),
    [aniso],
  )
  const wall = useMemo(
    () => repeatSurface(makeWallMaps(P.wallA, 11, aniso), 4, 3),
    [aniso],
  )
  const sideWall = useMemo(
    () => repeatSurface(makeWallMaps('#272b35', 12, aniso), 3.4, 3),
    [aniso],
  )

  useEffect(
    () => () => {
      disposeSurface(floor)
      disposeSurface(wall)
      disposeSurface(sideWall)
    },
    [floor, wall, sideWall],
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
        <meshStandardMaterial
          map={floor.map}
          bumpMap={floor.bumpMap}
          bumpScale={0.0025}
          roughnessMap={floor.roughnessMap}
          roughness={1}
        />
      </mesh>
      {/* baked contact darkening under everything that stands on the
          floor (chair, desk legs, tower, bin, bookcase). frames=1: one
          bake at mount. Above the rug (0.006); renderOrder -1 so it can
          never land over the lifted paper (renderOrder 50). */}
      <ContactShadows
        frames={1}
        position={[0.1, 0.008, 0.35]}
        scale={[4.6, 3.9]}
        resolution={1024}
        blur={2.5}
        far={0.6}
        opacity={0.55}
        renderOrder={-1}
      />

      {/* rug */}
      <mesh rotation-x={-Math.PI / 2} position={[-0.42, 0.004, 0.28]}>
        <circleGeometry args={[0.58, 32]} />
        <meshStandardMaterial color="#1d3a38" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[-0.42, 0.006, 0.28]}>
        <circleGeometry args={[0.4, 32]} />
        <meshStandardMaterial color="#16302e" roughness={1} />
      </mesh>

      {/* back wall (its own file: the window opening is cut there) */}
      <BackWall surface={wall} />
      {/* left wall */}
      <mesh
        position={[-2.05, 1.3, 0.35]}
        rotation-y={Math.PI / 2}
        receiveShadow
      >
        <planeGeometry args={[3.9, 2.6]} />
        <meshStandardMaterial
          map={sideWall.map}
          bumpMap={sideWall.bumpMap}
          bumpScale={0.003}
          roughnessMap={sideWall.roughnessMap}
          roughness={1}
        />
      </mesh>
      {/* right wall */}
      <mesh
        position={[2.25, 1.3, 0.35]}
        rotation-y={-Math.PI / 2}
        receiveShadow
      >
        <planeGeometry args={[3.9, 2.6]} />
        <meshStandardMaterial
          map={sideWall.map}
          bumpMap={sideWall.bumpMap}
          bumpScale={0.003}
          roughnessMap={sideWall.roughnessMap}
          roughness={1}
        />
      </mesh>
      {/* ceiling */}
      <mesh position={[0.1, 2.6, 0.35]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[4.6, 3.9]} />
        <meshStandardMaterial color="#181b22" roughness={1} />
      </mesh>

      {/* baseboard along back wall */}
      <mesh position={[0.1, 0.045, -1.065]}>
        <roundedBoxGeometry args={rb(4.6, 0.09, 0.02)} />
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
        <roundedBoxGeometry args={rb(w + 0.02, h + 0.02, 0.012)} />
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

/* the binders on the shelf are the three employers, straight from the
   resume: "Fair Isaac Corporation (FICO)" → FICO, "PayU (Wibmo)" → PAYU,
   "HDFC Bank" → HDFC. Oldest on the left, like a shelf fills up. */
function employerSpine(company: string): string {
  const acronym = /\(([A-Z]{2,})\)/.exec(company)
  return (acronym ? acronym[1] : company.split(/\s+/)[0]).toUpperCase()
}
const BINDERS = [...experience]
  .reverse()
  .slice(0, 3)
  .map((job) => employerSpine(job.company))
const BINDER_COLORS = ['#3d5a2e', '#274a68', '#8c2f26']
/* the trophy is the Quarterly Ace (PayU) — only engraved if it is real */
const TROPHY_PLATE = awards.some((a) => /Quarterly Ace/i.test(a.title))
  ? 'QUARTERLY ACE'
  : 'AWARD'

function Shelf() {
  const view = useSystem((s) => s.view)
  const books = useMemo(() => buildBooks(), [])
  const spineTex = useMemo(
    () => BINDERS.map((t) => makeLabel(t, '#1a1812', '#eceadf', 4, 3)),
    [],
  )
  const plateTex = useMemo(
    () => makeLabel(TROPHY_PLATE, P.amber, '#1a1812', 4, 3),
    [],
  )
  useEffect(
    () => () => {
      books.geometry.dispose()
      ;(books.material as MeshStandardMaterial).dispose()
      spineTex.forEach((t) => t.dispose())
      plateTex.dispose()
    },
    [books, spineTex, plateTex],
  )

  return (
    <group position={[1.14, 1.52, -0.97]}>
      {/* board */}
      <mesh castShadow receiveShadow>
        <roundedBoxGeometry args={rb(0.68, 0.026, 0.21)} />
        <meshStandardMaterial color={P.deskWood} roughness={0.85} />
      </mesh>
      {/* brackets */}
      {[-0.26, 0.26].map((x) => (
        <mesh key={x} position={[x, -0.05, -0.06]}>
          <roundedBoxGeometry args={rb(0.02, 0.08, 0.08)} />
          <meshStandardMaterial color={P.metal} roughness={0.6} metalness={0.4} />
        </mesh>
      ))}
      <primitive object={books} position={[-0.31, 0.013, 0]} />
      {/* three fat binders — one per employer (E-5) */}
      <Clickable
        enabled={view === 'room'}
        label="three employers, one shelf"
        onActivate={() => playClick()}
      >
        {BINDERS.map((name, i) => {
          const x = 0.09 + i * 0.058
          return (
            <group key={name} position={[x, 0.098, -0.005]} rotation-y={i === 0 ? 0.04 : 0}>
              <mesh castShadow>
                <roundedBoxGeometry args={rb(0.052, 0.17, 0.15)} />
                <meshStandardMaterial color={BINDER_COLORS[i]} roughness={0.85} />
              </mesh>
              {/* spine label, reading top to bottom */}
              <mesh position={[0, 0.02, 0.0755]} rotation-z={-Math.PI / 2}>
                <planeGeometry args={[0.096, 0.036]} />
                <meshStandardMaterial map={spineTex[i]} roughness={0.9} />
              </mesh>
            </group>
          )
        })}
      </Clickable>
      {/* tiny amber trophy, engraved */}
      <group position={[0.28, 0.013, 0.02]}>
        <mesh castShadow>
          <roundedBoxGeometry args={rb(0.045, 0.018, 0.045)} />
          <meshStandardMaterial color="#2e2a26" roughness={0.6} />
        </mesh>
        <mesh position={[0, -0.001, 0.0226]}>
          <planeGeometry args={[0.038, 0.0085]} />
          <meshStandardMaterial
            map={plateTex}
            metalness={0.6}
            roughness={0.4}
          />
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
          <roundedBoxGeometry args={rb(0.09, 0.007, 0.093)} />
          <meshStandardMaterial color="#2b3a8c" roughness={0.8} />
        </mesh>
        <mesh position={[0.006, 0.008, -0.004]} rotation-y={0.18}>
          <roundedBoxGeometry args={rb(0.09, 0.007, 0.093)} />
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

/* ---------- wall socket the machine plugs into ---------- */
function WallSocket() {
  return (
    <group position={[0.72, 0.22, -1.066]}>
      <mesh>
        <roundedBoxGeometry args={rb(0.09, 0.13, 0.014)} />
        <meshStandardMaterial color={P.chassisDark} roughness={0.85} />
      </mesh>
      {[0.028, -0.028].map((y) => (
        <mesh key={y} position={[0, y, 0.008]}>
          <roundedBoxGeometry args={rb(0.05, 0.045, 0.006)} />
          <meshStandardMaterial color={P.plasticDark} roughness={0.8} />
        </mesh>
      ))}
    </group>
  )
}
