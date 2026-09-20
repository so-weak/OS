import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  DoubleSide,
  Euler,
  MathUtils,
  Quaternion,
  Vector3,
  type CanvasTexture,
  type Group,
  type Mesh,
  type PointLight,
  type Sprite,
} from 'three'
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
  makeSpine,
  makeStrip,
  spineTooltip,
  type BookDims,
} from './libraryTextures'
import { makeSoftCircle, makeWood } from './textures'
import { useFontsReady } from '../useFontsReady'
import { LEDGER, useWorld } from '../world'
import { rb } from './rbox'

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
const GAP = 0.005
/** How far a hovered spine creeps out of the shelf. */
const PEEK = 0.026

type Shelves = Book[][]

/** Newest reads first, so the top shelf is what you just put down. */
function shelfOrder(): Book[] {
  return [...books].sort(
    (a, b) =>
      (b.finished ?? '').localeCompare(a.finished ?? '') ||
      a.title.localeCompare(b.title),
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
      (row) => row.reduce((sum, b) => sum + width(b), 0) > CASE.inner,
    )
    if (!overflows) return { shelves: even, shown: list.length }
  }

  const shelves: Shelves = [[]]
  let used = 0
  let shown = 0
  for (const b of list) {
    const w = width(b)
    if (used + w > CASE.inner && shelves[shelves.length - 1].length) {
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
    let x = -run / 2
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
    ends.push({ x: run / 2 + 0.012, y: shelfHeight(i) })
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

  /* Stamped titles are only legible at the shelf, so the spine textures
     live exactly as long as the visit does: built on the way in,
     released on the way out. From the room the books are just cloth,
     which is all you can see from there anyway. */
  const spines = useMemo(
    () =>
      fontsReady && open
        ? new Map<string, CanvasTexture>(books.map((b) => [b.id, makeSpine(b)]))
        : null,
    [fontsReady, open],
  )
  useEffect(() => {
    if (!spines) return
    return () => spines.forEach((t) => t.dispose())
  }, [spines])

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
                spine={spines?.get(slot.book.id) ?? null}
                interactive={open}
                hidden={slot.book.id === selectedId}
              />
            ))}

            {ends.map((e) => (
              <Bookend key={`${e.x}-${e.y}`} x={e.x} y={e.y} />
            ))}

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
  return (
    <group>
      {/* plinth */}
      <mesh position={[0, CASE.plinth / 2, 0]} castShadow receiveShadow>
        <roundedBoxGeometry args={rb(CASE.w + 0.04, CASE.plinth, CASE.d + 0.02)} />
        <meshStandardMaterial map={oakDark} roughness={0.85} />
      </mesh>
      {/* stiles */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * (half - CASE.side / 2), CASE.plinth + stileH / 2, 0]}
          castShadow
          receiveShadow
        >
          <roundedBoxGeometry args={rb(CASE.side, stileH, CASE.d)} />
          <meshStandardMaterial map={oak} roughness={0.8} />
        </mesh>
      ))}
      {/* back panel */}
      <mesh position={[0, CASE.plinth + stileH / 2, -CASE.d / 2 + 0.008]} receiveShadow>
        <roundedBoxGeometry args={rb(CASE.w - CASE.side, stileH, 0.016)} />
        <meshStandardMaterial map={oakDark} roughness={0.95} />
      </mesh>
      {/* shelf boards — SHELF_Y[0] doubles as the base board, so there is
          no second slab coplanar with it */}
      {SHELF_Y.map((y) => (
        <mesh key={y} position={[0, y - CASE.board / 2, 0.006]} castShadow receiveShadow>
          <roundedBoxGeometry args={rb(CASE.w - CASE.side, CASE.board, CASE.d - 0.02)} />
          <meshStandardMaterial map={oak} roughness={0.82} />
        </mesh>
      ))}
      {/* top board + cornice */}
      <mesh position={[0, CASE.h - 0.075, 0]} castShadow receiveShadow>
        <roundedBoxGeometry args={rb(CASE.w - CASE.side, CASE.board, CASE.d - 0.02)} />
        <meshStandardMaterial map={oak} roughness={0.82} />
      </mesh>
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
    g.opacity = MathUtils.damp(g.opacity, open ? 0.85 : 0, 4, Math.min(delta, 0.05))
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
      <pointLight position={[0, 0, 0.14]} color="#33ff66" intensity={open ? 0.5 : 0} distance={0.7} />
    </group>
  )
}

/* ---------------------------------------------------------------------
   One volume on the shelf.
   --------------------------------------------------------------------- */
function ShelfBook({
  slot,
  spine,
  interactive,
  hidden,
}: {
  slot: Slot
  spine: CanvasTexture | null
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

  useFrame((_, delta) => {
    const g = grp.current
    if (!g) return
    const dt = Math.min(delta, 0.05)
    const want = hidden ? 0 : hovered && interactive ? 1 : 0
    peek.current = MathUtils.damp(peek.current, want, 9, dt)
    enter.current = MathUtils.damp(enter.current, 1, 6, dt)
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
          {/* the block of pages */}
          <mesh position={[0, dims.tall / 2, -0.004]} castShadow>
            <roundedBoxGeometry args={rb(dims.thick * 0.82, dims.tall * 0.96, dims.deep)} />
            <meshStandardMaterial color="#e6dcc2" roughness={0.95} />
          </mesh>
          {/* boards + spine */}
          <mesh position={[0, dims.tall / 2, 0]} castShadow>
            <roundedBoxGeometry args={rb(dims.thick, dims.tall, dims.deep * 0.99)} />
            {/* the key rebuilds the material when the stamped spine
                arrives: three compiles map support into the shader at
                creation, so patching .map onto a plain material later
                would leave the title invisible */}
            <meshStandardMaterial
              key={spine ? 'lettered' : 'plain'}
              color={spine ? '#ffffff' : ink.cloth}
              map={spine ?? undefined}
              roughness={0.86}
            />
          </mesh>
          {/* ribbon marker for whatever is being read right now */}
          {book.status === 'reading' && (
            <mesh position={[0, dims.tall * 0.18, dims.deep / 2 - 0.004]}>
              <planeGeometry args={[dims.thick * 0.4, dims.tall * 0.42]} />
              <meshStandardMaterial color="#b5220a" roughness={0.7} side={DoubleSide} />
            </mesh>
          )}
        </group>
      </Clickable>
    </group>
  )
}

/** Brass bookend holding a short row upright. */
function Bookend({ x, y }: { x: number; y: number }) {
  return (
    <group position={[x, y, CASE_FRONT - 0.09]}>
      <mesh position={[0.014, 0.004, 0]} castShadow>
        <roundedBoxGeometry args={rb(0.03, 0.008, 0.1)} />
        <meshStandardMaterial color="#8a6a12" metalness={0.6} roughness={0.45} />
      </mesh>
      <mesh position={[0.002, 0.055, 0]} castShadow>
        <roundedBoxGeometry args={rb(0.005, 0.11, 0.1)} />
        <meshStandardMaterial color="#c9a227" metalness={0.7} roughness={0.35} />
      </mesh>
    </group>
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

/** A leaning stack on the floor beside the case — pure decor. */
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
  let y = 0
  return (
    <group position={[0.56, 0, 0.04]} rotation-y={-0.5}>
      {stack.map((b, i) => {
        const py = y + b.h / 2
        y += b.h
        return (
          <mesh key={i} position={[0, py, 0]} rotation-y={b.r} castShadow receiveShadow>
            <roundedBoxGeometry args={rb(b.w, b.h, b.d)} />
            <meshStandardMaterial color={b.c} roughness={0.9} />
          </mesh>
        )
      })}
      {/* a mug nobody has taken back to the kitchen */}
      <mesh position={[0.11, 0.035, 0.08]} castShadow>
        <cylinderGeometry args={[0.032, 0.028, 0.07, 14]} />
        <meshStandardMaterial color={P.chassis} roughness={0.55} />
      </mesh>
      <mesh position={[0.11, 0.069, 0.08]}>
        <cylinderGeometry args={[0.027, 0.027, 0.004, 14]} />
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
    l.intensity = MathUtils.damp(l.intensity, open ? 2.4 : 0, 3, Math.min(delta, 0.05))
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
