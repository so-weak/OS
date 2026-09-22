import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  DoubleSide,
  Euler,
  MathUtils,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Group,
} from 'three'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import { useRoom } from './roomState'
import { awards, education, identity, summary } from '../data/resume'
import { useWorld } from '../world'
import Clickable from './Clickable'
import { DESK_TOP } from './layout'
import { finish, makeCanvas, makeDocument, mulberry } from './textures'
import {
  at,
  deform,
  lathe,
  mergeParts,
  paint,
  smoothstep,
  sweep,
  tint,
} from './tex/furniture'
import Staged from './Staged'

/* =====================================================================
   The desk paper stack. Clicking it lifts the top sheet right up to the
   camera as a readable mini-doc (copy straight from resume.ts). Click
   the sheet to slide it back; the next click lifts the next document.

   Beside it, a handwritten index card he left for whoever sits down —
   lifted the same way, never floating. Reading all three documents on
   the stack marks `papers3` in the world's ledger.
   ===================================================================== */

const DOCS: { title: string; body: string[] }[] = [
  {
    title: 'README.TXT',
    body: [`${identity.name} — ${identity.title}`, summary],
  },
  {
    title: 'AWARDS.TXT',
    body: awards.map((a) => `* ${a.title} — ${a.detail}`),
  },
  {
    title: 'EDUCATION.TXT',
    body: education.map(
      (e) => `* ${e.degree} — ${e.school}, ${e.period} (${e.score})`,
    ),
  },
]

/* ---------- the index card (E-6) ---------- */
const NOTE_LINES = [
  'Hi — back in five.',
  'Everything is clickable.',
  "Resume's on the desktop,",
  'the snake is optional.',
] as const
const NOTE_SIGN = '— S.'

/* a 3×5 card: 512×320 texels, 0.125×0.078 m on the desk */
const CARD_W = 512
const CARD_H = 320
const CARD_SIZE: [number, number] = [0.125, 0.078]
/* a bit bigger than life when held up, so the handwriting is readable */
const CARD_LIFTED: [number, number] = [0.2, 0.125]

/** Ruled index card with the note in a handwritten face. Same hand as
    the sticky note on the bezel (textures.ts) — system script fonts,
    nothing to wait for. */
function makeIndexCard(): CanvasTexture {
  const ctx = makeCanvas(CARD_W, CARD_H)
  ctx.fillStyle = '#f4efe0'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  // worn edges
  ctx.fillStyle = 'rgba(68, 65, 58, 0.14)'
  ctx.fillRect(0, 0, CARD_W, 3)
  ctx.fillRect(0, CARD_H - 3, CARD_W, 3)
  ctx.fillRect(0, 0, 3, CARD_H)
  ctx.fillRect(CARD_W - 3, 0, 3, CARD_H)
  // red head rule + blue feint lines
  ctx.fillStyle = 'rgba(232, 72, 63, 0.45)'
  ctx.fillRect(0, 64, CARD_W, 3)
  ctx.fillStyle = 'rgba(40, 65, 126, 0.22)'
  const RULES = [112, 160, 208, 256]
  RULES.forEach((y) => ctx.fillRect(0, y, CARD_W, 2))

  ctx.fillStyle = '#28417e'
  ctx.font = "31px 'Comic Sans MS', 'Marker Felt', 'Segoe Print', cursive"
  ctx.save()
  ctx.rotate(-0.012)
  // the greeting sits above the head rule, the rest ride the feint lines
  ctx.fillText(NOTE_LINES[0], 34, 52)
  NOTE_LINES.slice(1).forEach((line, i) => {
    ctx.fillText(line, 34, RULES[i] - 8)
  })
  ctx.textAlign = 'right'
  ctx.fillText(NOTE_SIGN, CARD_W - 40, RULES[3] - 8)
  ctx.restore()
  return finish(ctx, false)
}

/* world pose of the stack (matches the old passive prop) */
const STACK_POS = new Vector3(-0.45, DESK_TOP + 0.006, -0.5)
const FLAT_QUAT = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0.3))

/* the card lies flat between the stack and the keyboard */
const CARD_YAW = -0.22
const CARD_POS = new Vector3(-0.24, DESK_TOP + 0.0018, -0.35)
const CARD_QUAT = new Quaternion().setFromEuler(
  new Euler(-Math.PI / 2, 0, CARD_YAW),
)
/* the lifted doc plane (portrait 512×704) */
const DOC_SIZE: [number, number] = [0.18, 0.2475]

interface LiftedDoc {
  tex: CanvasTexture
  size: [number, number]
  from: Vector3
  flat: Quaternion
}

/* ---------- the stack, the pen and the paperclip (looks only) ---------- */

const SHEETS = 10
const SHEET_W = 0.15
const SHEET_D = 0.21
const SHEET_T = 0.0007
/** stack-local y (world y, the group sits at the floor) of a sheet's underside */
const sheetY = (i: number): number => DESK_TOP + 0.0004 + i * 0.00075
const STACK_TOP = sheetY(SHEETS - 1) + SHEET_T

/** the upper sheets lift a corner and bow a little, like paper that has
    been picked up and put down */
const curlShape =
  (amount: number) =>
  (p: Vector3): void => {
    const nx = p.x / (SHEET_W / 2)
    const nz = p.z / (SHEET_D / 2)
    p.y += amount * smoothstep(0.35, 1, nx) * smoothstep(0.2, 1, nz)
    p.y += amount * 0.35 * (1 - nz * nz) * smoothstep(-1, 1, nx)
  }

interface StackGeo {
  sheets: BufferGeometry
  top: BufferGeometry
  pen: BufferGeometry
  penMetal: BufferGeometry
  clip: BufferGeometry
}

function buildStack(): StackGeo {
  const rand = mulberry(41)
  const sheets: BufferGeometry[] = []
  for (let i = 0; i < SHEETS; i++) {
    const curl = i >= SHEETS - 3
    const g = curl
      ? new BoxGeometry(SHEET_W, SHEET_T, SHEET_D, 8, 1, 12)
      : new BoxGeometry(SHEET_W, SHEET_T, SHEET_D, 1, 1, 1)
    if (curl) deform(g, curlShape(0.0018 * (i - (SHEETS - 4))))
    const v = 0.955 + rand() * 0.045
    paint(g, (_p, n, c) => {
      // the edge of a ream is a shade darker than its face
      c.setRGB(0.86, 0.85, 0.8).multiplyScalar(
        Math.abs(n.y) < 0.5 ? 0.86 : v * 1.12,
      )
    })
    at(
      g,
      (rand() - 0.5) * 0.004 + i * 0.0004,
      sheetY(i) + SHEET_T / 2,
      (rand() - 0.5) * 0.004 - i * 0.0005,
      0,
      (rand() - 0.5) * 0.05,
      0,
    )
    sheets.push(g)
  }
  // the printout on top: a curled plane, so the print follows the curl
  const top = new PlaneGeometry(SHEET_W, SHEET_D, 8, 12)
  top.rotateX(-Math.PI / 2)
  deform(top, curlShape(0.0018 * (SHEETS - 1 - (SHEETS - 4))))
  at(top, 0.0044, STACK_TOP + 0.0002, -0.0055, 0, 0.02, 0)

  /* ---- ballpoint pen: axis Y, tip down, about 13.5 cm ---- */
  const penBody = lathe(
    [
      [0.0022, -0.0545],
      [0.0027, -0.0525],
      [0.0031, -0.047],
      [0.0037, -0.04],
      [0.0039, -0.0385],
      [0.0039, -0.0225],
      [0.0038, -0.0215],
      [0.0038, 0.043],
      [0.004, 0.0445],
      [0.004, 0.0655],
      [0.0035, 0.0668],
      [0.0018, 0.0675],
      [0, 0.0675],
    ],
    { segments: 14, crease: 0.7, vTile: 0.05, uTile: 0.05 },
  )
  paint(penBody, (p, _n, c) => {
    if (p.y < -0.0385)
      c.setRGB(0.02, 0.022, 0.03) // black nose cone
    else if (p.y < -0.0215)
      c.setRGB(0.03, 0.03, 0.035) // rubber grip
    else if (p.y < 0.0445)
      c.setRGB(0.012, 0.06, 0.22) // blue barrel
    else c.setRGB(0.02, 0.03, 0.08) // cap
  })
  const clipPath = new CatmullRomCurve3(
    [
      new Vector3(0.0041, 0.0668, 0),
      new Vector3(0.0056, 0.0655, 0),
      new Vector3(0.0061, 0.05, 0),
      new Vector3(0.0059, 0.032, 0),
      new Vector3(0.0051, 0.0255, 0),
    ],
    false,
    'centripetal',
  ).getPoints(24)
  const clip = at(
    sweep({
      path: clipPath,
      radial: 8,
      size: () => [0.00035, 0.0022],
      ref: new Vector3(0, 0, 1),
      exponent: 4,
      capStart: true,
      capEnd: true,
      vTile: 0.05,
    }),
    0,
    0,
    0,
    0,
    Math.PI / 2 - 0.6,
    0,
  )
  const tip = lathe(
    [
      [0, -0.0675],
      [0.0005, -0.0671],
      [0.001, -0.0625],
      [0.0021, -0.0548],
      [0.0023, -0.0543],
      [0.0015, -0.0543],
    ],
    { segments: 10, crease: 1.2 },
  )
  return {
    sheets: mergeParts(sheets, true),
    top,
    pen: mergeParts([penBody], true),
    penMetal: mergeParts([clip, tip]),
    clip: buildClip(),
  }
}

/** a Gem paperclip: an oval wire spiral about 3.5 cm long */
function buildClip(): BufferGeometry {
  const pts: Vector3[] = []
  const N = 70
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const th = t * Math.PI * 2 * 2.45 + 0.4
    const a = 0.0175 - 0.0075 * t
    const b = 0.0049 - 0.0019 * t
    pts.push(new Vector3(a * Math.cos(th) - 0.0035 * t, 0, b * Math.sin(th)))
  }
  return tint(
    sweep({
      path: pts,
      radial: 6,
      size: () => [0.00045, 0.00045],
      capStart: true,
      capEnd: true,
      vTile: 0.02,
    }),
    '#c9ced6',
  )
}

/** greeked print: heading, paragraphs, a chart — no words, so no facts */
function makePrintout(): CanvasTexture {
  const W = 256
  const H = 352
  const ctx = makeCanvas(W, H)
  const rand = mulberry(19)
  ctx.fillStyle = '#f3f0e7'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(28,28,34,0.88)'
  ctx.fillRect(24, 26, 104, 10)
  ctx.fillStyle = 'rgba(60,60,68,0.5)'
  ctx.fillRect(24, 44, 64, 4)
  let y = 64
  while (y < H - 40) {
    const lines = 4 + Math.floor(rand() * 5)
    for (let k = 0; k < lines && y < H - 40; k++, y += 7) {
      const w = k === lines - 1 ? 60 + rand() * 90 : 196 + rand() * 12
      ctx.fillStyle = `rgba(48,48,56,${0.42 + rand() * 0.2})`
      ctx.fillRect(24, y, w, 2.4)
    }
    y += 9
    if (y > 150 && y < 180) {
      // a small bar chart
      ctx.strokeStyle = 'rgba(48,48,56,0.55)'
      ctx.strokeRect(24, y, 208, 56)
      for (let b = 0; b < 8; b++) {
        ctx.fillStyle = 'rgba(40,70,140,0.55)'
        const bh = 8 + rand() * 38
        ctx.fillRect(34 + b * 24, y + 52 - bh, 14, bh)
      }
      y += 70
    }
  }
  const t = new CanvasTexture(ctx.canvas)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** an index card that has lived in a pocket: corners lifted, edges soft */
function buildCard(): BufferGeometry {
  const g = new PlaneGeometry(CARD_SIZE[0], CARD_SIZE[1], 10, 6)
  g.rotateX(-Math.PI / 2)
  deform(g, (p) => {
    const nx = p.x / (CARD_SIZE[0] / 2)
    const nz = p.z / (CARD_SIZE[1] / 2)
    p.y += 0.0022 * smoothstep(0.55, 1, nx) * smoothstep(0.3, 1, nz)
    p.y += 0.0009 * smoothstep(0.7, 1, -nx) * smoothstep(0.5, 1, -nz)
    p.y += 0.0007 * (nx * nx)
  })
  return g
}

function PapersBody() {
  const view = useSystem((s) => s.view)
  const [lifted, setLifted] = useState<LiftedDoc | null>(null)
  const nextDoc = useRef(0)
  const leaving = useRef(false)
  const prog = useRef(0)
  /** which of the three documents have been lifted this session */
  const read = useRef(new Set<number>())

  const sheet = useRef<Group>(null!)
  const texCache = useRef<(CanvasTexture | null)[]>(DOCS.map(() => null))
  const cardTex = useMemo(() => makeIndexCard(), [])
  const looks = useMemo(() => buildStack(), [])
  const cardGeo = useMemo(() => buildCard(), [])
  const printTex = useMemo(() => makePrintout(), [])
  useEffect(
    () => () => {
      Object.values(looks).forEach((g) => g.dispose())
      cardGeo.dispose()
      printTex.dispose()
    },
    [looks, cardGeo, printTex],
  )

  // reusable scratch objects
  const dir = useMemo(() => new Vector3(), [])
  const want = useMemo(() => new Vector3(), [])

  useEffect(() => {
    const cache = texCache.current
    return () => {
      cache.forEach((t) => t?.dispose())
    }
  }, [])
  useEffect(() => () => cardTex.dispose(), [cardTex])

  // zooming into the screen politely puts the paper away
  useEffect(() => {
    if (view !== 'room' && lifted !== null) leaving.current = true
  }, [view, lifted])

  useFrame((state, delta) => {
    if (lifted === null) return
    const dt = Math.min(delta, 0.05)
    prog.current = MathUtils.damp(prog.current, leaving.current ? 0 : 1, 6, dt)
    if (leaving.current && prog.current < 0.02) {
      prog.current = 0
      leaving.current = false
      setLifted(null)
      useRoom.getState().setPaperUp(false)
      return
    }
    const g = sheet.current
    if (!g) return
    const cam = state.camera
    cam.getWorldDirection(dir)
    want.copy(cam.position).addScaledVector(dir, 0.4)
    const p = prog.current
    g.position.lerpVectors(lifted.from, want, p)
    g.quaternion.copy(lifted.flat).slerp(cam.quaternion, Math.min(1, p * 1.15))
  })

  const lift = (doc: LiftedDoc): void => {
    prog.current = 0
    leaving.current = false
    setLifted(doc)
    useRoom.getState().setPaperUp(true)
    playClick()
  }

  return (
    <>
      {/* the stack on the desk */}
      <group position={[STACK_POS.x, 0, STACK_POS.z]} rotation-y={0.3}>
        <Clickable
          enabled={view === 'room' && lifted === null}
          label="the paperwork"
          onActivate={() => {
            const i = nextDoc.current
            nextDoc.current = (i + 1) % DOCS.length
            // drawn lazily on first lift, after fonts have surely loaded
            const tex =
              texCache.current[i] ?? makeDocument(DOCS[i].title, DOCS[i].body)
            texCache.current[i] = tex
            read.current.add(i)
            if (read.current.size === DOCS.length) {
              useWorld.getState().mark('papers3')
            }
            lift({ tex, size: DOC_SIZE, from: STACK_POS, flat: FLAT_QUAT })
          }}
        >
          {/* a ream's worth of sheets, none quite square with the others */}
          <mesh
            geometry={looks.sheets}
            receiveShadow
            castShadow
            matrixAutoUpdate={false}
          >
            <meshStandardMaterial vertexColors roughness={0.92} />
          </mesh>
          {/* the printout on top */}
          <mesh geometry={looks.top} receiveShadow matrixAutoUpdate={false}>
            <meshStandardMaterial
              map={printTex}
              roughness={0.9}
              polygonOffset
              polygonOffsetFactor={-1}
              polygonOffsetUnits={-1}
            />
          </mesh>
          {/* pen resting on top: barrel, cap and clip, steel tip */}
          <group
            position={[0.045, STACK_TOP + 0.0045, 0.055]}
            rotation={[Math.PI / 2, 0, 0.9]}
          >
            <mesh geometry={looks.pen} castShadow matrixAutoUpdate={false}>
              <meshPhysicalMaterial
                vertexColors
                roughness={0.32}
                clearcoat={0.8}
                clearcoatRoughness={0.2}
              />
            </mesh>
            <mesh
              geometry={looks.penMetal}
              castShadow
              matrixAutoUpdate={false}
            >
              <meshStandardMaterial
                color="#c4c9d1"
                metalness={1}
                roughness={0.28}
              />
            </mesh>
          </group>
          {/* a paperclip on the corner */}
          <mesh
            geometry={looks.clip}
            position={[-0.048, STACK_TOP + 0.0016, -0.078]}
            rotation={[0, 0.5, 0]}
            castShadow
          >
            <meshStandardMaterial vertexColors metalness={1} roughness={0.3} />
          </mesh>
        </Clickable>
      </group>

      {/* the index card he left */}
      <group position={[CARD_POS.x, 0, CARD_POS.z]} rotation-y={CARD_YAW}>
        <Clickable
          enabled={view === 'room' && lifted === null}
          label="he left this for you"
          onActivate={() =>
            lift({
              tex: cardTex,
              size: CARD_LIFTED,
              from: CARD_POS,
              flat: CARD_QUAT,
            })
          }
        >
          <mesh
            geometry={cardGeo}
            position={[0, DESK_TOP + 0.0006, 0]}
            receiveShadow
          >
            <meshStandardMaterial
              map={cardTex}
              emissive="#ffffff"
              emissiveMap={cardTex}
              emissiveIntensity={0.22}
              roughness={0.92}
              side={DoubleSide}
            />
          </mesh>
        </Clickable>
      </group>

      {/* the lifted, readable sheet */}
      {lifted !== null && (
        <Clickable
          label="put it back"
          onActivate={() => {
            leaving.current = true
            playClick()
          }}
        >
          {/* renderOrder + no depthTest: the CRT's occluder mesh (drei
              occlude="blending") punches an alpha-0 hole in the canvas at
              renderOrder 0; painting the sheet after it refills the hole
              with opaque texels wherever the sheet crosses the glass.
              `transparent` moves the sheet into the transparent pass so
              it also paints over the phosphor-bleed halo and dust motes —
              with depthTest off the sheet writes no depth, so anything
              transparent drawn later would land on top of it. */}
          <group ref={sheet} position={lifted.from}>
            <mesh renderOrder={50}>
              <planeGeometry args={lifted.size} />
              <meshBasicMaterial
                map={lifted.tex}
                toneMapped={false}
                side={DoubleSide}
                depthTest={false}
                transparent
              />
            </mesh>
          </group>
        </Clickable>
      )}
    </>
  )
}

/* first load: mounted in its own turn of the staged build (stage.ts) */
export default function Papers() {
  return (
    <Staged id="papers">
      <PapersBody />
    </Staged>
  )
}
