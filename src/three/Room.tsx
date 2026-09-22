import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { AdditiveBlending, DoubleSide, MeshStandardMaterial, Vector2, type CanvasTexture } from 'three'
import { awards, experience } from '../data/resume'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import BackWall from './BackWall'
import Chair from './Chair'
import Clickable from './Clickable'
import Staged from './Staged'
import { useStagedSteps, useStagedValue } from './stage'
import { P } from './layout'
import {
  disposeSurface,
  makeFloppyPoster,
  makeLabel,
  makeRocketPoster,
  repeatSurface,
  sharedWallShadowBlob,
} from './textures'
import { brushedMetalMaps, fabricMaps, plasticMaps, type PbrMaps } from './tex/noise'
import {
  FLOOR_TILE,
  RUG,
  SWITCH,
  TROPHY,
  bakeSideWall,
  binderLabelsGeo,
  bindersGeo,
  bracketsGeo,
  buildFringe,
  buildShelfBooks,
  corniceGeo,
  floppyStackGeo,
  makeBinderLabels,
  makeFloorMapsSteps,
  makeFloorWear,
  makeGlassSheen,
  makeGrainMaps,
  makeRugMaps,
  makeWallGrime,
  plasterSurface,
  posterGeo,
  rugGeo,
  shelfBoardGeo,
  skirtingGeo,
  socketGeo,
  switchGeo,
  trophyGeo,
} from './tex/room'

/* =====================================================================
   The dark cozy room: plastered walls with moulded skirting and cornice,
   varnished floorboards, a woven rug, framed prints behind glass, the
   wall shelf, a socket and a light switch. Static decor only —
   interactive props live in their own files, and the window (the room's
   one scenery control) lives in Window.tsx.

   Surfaces are generated once (seeded) in ./tex/room.ts and disposed
   here. Three walls, three looks of ONE plaster: the back wall's
   colour/normal/roughness go to BackWall.tsx (which owns its mesh and
   the window cut) with its dirt and occlusion laid over it as a decal;
   the side walls are mine, with a baked per-wall colour map.
   ===================================================================== */

const WALL_Z = -1.08

/* first load: mounted in its own turn of the staged build (stage.ts) */
export default function Room() {
  return (
    <Staged id="room">
      <RoomBody />
    </Staged>
  )
}

function RoomBody() {
  const gl = useThree((s) => s.gl)
  const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy())
  // the big surfaces are built one per turn of the staged first load
  // (stage.ts), not all in one frame; nothing renders until all are in
  const floor = useStagedSteps('room.floor', function* () {
    const maps = yield* makeFloorMapsSteps(P.floorWood, 5, aniso)
    return repeatSurface(maps, 4.6 / FLOOR_TILE, 3.9 / FLOOR_TILE)
  })
  // one plaster for every wall: the back wall's own map is the tiled colour;
  // the side walls swap in a baked map and keep the shared normal/roughness
  const wall = useStagedValue('room.plaster', () => {
    const s = plasterSurface(P.wallA, 11, 512, aniso)
    // colour mottling: one tile per ~2 m so it never reads as a grid;
    // the plaster's tooth is fine, one tile per ~0.55 m
    s.map.repeat.set(2.2, 1.3)
    for (const m of [s.bumpMap, s.roughnessMap, s.normalMap]) m?.repeat.set(8, 4.6)
    return s
  })
  const sideL = useStagedValue('room.sideL', () => bakeSideWall('#272b35', 12, 'left', aniso))
  const sideR = useStagedValue('room.sideR', () => bakeSideWall('#282c36', 14, 'right', aniso))
  // soft decal overlays: low-frequency, blurred by design, so a smaller
  // canvas costs nothing visible (was 1024x576 / 768x652)
  const decals = useStagedValue('room.decals', () => ({
    grime: makeWallGrime(5, 640, 360, aniso),
    wear: makeFloorWear(8, 512, 435, aniso),
  }))
  const rug = useStagedValue('room.rug', () => makeRugMaps(3, aniso))
  const rugMesh = useMemo(() => rugGeo(), [])
  const fringe = useMemo(() => buildFringe(4), [])
  const skirting = useMemo(() => skirtingGeo(), [])
  const cornice = useMemo(() => corniceGeo(), [])
  // one shared soft blob for every wall-hung drop shadow in the zone
  // (Room + SetDressing) instead of five near-identical textures
  const blob = useMemo(() => sharedWallShadowBlob(), [])
  // one moulded-plastic grain for the socket and the switch; their UVs are
  // in metres, so one 256 px tile ≈ 4 cm
  const plastic = useMemo(() => {
    const m = plasticMaps(17, 256, 1)
    m.normalMap.repeat.set(24, 24)
    m.roughnessMap.repeat.set(24, 24)
    return m
  }, [])

  useEffect(() => () => void (floor && disposeSurface(floor)), [floor])
  useEffect(() => () => void (wall && disposeSurface(wall)), [wall])
  useEffect(() => () => sideL?.dispose(), [sideL])
  useEffect(() => () => sideR?.dispose(), [sideR])
  useEffect(
    () => () => {
      decals?.grime.dispose()
      decals?.wear.dispose()
    },
    [decals],
  )
  useEffect(
    () => () => {
      rug?.map.dispose()
      rug?.weave.dispose()
    },
    [rug],
  )
  useEffect(
    () => () => {
      rugMesh.dispose()
      fringe.geometry.dispose()
      ;(fringe.material as { dispose(): void }).dispose()
      fringe.dispose()
      skirting.dispose()
      cornice.dispose()
      // blob is a shared, app-lifetime singleton (textures.ts) — not ours to dispose
      plastic.dispose()
    },
    [rugMesh, fringe, skirting, cornice, plastic],
  )

  if (!floor || !wall || !sideL || !sideR || !decals || !rug) return null
  const { grime, wear } = decals

  return (
    <group>
      {/* floor: satin-varnished boards, gaps and all */}
      <mesh rotation-x={-Math.PI / 2} position={[0.1, 0, 0.35]} receiveShadow>
        <planeGeometry args={[4.6, 3.9]} />
        <meshStandardMaterial
          map={floor.map}
          normalMap={floor.normalMap}
          roughnessMap={floor.roughnessMap}
          roughness={1}
        />
      </mesh>
      {/* worn path, caster scuffs, dust along the wall */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0.1, 0.0012, 0.35]}
        renderOrder={1}
      >
        <planeGeometry args={[4.6, 3.9]} />
        <meshStandardMaterial
          map={wear}
          transparent
          depthWrite={false}
          roughness={0.9}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      {/* baked contact darkening under everything that stands on the
          floor (chair, desk legs, tower, bin, bookcase). frames=1: one
          bake at mount. Above the rug top (0.007); renderOrder -1 so it
          can never land over the lifted paper (renderOrder 50). */}
      {/* baked on its first frame, so it waits for every other turn of
          the staged first load: the props it darkens must be in the room */}
      <Staged id="room.contact" last>
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
      </Staged>

      {/* the rug: woven kilim, fringe, and a soft edge shadow on the boards */}
      <group position={[RUG.x, 0, RUG.z]} rotation-y={RUG.yaw}>
        <mesh
          rotation-x={-Math.PI / 2}
          position={[0, 0.0016, 0]}
          renderOrder={2}
        >
          <planeGeometry args={[RUG.w + 0.1, RUG.d + 0.1]} />
          <meshBasicMaterial
            map={blob}
            color="#000000"
            transparent
            opacity={0.55}
            depthWrite={false}
          />
        </mesh>
        <mesh geometry={rugMesh} receiveShadow>
          <meshStandardMaterial
            map={rug.map}
            normalMap={rug.weave.normalMap}
            normalScale={[1.4, 1.4]}
            roughnessMap={rug.weave.roughnessMap}
            roughness={1}
          />
        </mesh>
        <primitive object={fringe} />
      </group>

      {/* back wall (its own file: the window opening is cut there) */}
      <BackWall surface={wall} />
      {/* its dirt line, corner occlusion and scuffs, as a decal a half
          millimetre proud (the window stays clear) */}
      <mesh position={[0.1, 1.3, WALL_Z + 0.0005]} renderOrder={1}>
        <planeGeometry args={[4.6, 2.6]} />
        <meshBasicMaterial
          map={grime}
          transparent
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
      {/* left wall */}
      <mesh position={[-2.05, 1.3, 0.35]} rotation-y={Math.PI / 2} receiveShadow>
        <planeGeometry args={[3.9, 2.6]} />
        <meshStandardMaterial
          map={sideL}
          normalMap={wall.normalMap}
          normalScale={[0.75, 0.75]}
          roughnessMap={wall.roughnessMap}
          roughness={1}
        />
      </mesh>
      {/* right wall */}
      <mesh position={[2.25, 1.3, 0.35]} rotation-y={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[3.9, 2.6]} />
        <meshStandardMaterial
          map={sideR}
          normalMap={wall.normalMap}
          normalScale={[0.75, 0.75]}
          roughnessMap={wall.roughnessMap}
          roughness={1}
        />
      </mesh>
      {/* ceiling */}
      <mesh position={[0.1, 2.6, 0.35]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[4.6, 3.9]} />
        <meshStandardMaterial
          color="#181b22"
          roughness={1}
          normalMap={wall.normalMap}
          normalScale={[0.6, 0.6]}
          roughnessMap={wall.roughnessMap}
        />
      </mesh>

      {/* skirting along all three walls, true mitres in both corners */}
      <mesh geometry={skirting} receiveShadow>
        <meshStandardMaterial color="#4a4842" roughness={0.42} />
      </mesh>
      {/* cove cornice where the walls meet the ceiling */}
      <mesh geometry={cornice} receiveShadow>
        <meshStandardMaterial color="#3a3d46" roughness={0.6} />
      </mesh>

      <Poster kind="rocket" position={[-0.47, 1.5, WALL_Z + 0.0005]} w={0.32} h={0.42} tilt={-0.012} blob={blob} />
      <Poster kind="floppy" position={[0.52, 1.56, WALL_Z + 0.0005]} w={0.24} h={0.32} tilt={0.02} blob={blob} />
      <Staged id="room.shelf">
        <Shelf blob={blob} />
      </Staged>
      <Chair />
      <WallSocket plastic={plastic} />
      <LightSwitch plastic={plastic} />
    </group>
  )
}

/* ---------- a soft drop shadow on the wall behind wall-hung things ---------- */
function WallShadow({
  blob,
  w,
  h,
  x = 0,
  y = 0,
  z = -0.0003,
  opacity = 0.5,
}: {
  blob: CanvasTexture
  w: number
  h: number
  x?: number
  y?: number
  z?: number
  opacity?: number
}) {
  return (
    <mesh position={[x, y, z]} renderOrder={2}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial
        map={blob}
        color="#000000"
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  )
}

/* ---------- framed prints ----------
   A mitred moulding (black brushed metal / walnut), a bevel-cut mat, the
   owner's pixel-art print (NEAREST-filtered, as drawn) and a pane of
   glass. The glass is BLACK and additive: it adds only the specular
   reflection of the lamp and the window, the way a pane over a dark
   print does, and costs no transmission pass. */
function Poster({
  kind,
  position,
  w,
  h,
  tilt = 0,
  blob,
}: {
  kind: 'rocket' | 'floppy'
  position: [number, number, number]
  w: number
  h: number
  tilt?: number
  blob: CanvasTexture
}) {
  const tex: CanvasTexture = useMemo(
    () => (kind === 'rocket' ? makeRocketPoster() : makeFloppyPoster()),
    [kind],
  )
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <FramedPrint
      tex={tex}
      w={w}
      h={h}
      frame={kind === 'rocket' ? 'metal' : 'wood'}
      matBorder={kind === 'rocket' ? 0.026 : 0.024}
      position={position}
      tilt={tilt}
      blob={blob}
      glow={0.14}
    />
  )
}

/* ---------- shared frame/mat/glass materials ----------
   Every FramedPrint of a given frame kind renders identically (same
   texture, same repeat, same PBR knobs) — the w/h/matBorder only affect
   GEOMETRY. So the frame, matboard and glass are cached module-level
   singletons instead of one fresh Material (and, for wood, one freshly
   redrawn canvas texture) per poster. Never mutated per frame, so a
   shared instance is safe. The glass used to be a MeshPhysicalMaterial
   for its clearcoat layer; on a flat, additive-blended, already-glossy
   (roughness 0.04) black pane the clearcoat's second specular lobe was
   not visibly adding anything over the base specular + emissive sheen,
   so it is a plain MeshStandardMaterial now — one less shader variant. */
const frameMaterialCache = new Map<'metal' | 'wood', MeshStandardMaterial>()
function getFrameMaterial(kind: 'metal' | 'wood'): MeshStandardMaterial {
  const cached = frameMaterialCache.get(kind)
  if (cached) return cached
  let material: MeshStandardMaterial
  if (kind === 'metal') {
    const m = brushedMetalMaps(4, 256, 1)
    m.normalMap.repeat.set(3, 4)
    m.roughnessMap.repeat.set(3, 4)
    material = new MeshStandardMaterial({
      color: '#1a1b20',
      metalness: 0.78,
      roughness: 1,
      normalMap: m.normalMap,
      normalScale: new Vector2(0.3, 0.3),
      roughnessMap: m.roughnessMap,
    })
  } else {
    const m = makeGrainMaps('#6a4630', 5)
    m.map.repeat.set(5, 24)
    m.normalMap.repeat.set(5, 24)
    m.roughnessMap.repeat.set(5, 24)
    material = new MeshStandardMaterial({
      color: '#ffffff',
      map: m.map,
      normalMap: m.normalMap,
      roughnessMap: m.roughnessMap,
      roughness: 1,
    })
  }
  frameMaterialCache.set(kind, material)
  return material
}
let matboardMaterial: MeshStandardMaterial | null = null
function getMatboardMaterial(): MeshStandardMaterial {
  if (!matboardMaterial) {
    matboardMaterial = new MeshStandardMaterial({ color: '#c4beaf', roughness: 0.95, side: DoubleSide })
  }
  return matboardMaterial
}
let glassMaterial: MeshStandardMaterial | null = null
function getGlassMaterial(): MeshStandardMaterial {
  if (!glassMaterial) {
    glassMaterial = new MeshStandardMaterial({
      color: '#000000',
      roughness: 0.04,
      metalness: 0,
      envMapIntensity: 2.2,
      emissive: '#ffffff',
      emissiveMap: makeGlassSheen(),
      emissiveIntensity: 0.06,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    })
  }
  return glassMaterial
}

/** Any print, framed: reused by the set dressing. Group origin = the wall
    plane at the frame's centre, facing +z (turn it with `rotationY`). */
export function FramedPrint({
  tex,
  w,
  h,
  frame,
  matBorder,
  position,
  rotationY = 0,
  tilt = 0,
  blob,
  glow = 0,
}: {
  tex: CanvasTexture
  w: number
  h: number
  frame: 'metal' | 'wood'
  matBorder: number
  position: [number, number, number]
  rotationY?: number
  tilt?: number
  blob: CanvasTexture
  /** how much the print glows on its own (pixel-art prints are lit; paper isn't) */
  glow?: number
}) {
  const metal = frame === 'metal'
  const g = useMemo(() => posterGeo(w, h, metal ? 'metal' : 'wood', matBorder), [w, h, metal, matBorder])
  const frameMat = useMemo(() => getFrameMaterial(metal ? 'metal' : 'wood'), [metal])
  useEffect(
    () => () => {
      g.frame.dispose()
      g.mat.dispose()
      // frameMat / matboard / glass materials are shared, app-lifetime
      // singletons — not ours to dispose
    },
    [g],
  )
  return (
    <group position={position} rotation-y={rotationY}>
      <group rotation-z={tilt}>
        <WallShadow
          blob={blob}
          w={g.outerW + 0.07}
          h={g.outerH + 0.07}
          x={0.006}
          y={-0.01}
          opacity={0.6}
        />
        <mesh geometry={g.frame} material={frameMat} castShadow receiveShadow />
        {/* mat with its bevel cut */}
        <mesh geometry={g.mat} material={getMatboardMaterial()} receiveShadow />
        {/* the print itself */}
        <mesh position={[0, 0, g.z.print]}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial
            map={tex}
            emissive="#ffffff"
            emissiveMap={tex}
            emissiveIntensity={glow}
            roughness={0.85}
          />
        </mesh>
        {/* glass */}
        <mesh position={[0, 0, g.z.glass]} renderOrder={3} material={getGlassMaterial()}>
          <planeGeometry args={[g.openW, g.openH]} />
        </mesh>
      </group>
    </group>
  )
}

/* ---------- shelf with books, binders and a tiny trophy ---------- */

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

function Shelf({ blob }: { blob: CanvasTexture }) {
  const view = useSystem((s) => s.view)
  const board = useMemo(() => shelfBoardGeo(), [])
  const brackets = useMemo(() => bracketsGeo([-0.26, 0.26]), [])
  // the spines' atlas is the shelf's heaviest build: its own turn of the
  // staged first load (stage.ts)
  const books = useStagedValue('room.shelfBooks', buildShelfBooks)
  const trophy = useMemo(() => trophyGeo(), [])
  const floppies = useMemo(() => floppyStackGeo(), [])
  const grain = useMemo(() => {
    const m = makeGrainMaps(P.deskWood, 9)
    m.map.repeat.set(4, 4)
    m.normalMap.repeat.set(4, 4)
    m.roughnessMap.repeat.set(4, 4)
    return m
  }, [])
  const cloth = useMemo(() => fabricMaps(21, 128, 2, 10), [])
  const binders = useMemo(() => bindersGeo(BINDER_COLORS), [])
  const binderLabels = useMemo(() => binderLabelsGeo(BINDERS.length), [])
  const labelAtlas = useMemo(() => makeBinderLabels(BINDERS), [])
  const plateTex = useMemo(
    () => makeLabel(TROPHY_PLATE, P.amber, '#1a1812', 4, 3),
    [],
  )
  useEffect(
    () => () => {
      board.dispose()
      brackets.dispose()
      trophy.plinth.dispose()
      trophy.gold.dispose()
      floppies.dispose()
      grain.dispose()
      cloth.dispose()
      binders.dispose()
      binderLabels.dispose()
      labelAtlas.dispose()
      plateTex.dispose()
    },
    [board, brackets, trophy, floppies, grain, cloth, binders, binderLabels, labelAtlas, plateTex],
  )
  useEffect(
    () => () => {
      books?.geometry.dispose()
      books?.atlas.dispose()
    },
    [books],
  )

  if (!books) return null

  return (
    <group position={[1.14, 1.52, -0.97]}>
      <WallShadow blob={blob} w={0.86} h={0.2} y={-0.075} z={-0.1088} opacity={0.55} />
      {/* board: a bullnose front and soft ends, real grain */}
      <mesh geometry={board} castShadow receiveShadow>
        <meshStandardMaterial
          map={grain.map}
          normalMap={grain.normalMap}
          roughnessMap={grain.roughnessMap}
          roughness={1}
        />
      </mesh>
      {/* gallows brackets with wall plates and screws */}
      <mesh geometry={brackets} castShadow>
        <meshStandardMaterial vertexColors metalness={0.55} roughness={0.5} />
      </mesh>
      {/* the books: one geometry, one atlas */}
      <mesh geometry={books.geometry} position={[-0.31, 0.013, 0]} castShadow>
        <meshStandardMaterial map={books.atlas} roughness={0.88} />
      </mesh>
      {/* three fat binders — one per employer (E-5) — as ONE mesh, their
          spine labels as one more, and a spare floppy stack lying across
          their tops */}
      <Clickable
        enabled={view === 'room'}
        label="three employers, one shelf"
        onActivate={() => playClick()}
      >
        <mesh geometry={binders} castShadow>
          <meshStandardMaterial
            vertexColors
            roughness={1}
            normalMap={cloth.normalMap}
            normalScale={[0.45, 0.45]}
            roughnessMap={cloth.roughnessMap}
          />
        </mesh>
        <mesh geometry={binderLabels}>
          <meshStandardMaterial map={labelAtlas} roughness={0.9} />
        </mesh>
        <mesh geometry={floppies} position={[0.148, 0.183, -0.005]} rotation-y={0.4} castShadow>
          <meshStandardMaterial vertexColors roughness={0.55} />
        </mesh>
      </Clickable>
      {/* the amber trophy, engraved: turned cup on a stepped plinth */}
      <group position={[0.285, 0.013, 0.02]} rotation-y={-0.2}>
        <mesh geometry={trophy.plinth} castShadow>
          <meshStandardMaterial color="#2e2a26" roughness={0.5} />
        </mesh>
        <mesh position={[0, TROPHY.plateY, TROPHY.plateZ]}>
          <planeGeometry args={[TROPHY.plateW, TROPHY.plateH]} />
          <meshStandardMaterial map={plateTex} metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh geometry={trophy.gold} castShadow>
          <meshStandardMaterial
            color="#e6ad3a"
            metalness={0.9}
            roughness={0.26}
            emissive={P.amber}
            emissiveIntensity={0.05}
          />
        </mesh>
      </group>
    </group>
  )
}

/* ---------- wall socket the machine plugs into ---------- */
function WallSocket({ plastic }: { plastic: PbrMaps }) {
  const geo = useMemo(() => socketGeo(), [])
  useEffect(
    () => () => {
      geo.plate.dispose()
      geo.dark.dispose()
    },
    [geo],
  )
  return (
    <group position={[0.72, 0.22, WALL_Z + 0.0005]}>
      <mesh geometry={geo.plate} castShadow receiveShadow>
        <meshStandardMaterial
          color="#b7b1a2"
          roughness={1}
          normalMap={plastic.normalMap}
          normalScale={[0.18, 0.18]}
          roughnessMap={plastic.roughnessMap}
        />
      </mesh>
      <mesh geometry={geo.dark}>
        <meshStandardMaterial vertexColors roughness={0.7} />
      </mesh>
    </group>
  )
}

/* ---------- a light switch by the corner ---------- */
function LightSwitch({ plastic }: { plastic: PbrMaps }) {
  const geo = useMemo(() => switchGeo(), [])
  useEffect(
    () => () => {
      geo.plate.dispose()
      geo.dark.dispose()
    },
    [geo],
  )
  return (
    <group position={[SWITCH.x, SWITCH.y, WALL_Z + 0.0005]}>
      <mesh geometry={geo.plate} castShadow receiveShadow>
        <meshStandardMaterial
          vertexColors
          roughness={1}
          normalMap={plastic.normalMap}
          normalScale={[0.18, 0.18]}
          roughnessMap={plastic.roughnessMap}
        />
      </mesh>
      <mesh geometry={geo.dark}>
        <meshStandardMaterial vertexColors roughness={0.7} />
      </mesh>
    </group>
  )
}
