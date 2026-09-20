import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  DoubleSide,
  ExtrudeGeometry,
  MathUtils,
  Shape,
  type CanvasTexture,
  type Group,
} from 'three'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import { projects } from '../data/resume'
import { LEDGER, useWorld } from '../world'
import Clickable from './Clickable'
import { DESK, DESK_TOP, P } from './layout'
import {
  drawPixelText,
  finish,
  makeCanvas,
  makeLabel,
  pixelTextWidth,
} from './textures'
import { rb } from './rbox'

/* =====================================================================
   The desk pedestal: two drawers that actually slide open.
   Top drawer — the project archive: floppies labelled with REAL project
   names from resume.ts. Bottom drawer — the Silver Star badge on its
   ribbon, and an envelope of "secrets" that only says NICE TRY! — until
   the ledger in src/world.ts is complete, when the note relents.
   ===================================================================== */

const PED = { w: 0.42, d: 0.5, h: DESK_TOP - DESK.thick } as const
const FRONT = PED.d / 2 // local z of the pedestal face
const SLIDE = 0.23 // how far a tray pulls out

/* Floppy labels — REAL project names pulled from resume.ts, shortened to
   fit a 3.5" label (first word-group of the name, uppercased). */
function shortName(name: string): string {
  return name.split(':')[0].toUpperCase().slice(0, 10)
}
const FLOPPY_LABELS: string[] = [
  shortName(projects[0].name), // AI FABRIC
  shortName(projects.find((p) => p.id === 'verifyx')?.name ?? projects[1].name),
  shortName(projects.find((p) => p.id === 'ankan')?.name ?? projects[2].name),
]
const FLOPPY_COLORS = ['#2b3a8c', '#8c2f26', '#26364a'] as const

function starGeometry(): ExtrudeGeometry {
  const shape = new Shape()
  const R = 0.026
  const r = 0.011
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    const x = Math.cos(a) * rad
    const y = Math.sin(a) * rad
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return new ExtrudeGeometry(shape, { depth: 0.005, bevelEnabled: false })
}

/** The note in the envelope. Locked: NICE TRY!  Complete: OK. FINE. —
    plus one smaller line in the owner's hand (pixel font, so only the
    glyphs textures.ts knows: A–Z, digits, . ! - _ : > /). */
function makeEnvelopeNote(complete: boolean): CanvasTexture {
  if (!complete) return makeLabel('NICE TRY!', '#1a1812', '#fdfcf7', 6, 10)
  const big = 'OK. FINE.'
  const small = ['THE DUCK SAID', 'YOU WOULD. - S.']
  const BIG = 6
  const SMALL = 4
  const PAD = 10
  const GAP = 8
  const LEAD = 6
  const bigW = pixelTextWidth(big) * BIG
  const smallW = Math.max(...small.map((l) => pixelTextWidth(l) * SMALL))
  const w = Math.max(bigW, smallW) + PAD * 2
  const h = PAD + 5 * BIG + GAP + small.length * (5 * SMALL + LEAD) - LEAD + PAD
  const ctx = makeCanvas(w, h)
  ctx.fillStyle = '#fdfcf7'
  ctx.fillRect(0, 0, w, h)
  drawPixelText(ctx, big, Math.round((w - bigW) / 2), PAD, BIG, '#1a1812')
  small.forEach((line, i) => {
    const lw = pixelTextWidth(line) * SMALL
    drawPixelText(
      ctx,
      line,
      Math.round((w - lw) / 2),
      PAD + 5 * BIG + GAP + i * (5 * SMALL + LEAD),
      SMALL,
      '#6b675c',
    )
  })
  return finish(ctx)
}

/** width/height plane size for a label texture at a given world width */
function labelSize(tex: CanvasTexture, width: number): [number, number] {
  const img = tex.image as HTMLCanvasElement
  return [width, (width * img.height) / img.width]
}

export default function Drawers() {
  const view = useSystem((s) => s.view)
  const [open, setOpen] = useState<[boolean, boolean]>([false, false])
  const [note, setNote] = useState(false)
  /* every secret in the ledger found → the note relents */
  const complete = useWorld((s) => LEDGER.every((e) => s.found.includes(e.id)))

  const trays = useRef<(Group | null)[]>([null, null])
  const noteRig = useRef<Group>(null!)
  const noteProg = useRef(0)

  const starGeo = useMemo(() => starGeometry(), [])
  const floppyTexes = useMemo(
    () => FLOPPY_LABELS.map((l) => makeLabel(l, '#1a1812', '#eceadf', 4, 4)),
    [],
  )
  const starTex = useMemo(
    () => makeLabel('SILVER STAR', '#cdd2dd', '#1d1f24', 4, 4),
    [],
  )
  const secretTex = useMemo(
    () => makeLabel('SECRETS', '#8a857a', null, 4, 2),
    [],
  )
  // re-drawn the moment completion flips (and the old one released)
  const noteTex = useMemo(() => makeEnvelopeNote(complete), [complete])
  useEffect(() => () => noteTex.dispose(), [noteTex])
  useEffect(
    () => () => {
      starGeo.dispose()
      floppyTexes.forEach((t) => t.dispose())
      starTex.dispose()
      secretTex.dispose()
    },
    [starGeo, floppyTexes, starTex, secretTex],
  )

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    trays.current.forEach((tray, i) => {
      if (!tray) return
      tray.position.z = MathUtils.damp(
        tray.position.z,
        open[i] ? SLIDE : 0,
        7,
        dt,
      )
    })
    noteProg.current = MathUtils.damp(noteProg.current, note ? 1 : 0, 9, dt)
    const g = noteRig.current
    if (g) {
      const p = noteProg.current
      g.position.y = 0.02 + p * 0.13
      g.rotation.x = -0.45 * p
      g.scale.setScalar(Math.max(0.001, p))
      g.visible = p > 0.02
    }
  })

  const toggle = (i: 0 | 1): void => {
    playClick()
    // closing the bottom drawer tucks the note back into its envelope
    if (i === 1 && open[1]) setNote(false)
    setOpen((o) => (i === 0 ? [!o[0], o[1]] : [o[0], !o[1]]))
  }

  return (
    <group position={[0.6, 0, -0.56]}>
      {/* pedestal shell */}
      <mesh position={[0, PED.h / 2, -0.01]} castShadow receiveShadow>
        <roundedBoxGeometry args={rb(PED.w, PED.h, PED.d)} />
        <meshStandardMaterial color="#503620" roughness={0.85} />
      </mesh>
      {/* kick plinth */}
      <mesh position={[0, 0.03, FRONT - 0.02]}>
        <roundedBoxGeometry args={rb(PED.w - 0.02, 0.06, 0.02)} />
        <meshStandardMaterial color="#3a2715" roughness={0.9} />
      </mesh>

      {[0, 1].map((i) => {
        const y = i === 0 ? 0.615 : 0.475
        return (
          <group key={i} position={[0, y, -0.01]}>
            <group
              ref={(el) => {
                trays.current[i] = el
              }}
            >
              <Clickable
                enabled={view === 'room'}
                label={i === 0 ? 'project archive' : 'bottom drawer'}
                onActivate={() => toggle(i as 0 | 1)}
              >
                {/* drawer front */}
                <mesh position={[0, 0, FRONT + 0.01]} castShadow>
                  <roundedBoxGeometry args={rb(PED.w - 0.04, 0.115, 0.02)} />
                  <meshStandardMaterial color="#5e4023" roughness={0.8} />
                </mesh>
                {/* handle */}
                <mesh position={[0, 0, FRONT + 0.028]}>
                  <roundedBoxGeometry args={rb(0.09, 0.012, 0.012)} />
                  <meshStandardMaterial
                    color={P.metal}
                    metalness={0.6}
                    roughness={0.4}
                  />
                </mesh>
              </Clickable>

              {/* tray box */}
              <mesh position={[0, -0.035, FRONT - 0.12]}>
                <roundedBoxGeometry args={rb(PED.w - 0.06, 0.012, 0.24)} />
                <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
              </mesh>
              {[-1, 1].map((s) => (
                <mesh
                  key={s}
                  position={[s * (PED.w / 2 - 0.036), -0.005, FRONT - 0.12]}
                >
                  <roundedBoxGeometry args={rb(0.01, 0.07, 0.24)} />
                  <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
                </mesh>
              ))}
              <mesh position={[0, -0.005, FRONT - 0.235]}>
                <roundedBoxGeometry args={rb(PED.w - 0.06, 0.07, 0.01)} />
                <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
              </mesh>

              {/* ============ contents ============ */}
              {i === 0 ? (
                <group position={[0, -0.025, FRONT - 0.12]}>
                  {FLOPPY_LABELS.map((label, k) => {
                    const [lw, lh] = labelSize(floppyTexes[k], 0.055)
                    return (
                      <group
                        key={label}
                        position={[-0.105 + k * 0.105, 0.004, 0.01]}
                        rotation-y={(k - 1) * 0.16}
                      >
                        <mesh castShadow>
                          <roundedBoxGeometry args={rb(0.09, 0.008, 0.093)} />
                          <meshStandardMaterial
                            color={FLOPPY_COLORS[k]}
                            roughness={0.8}
                          />
                        </mesh>
                        {/* metal shutter */}
                        <mesh position={[0.008, 0.0045, -0.028]}>
                          <roundedBoxGeometry args={rb(0.034, 0.001, 0.03)} />
                          <meshStandardMaterial
                            color="#b9bdc9"
                            metalness={0.7}
                            roughness={0.35}
                          />
                        </mesh>
                        {/* label */}
                        <mesh
                          position={[0, 0.0045, 0.02]}
                          rotation-x={-Math.PI / 2}
                        >
                          <planeGeometry args={[lw, lh]} />
                          <meshBasicMaterial map={floppyTexes[k]} />
                        </mesh>
                      </group>
                    )
                  })}
                </group>
              ) : (
                <group position={[0, -0.025, FRONT - 0.12]}>
                  {/* Silver Star badge on a felt pad */}
                  <group position={[-0.09, 0, 0]}>
                    <mesh position={[0, 0.004, 0]}>
                      <roundedBoxGeometry args={rb(0.1, 0.008, 0.1)} />
                      <meshStandardMaterial color="#3a1d20" roughness={1} />
                    </mesh>
                    {/* ribbon */}
                    <mesh position={[0, 0.01, -0.022]}>
                      <roundedBoxGeometry args={rb(0.026, 0.004, 0.036)} />
                      <meshStandardMaterial color="#8c2f26" roughness={0.7} />
                    </mesh>
                    <mesh
                      geometry={starGeo}
                      position={[0, 0.0105, 0.018]}
                      rotation-x={-Math.PI / 2}
                    >
                      <meshStandardMaterial
                        color="#cdd2dd"
                        metalness={0.85}
                        roughness={0.25}
                      />
                    </mesh>
                    {/* engraved plate */}
                    <mesh
                      position={[0, 0.0085, 0.046]}
                      rotation-x={-Math.PI / 2}
                    >
                      <planeGeometry args={labelSize(starTex, 0.07)} />
                      <meshBasicMaterial map={starTex} />
                    </mesh>
                  </group>

                  {/* envelope of secrets — filed upright against the back
                      of the tray. The room camera looks down over the
                      drawer front, so only the back of a tray is ever in
                      view: lying flat up front it was invisible. */}
                  <Clickable
                    enabled={view === 'room' && open[1]}
                    label="top secret"
                    onActivate={() => {
                      playClick()
                      setNote((n) => !n)
                    }}
                  >
                    <group position={[0.08, 0.004, -0.082]} rotation-y={-0.12}>
                      <group position={[0, 0.035, 0]} rotation-x={1.22}>
                        <mesh castShadow>
                          <roundedBoxGeometry args={rb(0.105, 0.004, 0.07)} />
                          <meshStandardMaterial color="#efe8d8" roughness={0.9} />
                        </mesh>
                        {/* flap seams */}
                        <mesh position={[-0.026, 0.0022, 0]} rotation-y={0.6}>
                          <roundedBoxGeometry args={rb(0.062, 0.0008, 0.0016)} />
                          <meshStandardMaterial
                            color="#c9c0ab"
                            roughness={0.9}
                          />
                        </mesh>
                        <mesh position={[0.026, 0.0022, 0]} rotation-y={-0.6}>
                          <roundedBoxGeometry args={rb(0.062, 0.0008, 0.0016)} />
                          <meshStandardMaterial
                            color="#c9c0ab"
                            roughness={0.9}
                          />
                        </mesh>
                        {/* wax seal */}
                        <mesh position={[0, 0.0028, 0]}>
                          <cylinderGeometry args={[0.008, 0.008, 0.002, 10]} />
                          <meshStandardMaterial color="#8c2f26" roughness={0.5} />
                        </mesh>
                        {/* faint SECRETS stamp */}
                        <mesh
                          position={[0, 0.0032, 0.022]}
                          rotation-x={-Math.PI / 2}
                        >
                          <planeGeometry args={labelSize(secretTex, 0.05)} />
                          <meshBasicMaterial map={secretTex} transparent />
                        </mesh>
                      </group>

                      {/* the note inside — "nice try" (or, eventually, not);
                          slides up out of the envelope's mouth */}
                      <group ref={noteRig} position={[0, 0.02, 0]} visible={false}>
                        <mesh>
                          <planeGeometry
                            args={labelSize(noteTex, complete ? 0.1 : 0.085)}
                          />
                          <meshBasicMaterial
                            map={noteTex}
                            toneMapped={false}
                            side={DoubleSide}
                          />
                        </mesh>
                      </group>
                    </group>
                  </Clickable>
                </group>
              )}
            </group>
          </group>
        )
      })}
    </group>
  )
}
