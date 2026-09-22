import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferAttribute,
  Color,
  DoubleSide,
  Euler,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type CanvasTexture,
  type Group,
  type Mesh,
  type PointLight,
  type Sprite,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { books, type Book } from '../data/library'
import { useSystem } from '../os/store'
import { playBeep, playClick } from '../os/sound'
import CaseFittings from './CaseFittings'
import Clickable from './Clickable'
import {
  BOOKCASE_POS,
  BOOKCASE_YAW,
  CASE,
  CASE_FRONT,
  P,
  SHELF_Y,
  caseToWorld,
} from './layout'
import { useLibrary } from './libraryState'
import {
  bookDims,
  bookInk,
  makeBackCover,
  makeFrontCover,
  makeSpineAtlas,
  makeStrip,
  spineTooltip,
  type BookDims,
} from './libraryTextures'
import { makeSoftCircle, makeWood } from './textures'
import { useFontsReady } from '../useFontsReady'
import { LEDGER, useWorld } from '../world'
import { rb } from './rbox'

/* ---------------------------------------------------------------------
   Shared materials / geometry helpers — the whole point is that 113
   books share as few GPU objects as the picture allows instead of each
   minting its own. Never share a material a per-frame effect mutates.
   --------------------------------------------------------------------- */

/** The page block is the same putty colour on every volume. */
const PAGE_MATERIAL = new MeshStandardMaterial({ color: '#e6dcc2', roughness: 0.95 })
/** The "currently reading" ribbon is the same red on every volume. */
const RIBBON_MATERIAL = new MeshStandardMaterial({
  color: '#b5220a',
  roughness: 0.7,
  side: DoubleSide,
})

/** Plain (untextured) cloth board material, cached by colour so the
    handful of books that DO share an exact hex ink colour share a
    material instance instead of minting a duplicate. */
const clothMatCache = new Map<string, MeshStandardMaterial>()
function clothMaterial(color: string): MeshStandardMaterial {
  let m = clothMatCache.get(color)
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness: 0.86 })
    clothMatCache.set(color, m)
  }
  return m
}

/** A non-indexed RoundedBoxGeometry baked at a world offset (and
    optional Y rotation), ready to merge with its neighbours — used for
    the case's static carcass, bookends and floor-stack decor. */
function bakedBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  radius?: number,
  rotY = 0,
): BufferGeometry {
  const args = rb(w, h, d, radius)
  const built = new RoundedBoxGeometry(...args)
  // RoundedBoxGeometry already builds non-indexed (toNonIndexed() on an
  // already non-indexed geometry just warns) — guard rather than churn
  // the console on every merge
  const g = built.index ? built.toNonIndexed() : built
  const m = rotY ? new Matrix4().makeRotationY(rotY) : new Matrix4()
  m.setPosition(x, y, z)
  g.applyMatrix4(m)
  return g
}

/** Same, but stamps a flat vertex colour on it first — for merging
    same-shape, different-tint decor (the floor stack) into one draw
    call with `vertexColors` on the material instead of `color`. */
function bakedBoxTinted(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  hex: string,
  rotY = 0,
): BufferGeometry {
  const g = bakedBox(w, h, d, x, y, z, undefined, rotY)
  const c = new Color(hex)
  const count = g.getAttribute('position').count
  const arr = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new BufferAttribute(arr, 3))
  return g
}

/** Remaps a freshly-built box geometry's UVs (currently 0..1 per face,
    same on every face) into one cell of a shared atlas texture, so all
    six faces read the same sub-rect instead of the whole sheet. */
function remapAtlasUV(
  geom: BufferGeometry,
  rect: { u0: number; v0: number; u1: number; v1: number },
): void {
  const uv = geom.getAttribute('uv') as BufferAttribute
  const arr = uv.array as Float32Array
  const su = rect.u1 - rect.u0
  const sv = rect.v1 - rect.v0
  for (let i = 0; i < arr.length; i += 2) {
    arr[i] = rect.u0 + arr[i] * su
    arr[i + 1] = rect.v0 + arr[i + 1] * sv
  }
  uv.needsUpdate = true
}

/* =====================================================================
   THE STACKS — the 3D library in the back-left corner.

   Room view: an oak case full of real books. Click it and the camera
   walks over (CameraRig picks up useLibrary.open); from there you can
   read the stamped spines, pull a volume out and turn it over to find
   the bookplate — the note, the stars, the date.

   Searching and browsing are NOT here: a shelf is a bad search box, and
   trying to build one out of brass and card stock was the wrong shape.
   The brass plate on the plinth opens the real catalogue at /library.

   The catalogue is static data (src/data/library). Nothing in here can
   add, edit or remove a book: the shelf is a reader, not an editor.
   ===================================================================== */

/** Gap between neighbouring volumes. */
const GAP = 0.002
/** Room kept free at the right end of the TOP shelf for SOUBHIK.SYS (the
    volume that is not a book, 0.03 wide) plus a finger of air. Without it
    a full top row runs straight through the secret volume. */
const SECRET_RESERVE = 0.045
/** Usable run of a row (row 0 is the top shelf). */
const runCapacity = (row: number): number =>
  row === 0 ? CASE.inner - SECRET_RESERVE : CASE.inner
/** How far a hovered spine creeps out of the shelf. */
const PEEK = 0.026

type Shelves = Book[][]

/** Newest reads first, so the top shelf is what you just put down. Books
    with no date keep the order they are written in books.ts — which is
    the order they stand on the real shelves (Array.sort is stable). */
function shelfOrder(): Book[] {
  return [...books].sort((a, b) =>
    (b.finished ?? '').localeCompare(a.finished ?? ''),
  )
}

/**
 * Fill the case with as much of the catalogue as it physically holds.
 * A page that fits comfortably is spread evenly so eight books do not
 * huddle on the top shelf; anything past capacity stays in the
 * catalogue, and the HUD says so.
 */
function layoutShelves(list: Book[]): { shelves: Shelves; shown: number } {
  const widths = new Map(list.map((b) => [b.id, bookDims(b).thick + GAP]))
  const width = (b: Book): number => widths.get(b.id) ?? 0.037
  const total = list.reduce((sum, b) => sum + width(b), 0)
  const rows = SHELF_Y.length

  // everything fits: balance by count rather than packing tight
  if (total <= CASE.inner * rows) {
    const per = Math.ceil(list.length / rows) || 1
    const even: Shelves = []
    for (let i = 0; i < rows; i++) even.push(list.slice(i * per, (i + 1) * per))
    const overflows = even.some(
      (row, i) => row.reduce((sum, b) => sum + width(b), 0) > runCapacity(i),
    )
    if (!overflows) return { shelves: even, shown: list.length }
  }

  const shelves: Shelves = [[]]
  let used = 0
  let shown = 0
  for (const b of list) {
    const w = width(b)
    if (used + w > runCapacity(shelves.length - 1) && shelves[shelves.length - 1].length) {
      if (shelves.length === rows) break
      shelves.push([])
      used = 0
    }
    shelves[shelves.length - 1].push(b)
    used += w
    shown++
  }
  while (shelves.length < rows) shelves.push([])
  return { shelves, shown }
}

interface Slot {
  book: Book
  dims: BookDims
  x: number
  y: number
}

/** SHELF_Y runs bottom-up; results read top-down, so rows are flipped. */
function shelfHeight(row: number): number {
  return SHELF_Y[SHELF_Y.length - 1 - row]
}

function layoutSlots(shelves: Shelves): Slot[] {
  const slots: Slot[] = []
  shelves.forEach((row, i) => {
    const dims = row.map(bookDims)
    const run = dims.reduce((sum, d) => sum + d.thick + GAP, -GAP)
    // centred in the usable run: the top row leaves room for SOUBHIK.SYS
    let x = -run / 2 - (i === 0 ? SECRET_RESERVE / 2 : 0)
    row.forEach((book, j) => {
      slots.push({
        book,
        dims: dims[j],
        x: x + dims[j].thick / 2,
        y: shelfHeight(i),
      })
      x += dims[j].thick + GAP
    })
  })
  return slots
}

/** Where the row ends, so a bookend can lean against it. */
function rowEnds(shelves: Shelves): { x: number; y: number }[] {
  const ends: { x: number; y: number }[] = []
  shelves.forEach((row, i) => {
    if (!row.length) return
    const run = row.reduce((sum, b) => sum + bookDims(b).thick + GAP, -GAP)
    ends.push({
      x: run / 2 + 0.012 - (i === 0 ? SECRET_RESERVE / 2 : 0),
      y: shelfHeight(i),
    })
  })
  return ends
}

export default function Bookcase() {
  const view = useSystem((s) => s.view)
  const open = useLibrary((s) => s.open)
  const selectedId = useLibrary((s) => s.selectedId)
  const secret = useLibrary((s) => s.secret)
  const fontsReady = useFontsReady()

  const { shelves } = useMemo(() => layoutShelves(shelfOrder()), [])
  const slots = useMemo(() => layoutSlots(shelves), [shelves])
  const ends = useMemo(() => rowEnds(shelves), [shelves])

  /* Stamped titles are only legible at the shelf, so the spine atlas
     lives exactly as long as the visit does: built on the way in,
     released on the way out. From the room the books are just cloth,
     which is all you can see from there anyway. One shared texture (and
     one shared material) for every shelved spine instead of ~110
     distinct ones — see libraryTextures.makeSpineAtlas. */
  const atlas = useMemo(
    () => (fontsReady && open ? makeSpineAtlas(slots.map((s) => s.book)) : null),
    [fontsReady, open, slots],
  )
  useEffect(() => {
    if (!atlas) return
    return () => atlas.dispose()
  }, [atlas])

  const spineMaterial = useMemo(
    () =>
      atlas
        ? new MeshStandardMaterial({ color: '#ffffff', map: atlas.tex, roughness: 0.86 })
        : null,
    [atlas],
  )
  useEffect(() => {
    if (!spineMaterial) return
    return () => spineMaterial.dispose()
  }, [spineMaterial])

  const oak = useMemo(() => makeWood('#5e4128', '#281909', 5), [])
  const oakDark = useMemo(() => makeWood('#4a3220', '#1d1208', 9), [])
  useEffect(
    () => () => {
      oak.dispose()
      oakDark.dispose()
    },
    [oak, oakDark],
  )

  /* Esc puts the book back, then steps away from the shelf. */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey) return
      const lib = useLibrary.getState()
      e.preventDefault()
      if (lib.selectedId) lib.select(null)
      else lib.closeLibrary()
      playClick()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  /* leaning into the CRT reshelves everything — but zooming OUT may be
     the terminal's `library` command on its way here, so leave it be */
  useEffect(() => {
    if ((view === 'zooming-in' || view === 'screen') && open) {
      useLibrary.getState().closeLibrary()
    }
  }, [view, open])

  const held = selectedId ? (slots.find((s) => s.book.id === selectedId) ?? null) : null

  return (
    <>
      <group position={BOOKCASE_POS} rotation-y={BOOKCASE_YAW}>
        <Clickable
          enabled={view === 'room' && !open}
          label="the stacks — my library"
          onActivate={() => {
            playClick()
            useLibrary.getState().openLibrary()
          }}
        >
          {/* pivot at the left stile so the secret panel swings like a door */}
          <SwingGroup open={secret}>
            <Carcass oak={oak} oakDark={oakDark} />

            {slots.map((slot) => (
              <ShelfBook
                key={slot.book.id}
                slot={slot}
                uv={atlas?.uv.get(slot.book.id) ?? null}
                spineMaterial={spineMaterial}
                interactive={open}
                hidden={slot.book.id === selectedId}
              />
            ))}

            <Bookends ends={ends} />

            <SecretVolume />
            <CaseFittings />
          </SwingGroup>
        </Clickable>

        <SecretRecess open={secret} />
        <FloorStack oak={oak} />
      </group>

      <CornerFill open={open} />
      {held && <HeldBook slot={held} fontsReady={fontsReady} />}
    </>
  )
}

/* ---------------------------------------------------------------------
   Carcass — plinth, stiles, back, shelf boards, cornice.
   --------------------------------------------------------------------- */
function Carcass({ oak, oakDark }: { oak: CanvasTexture; oakDark: CanvasTexture }) {
  const half = CASE.w / 2
  const stileH = CASE.h - CASE.plinth - 0.08

  /* Every board here is static furniture — never moves, never
     interactive — so the two stiles and the five shelf boards + top
     board (all sharing one oak material each) are baked and merged
     into one draw call apiece instead of 2 and 6. Materials still come
     from the shared oak/oakDark canvas textures passed down from
     Bookcase, so this costs zero extra texture memory. */
  const stilesGeom = useMemo(
    () =>
      mergeGeometries(
        [-1, 1].map((s) =>
          bakedBox(CASE.side, stileH, CASE.d, s * (half - CASE.side / 2), CASE.plinth + stileH / 2, 0),
        ),
        false,
      ),
    [half, stileH],
  )
  useEffect(() => () => stilesGeom?.dispose(), [stilesGeom])

  const shelvesGeom = useMemo(() => {
    const boards = SHELF_Y.map((y) =>
      bakedBox(CASE.w - CASE.side, CASE.board, CASE.d - 0.02, 0, y - CASE.board / 2, 0.006),
    )
    boards.push(bakedBox(CASE.w - CASE.side, CASE.board, CASE.d - 0.02, 0, CASE.h - 0.075, 0))
    return mergeGeometries(boards, false)
  }, [])
  useEffect(() => () => shelvesGeom?.dispose(), [shelvesGeom])

  return (
    <group>
      {/* plinth */}
      <mesh position={[0, CASE.plinth / 2, 0]} castShadow receiveShadow>
        <roundedBoxGeometry args={rb(CASE.w + 0.04, CASE.plinth, CASE.d + 0.02)} />
        <meshStandardMaterial map={oakDark} roughness={0.85} />
      </mesh>
      {/* stiles — merged, 1 draw call for both */}
      {stilesGeom && (
        <mesh geometry={stilesGeom} castShadow receiveShadow>
          <meshStandardMaterial map={oak} roughness={0.8} />
        </mesh>
      )}
      {/* back panel */}
      <mesh position={[0, CASE.plinth + stileH / 2, -CASE.d / 2 + 0.008]} receiveShadow>
        <roundedBoxGeometry args={rb(CASE.w - CASE.side, stileH, 0.016)} />
        <meshStandardMaterial map={oakDark} roughness={0.95} />
      </mesh>
      {/* shelf boards + top board — merged, 1 draw call for all six.
          SHELF_Y[0] doubles as the base board, so there is no second
          slab coplanar with it */}
      {shelvesGeom && (
        <mesh geometry={shelvesGeom} castShadow receiveShadow>
          <meshStandardMaterial map={oak} roughness={0.82} />
        </mesh>
      )}
      {/* cornice */}
      <mesh position={[0, CASE.h - 0.03, 0.012]} castShadow>
        <roundedBoxGeometry args={rb(CASE.w + 0.06, 0.045, CASE.d + 0.03)} />
        <meshStandardMaterial map={oakDark} roughness={0.75} />
      </mesh>
      <mesh position={[0, CASE.h - 0.062, CASE.d / 2 + 0.014]} castShadow>
        <roundedBoxGeometry args={rb(CASE.w + 0.04, 0.02, 0.016)} />
        <meshStandardMaterial color="#3b2717" roughness={0.7} />
      </mesh>
    </group>
  )
}

/** Swings the whole case a few degrees when the secret volume is pulled. */
function SwingGroup({ open, children }: { open: boolean; children: React.ReactNode }) {
  const pivot = useRef<Group>(null!)
  useFrame((_, delta) => {
    const g = pivot.current
    if (!g) return
    const want = open ? -0.17 : 0
    if (Math.abs(g.rotation.y - want) < 1e-4) {
      g.rotation.y = want
      return
    }
    g.rotation.y = MathUtils.damp(g.rotation.y, want, 3.4, Math.min(delta, 0.05))
  })
  return (
    <group ref={pivot} position={[-CASE.w / 2, 0, 0]}>
      <group position={[CASE.w / 2, 0, 0]}>{children}</group>
    </group>
  )
}

/** What the case was hiding. A dead end — until the ledger is full. */
function SecretRecess({ open }: { open: boolean }) {
  const mat = useRef<Mesh>(null!)
  const complete = useWorld((s) => LEDGER.every((e) => s.found.includes(e.id)))
  const strip = useMemo(
    () =>
      makeStrip(
        complete ? 'ACCESS GRANTED — YOU MISSED NOTHING' : 'ACCESS PANEL — NICE TRY',
        { fg: '#0b1a0e', bg: '#33ff66', size: 34 },
      ),
    [complete],
  )
  const stripW = complete ? 0.28 : 0.2
  useEffect(() => () => strip.tex.dispose(), [strip])
  useFrame((_, delta) => {
    const m = mat.current
    if (!m) return
    const g = m.material as { opacity: number }
    const want = open ? 0.85 : 0
    if (g.opacity === want) return
    g.opacity = MathUtils.damp(g.opacity, want, 4, Math.min(delta, 0.05))
    if (Math.abs(g.opacity - want) < 0.002) g.opacity = want
  })
  return (
    <group position={[-0.18, 0.9, -CASE.d / 2 - 0.01]}>
      <mesh ref={mat}>
        <planeGeometry args={[0.42, 0.34]} />
        <meshBasicMaterial color="#0d3a20" transparent opacity={0} toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.02, 0.002]}>
        <planeGeometry args={[stripW, stripW / strip.aspect]} />
        <meshBasicMaterial map={strip.tex} transparent toneMapped={false} />
      </mesh>
      {/* NB: no `visible` gating — see CornerFill's comment: toggling a
          light's visibility recompiles shader variants scene-wide, and
          this one is binary already (no damping) so there's no idle
          per-frame cost to early-out of either. */}
      <pointLight
        position={[0, 0, 0.14]}
        color="#33ff66"
        intensity={open ? 0.5 : 0}
        distance={0.7}
      />
    </group>
  )
}

/* ---------------------------------------------------------------------
   One volume on the shelf.
   --------------------------------------------------------------------- */
function ShelfBook({
  slot,
  uv,
  spineMaterial,
  interactive,
  hidden,
}: {
  slot: Slot
  uv: { u0: number; v0: number; u1: number; v1: number } | null
  spineMaterial: MeshStandardMaterial | null
  interactive: boolean
  hidden: boolean
}) {
  const { book, dims, x, y } = slot
  const ink = useMemo(() => bookInk(book), [book])
  const grp = useRef<Group>(null!)
  const [hovered, setHovered] = useState(false)
  const peek = useRef(0)
  const enter = useRef(0)

  const z = CASE_FRONT - 0.022 - dims.deep / 2

  /* board + spine geometry, built once per book and re-cut only when
     its own atlas cell changes (open/close) — UVs baked in so every
     lettered book can still share ONE material for the shared atlas
     texture instead of minting its own. */
  const boardGeom = useMemo(() => {
    const args = rb(dims.thick, dims.tall, dims.deep * 0.99)
    const g = new RoundedBoxGeometry(...args)
    if (uv) remapAtlasUV(g, uv)
    return g
  }, [dims.thick, dims.tall, dims.deep, uv])
  useEffect(() => () => boardGeom.dispose(), [boardGeom])

  const boardMaterial = uv && spineMaterial ? spineMaterial : clothMaterial(ink.cloth)

  useFrame((_, delta) => {
    const g = grp.current
    if (!g) return
    const want = hidden ? 0 : hovered && interactive ? 1 : 0
    // idle once fully entered and settled at the target peek — no point
    // re-damping (and rewriting the transform) forever at rest
    if (enter.current === 1 && peek.current === want) return

    const dt = Math.min(delta, 0.05)
    const nextPeek = MathUtils.damp(peek.current, want, 9, dt)
    const nextEnter = MathUtils.damp(enter.current, 1, 6, dt)
    peek.current = Math.abs(nextPeek - want) < 1e-4 ? want : nextPeek
    enter.current = nextEnter >= 0.999 ? 1 : nextEnter

    const p = peek.current
    g.position.z = z + p * PEEK - (1 - enter.current) * 0.16
    g.rotation.x = p * 0.1
    g.visible = !hidden || p > 0.01
  })

  return (
    <group position={[x, y, z]} ref={grp}>
      <Clickable
        enabled={interactive && !hidden}
        label={spineTooltip(book)}
        onActivate={() => {
          const lib = useLibrary.getState()
          lib.select(lib.selectedId === book.id ? null : book.id)
          playClick()
        }}
      >
        <group
          onPointerOver={() => setHovered(true)}
          onPointerOut={() => setHovered(false)}
        >
          {/* the block of pages — identical putty colour on every
              volume, so all 113 share one material */}
          <mesh
            position={[0, dims.tall / 2, -0.004]}
            castShadow
            material={PAGE_MATERIAL}
          >
            <roundedBoxGeometry args={rb(dims.thick * 0.82, dims.tall * 0.96, dims.deep)} />
          </mesh>
          {/* boards + spine */}
          <mesh
            position={[0, dims.tall / 2, 0]}
            castShadow
            geometry={boardGeom}
            material={boardMaterial}
          />
          {/* ribbon marker for whatever is being read right now */}
          {book.status === 'reading' && (
            <mesh
              position={[0, dims.tall * 0.18, dims.deep / 2 - 0.004]}
              material={RIBBON_MATERIAL}
            >
              <planeGeometry args={[dims.thick * 0.4, dims.tall * 0.42]} />
            </mesh>
          )}
        </group>
      </Clickable>
    </group>
  )
}

/** Brass bookends holding each short row upright — static decor, so
    every end's base merges into one draw call and every end's upright
    merges into another, regardless of how many shelves are in use
    (was 2 draw calls per end). */
function Bookends({ ends }: { ends: { x: number; y: number }[] }) {
  const baseGeom = useMemo(
    () =>
      ends.length
        ? mergeGeometries(
            ends.map((e) => bakedBox(0.03, 0.008, 0.1, e.x + 0.014, e.y + 0.004, CASE_FRONT - 0.09)),
            false,
          )
        : null,
    [ends],
  )
  const uprightGeom = useMemo(
    () =>
      ends.length
        ? mergeGeometries(
            ends.map((e) => bakedBox(0.005, 0.11, 0.1, e.x + 0.002, e.y + 0.055, CASE_FRONT - 0.09)),
            false,
          )
        : null,
    [ends],
  )
  useEffect(() => () => baseGeom?.dispose(), [baseGeom])
  useEffect(() => () => uprightGeom?.dispose(), [uprightGeom])

  return (
    <>
      {baseGeom && (
        <mesh geometry={baseGeom} castShadow>
          <meshStandardMaterial color="#8a6a12" metalness={0.6} roughness={0.45} />
        </mesh>
      )}
      {uprightGeom && (
        <mesh geometry={uprightGeom} castShadow>
          <meshStandardMaterial color="#c9a227" metalness={0.7} roughness={0.35} />
        </mesh>
      )}
    </>
  )
}

/** The volume that is not a book. */
function SecretVolume() {
  const open = useLibrary((s) => s.open)
  const strip = useMemo(
    () => makeStrip('SOUBHIK.SYS', { fg: '#33ff66', bg: '#101a14', size: 30 }),
    [],
  )
  useEffect(() => () => strip.tex.dispose(), [strip])
  const y = SHELF_Y[SHELF_Y.length - 1]
  return (
    <group position={[CASE.inner / 2 - 0.03, y, CASE_FRONT - 0.09]}>
      <Clickable
        enabled={open}
        label="…that is not a book"
        onActivate={() => {
          useLibrary.getState().toggleSecret()
          useWorld.getState().mark('sys')
          playBeep()
        }}
      >
        <mesh position={[0, 0.1, 0]} castShadow>
          <roundedBoxGeometry args={rb(0.03, 0.2, 0.14)} />
          <meshStandardMaterial color="#101a14" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.1, 0.071]} rotation-z={Math.PI / 2}>
          <planeGeometry args={[0.16, 0.16 / strip.aspect]} />
          <meshBasicMaterial map={strip.tex} toneMapped={false} transparent />
        </mesh>
      </Clickable>
    </group>
  )
}

/** A leaning stack on the floor beside the case — pure decor, static
    and non-interactive, so the four differently-tinted volumes merge
    into one vertex-coloured draw call instead of four. */
function FloorStack({ oak }: { oak: CanvasTexture }) {
  const stack = useMemo(
    () => [
      { w: 0.16, h: 0.036, d: 0.12, c: '#7a3b2e', r: 0.04 },
      { w: 0.15, h: 0.03, d: 0.115, c: '#2c4a63', r: -0.06 },
      { w: 0.155, h: 0.042, d: 0.12, c: '#3a4a3c', r: 0.02 },
      { w: 0.14, h: 0.028, d: 0.11, c: '#5b3a56', r: -0.03 },
    ],
    [],
  )
  const stackGeom = useMemo(() => {
    let y = 0
    const parts = stack.map((b) => {
      const py = y + b.h / 2
      y += b.h
      return bakedBoxTinted(b.w, b.h, b.d, 0, py, 0, b.c, b.r)
    })
    return mergeGeometries(parts, false)
  }, [stack])
  useEffect(() => () => stackGeom?.dispose(), [stackGeom])

  return (
    <group position={[0.56, 0, 0.04]} rotation-y={-0.5}>
      {stackGeom && (
        <mesh geometry={stackGeom} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.9} />
        </mesh>
      )}
      {/* a mug nobody has taken back to the kitchen */}
      <mesh position={[0.11, 0.035, 0.08]} castShadow>
        <cylinderGeometry args={[0.032, 0.028, 0.07, 10]} />
        <meshStandardMaterial color={P.chassis} roughness={0.55} />
      </mesh>
      <mesh position={[0.11, 0.069, 0.08]}>
        <cylinderGeometry args={[0.027, 0.027, 0.004, 10]} />
        <meshStandardMaterial color="#3a2416" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[0.46, 0.4]} />
        <meshStandardMaterial map={oak} color="#2a2320" roughness={1} />
      </mesh>
    </group>
  )
}

/* ---------------------------------------------------------------------
   The volume in your hands.
   --------------------------------------------------------------------- */
const HELD_DIST = 0.52

function HeldBook({ slot, fontsReady }: { slot: Slot; fontsReady: boolean }) {
  const { book, dims } = slot
  const flipped = useLibrary((s) => s.flipped)
  const ink = useMemo(() => bookInk(book), [book])
  const covers = useMemo(
    () =>
      fontsReady
        ? { front: makeFrontCover(book), back: makeBackCover(book) }
        : null,
    [book, fontsReady],
  )
  useEffect(() => {
    if (!covers) return
    return () => {
      covers.front.dispose()
      covers.back.dispose()
    }
  }, [covers])

  const hint = useMemo(
    () =>
      makeStrip(
        book.status === 'shelved'
          ? 'CLICK TO TURN OVER  ·  ESC TO SHELVE  ·  NOT READ YET'
          : 'CLICK TO TURN OVER  ·  ESC TO SHELVE',
        { fg: '#cfe8df', bg: 'rgba(8,12,10,0.75)', size: 30 },
      ),
    [book.status],
  )
  useEffect(() => () => hint.tex.dispose(), [hint])

  /* where it left the shelf */
  const start = useMemo(
    () => caseToWorld(new Vector3(slot.x, slot.y + dims.tall / 2, CASE_FRONT - 0.09), new Vector3()),
    [slot.x, slot.y, dims.tall],
  )
  const startQuat = useMemo(
    () => new Quaternion().setFromEuler(new Euler(0, BOOKCASE_YAW + Math.PI / 2, 0)),
    [],
  )

  const grp = useRef<Group>(null!)
  const prog = useRef(0)
  const flip = useRef(0)
  const dir = useMemo(() => new Vector3(), [])
  const want = useMemo(() => new Vector3(), [])
  const q = useMemo(() => new Quaternion(), [])
  const flipQuat = useMemo(() => new Quaternion(), [])

  useFrame((state, delta) => {
    const g = grp.current
    if (!g) return
    const dt = Math.min(delta, 0.05)
    prog.current = MathUtils.damp(prog.current, 1, 6.5, dt)
    flip.current = MathUtils.damp(flip.current, flipped ? 1 : 0, 7, dt)

    const cam = state.camera
    cam.getWorldDirection(dir)
    want.copy(cam.position).addScaledVector(dir, HELD_DIST)
    g.position.lerpVectors(start, want, prog.current)

    flipQuat.setFromAxisAngle({ x: 0, y: 1, z: 0 }, flip.current * Math.PI)
    q.copy(cam.quaternion).multiply(flipQuat)
    g.quaternion.copy(startQuat).slerp(q, Math.min(1, prog.current * 1.15))
    const s = 0.55 + prog.current * 0.45
    g.scale.setScalar(s)
  })

  const w = dims.deep
  const h = dims.tall
  const t = dims.thick

  return (
    <group ref={grp} position={start}>
      <Clickable
        label={flipped ? 'turn back to the cover' : 'turn it over'}
        onActivate={() => {
          useLibrary.getState().flip()
          playClick()
        }}
      >
        {/* page block */}
        <mesh renderOrder={50}>
          <roundedBoxGeometry args={rb(w * 0.97, h * 0.97, t * 0.86)} />
          <meshBasicMaterial color="#e6dcc2" toneMapped={false} depthTest={false} transparent />
        </mesh>
        {/* boards: front faces +z, back faces -z, only one is ever seen */}
        <mesh position={[0, 0, t / 2]} renderOrder={52}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial
            key={covers ? 'printed' : 'plain'}
            map={covers?.front}
            color={covers ? '#ffffff' : ink.cloth}
            toneMapped={false}
            depthTest={false}
            transparent
          />
        </mesh>
        <mesh position={[0, 0, -t / 2]} rotation-y={Math.PI} renderOrder={52}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial
            key={covers ? 'printed' : 'plain'}
            map={covers?.back}
            color={covers ? '#ffffff' : ink.cloth}
            toneMapped={false}
            depthTest={false}
            transparent
          />
        </mesh>
        {/* the spine, hinged on the left */}
        <mesh position={[-w / 2, 0, 0]} rotation-y={-Math.PI / 2} renderOrder={52}>
          <planeGeometry args={[t, h]} />
          <meshBasicMaterial
            color={ink.cloth}
            toneMapped={false}
            depthTest={false}
            transparent
          />
        </mesh>
      </Clickable>
      <mesh position={[0, -h / 2 - 0.028, t / 2 + 0.001]} renderOrder={53}>
        <planeGeometry args={[0.18, 0.18 / hint.aspect]} />
        <meshBasicMaterial
          map={hint.tex}
          toneMapped={false}
          depthTest={false}
          transparent
        />
      </mesh>
      {book.status === 'shelved' && <DustPuff />}
    </group>
  )
}

/** Warm fill that fades up when you walk over — the corner stops being
    a black hole without disturbing the room's night mood from afar. */
function CornerFill({ open }: { open: boolean }) {
  const light = useRef<PointLight>(null!)
  useFrame((_, delta) => {
    const l = light.current
    if (!l) return
    // NB: deliberately NOT gating `visible` here — toggling a light's
    // visibility changes the scene's active light count, which forces
    // three to recompile a shader variant for every affected material
    // (measured: +82 programs on open). At intensity 0 this light costs
    // a per-fragment loop iteration, not a recompile storm; early-out
    // once settled is the safe win.
    const want = open ? 2.4 : 0
    if (l.intensity === want) return
    l.intensity = MathUtils.damp(l.intensity, want, 3, Math.min(delta, 0.05))
    if (Math.abs(l.intensity - want) < 0.01) l.intensity = want
  })
  return (
    <pointLight
      ref={light}
      position={[-0.85, 1.2, 0.6]}
      color="#ffd2a0"
      intensity={0}
      distance={3.6}
      decay={1.7}
    />
  )
}

/** Nobody has opened this one in a while. */
function DustPuff() {
  const tex = useMemo(() => makeSoftCircle(), [])
  useEffect(() => () => tex.dispose(), [tex])
  const motes = useRef<Sprite[]>([])
  const life = useRef(0)
  const seeds = useMemo(
    () => [0, 1, 2, 3, 4, 5].map((i) => ({ a: (i / 6) * Math.PI * 2, s: 0.6 + (i % 3) * 0.25 })),
    [],
  )

  useFrame((_, delta) => {
    // fully dispersed (opacity already 0 at t=1) — stop recomputing
    if (life.current >= 1) return
    life.current = Math.min(1, life.current + delta * 0.9)
    const t = life.current
    motes.current.forEach((m, i) => {
      if (!m) return
      const seed = seeds[i]
      m.position.set(
        Math.cos(seed.a) * 0.05 * t * seed.s,
        0.02 + t * 0.1 * seed.s,
        0.02 + t * 0.03,
      )
      m.scale.setScalar(0.012 + t * 0.05 * seed.s)
      ;(m.material as { opacity: number }).opacity = Math.max(0, 0.5 * (1 - t) ** 2)
    })
  })

  return (
    <>
      {seeds.map((_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            if (el) motes.current[i] = el
          }}
          renderOrder={54}
        >
          <spriteMaterial
            map={tex}
            color="#cfc3a6"
            transparent
            opacity={0.5}
            depthTest={false}
            toneMapped={false}
          />
        </sprite>
      ))}
    </>
  )
}
