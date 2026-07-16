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
import Clickable from './Clickable'
import { DESK_TOP } from './layout'
import { makeDocument } from './textures'

/* =====================================================================
   The desk paper stack. Clicking it lifts the top sheet right up to the
   camera as a readable mini-doc (copy straight from resume.ts). Click
   the sheet to slide it back; the next click lifts the next document.
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

/* world pose of the stack (matches the old passive prop) */
const STACK_POS = new Vector3(-0.45, DESK_TOP + 0.006, -0.5)
const FLAT_QUAT = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0.3))

interface LiftedDoc {
  idx: number
  tex: CanvasTexture
}

export default function Papers() {
  const view = useSystem((s) => s.view)
  const [lifted, setLifted] = useState<LiftedDoc | null>(null)
  const nextDoc = useRef(0)
  const leaving = useRef(false)
  const prog = useRef(0)

  const sheet = useRef<Group>(null!)
  const texCache = useRef<(CanvasTexture | null)[]>(DOCS.map(() => null))

  // reusable scratch objects
  const dir = useMemo(() => new Vector3(), [])
  const want = useMemo(() => new Vector3(), [])

  useEffect(() => {
    const cache = texCache.current
    return () => {
      cache.forEach((t) => t?.dispose())
    }
  }, [])

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
    g.position.lerpVectors(STACK_POS, want, p)
    g.quaternion.copy(FLAT_QUAT).slerp(cam.quaternion, Math.min(1, p * 1.15))
  })

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
            prog.current = 0
            leaving.current = false
            setLifted({ idx: i, tex })
            useRoom.getState().setPaperUp(true)
            playClick()
          }}
        >
          {[0, 1, 2].map((i) => (
            <mesh
              key={i}
              position={[i * 0.004, DESK_TOP + 0.0012 + i * 0.0016, i * -0.006]}
              rotation-y={i * 0.06 - 0.05}
              receiveShadow
            >
              <boxGeometry args={[0.15, 0.0014, 0.21]} />
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
          <group ref={sheet} position={STACK_POS}>
            <mesh renderOrder={50}>
              <planeGeometry args={[0.18, 0.2475]} />
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
