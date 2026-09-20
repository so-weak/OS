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
} from 'three'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import { useRoom } from './roomState'
import { awards, education, identity, summary } from '../data/resume'
import { useWorld } from '../world'
import Clickable from './Clickable'
import { DESK_TOP } from './layout'
import { finish, makeCanvas, makeDocument } from './textures'
import { rb } from './rbox'

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
const CARD_QUAT = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, CARD_YAW))
/* the lifted doc plane (portrait 512×704) */
const DOC_SIZE: [number, number] = [0.18, 0.2475]

interface LiftedDoc {
  tex: CanvasTexture
  size: [number, number]
  from: Vector3
  flat: Quaternion
}

export default function Papers() {
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
          {[0, 1, 2].map((i) => (
            <mesh
              key={i}
              position={[i * 0.004, DESK_TOP + 0.0012 + i * 0.0016, i * -0.006]}
              rotation-y={i * 0.06 - 0.05}
              receiveShadow
            >
              <roundedBoxGeometry args={rb(0.15, 0.0014, 0.21)} />
              <meshStandardMaterial color="#e9e6da" roughness={0.95} />
            </mesh>
          ))}
          {/* pen resting on top */}
          <mesh
            position={[0.05, DESK_TOP + 0.009, 0.06]}
            rotation={[Math.PI / 2, 0, 0.9]}
            castShadow
          >
            <cylinderGeometry args={[0.0035, 0.0035, 0.13, 8]} />
            <meshStandardMaterial color="#1f4d8a" roughness={0.4} />
          </mesh>
        </Clickable>
      </group>

      {/* the index card he left */}
      <group position={[CARD_POS.x, 0, CARD_POS.z]} rotation-y={CARD_YAW}>
        <Clickable
          enabled={view === 'room' && lifted === null}
          label="he left this for you"
          onActivate={() =>
            lift({ tex: cardTex, size: CARD_LIFTED, from: CARD_POS, flat: CARD_QUAT })
          }
        >
          <mesh position={[0, DESK_TOP + 0.0007, 0]} receiveShadow>
            <roundedBoxGeometry args={rb(CARD_SIZE[0], 0.0014, CARD_SIZE[1])} />
            <meshStandardMaterial color="#f4efe0" roughness={0.95} />
          </mesh>
          <mesh position={[0, DESK_TOP + 0.0015, 0]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={CARD_SIZE} />
            <meshBasicMaterial map={cardTex} toneMapped={false} />
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
