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
import Clickable from './Clickable'
import { DESK, DESK_TOP, P } from './layout'
import { makeLabel } from './textures'

/* =====================================================================
   The desk pedestal: two drawers that actually slide open.
   Top drawer — the project archive: floppies labelled with REAL project
   names from resume.ts. Bottom drawer — the Silver Star badge on its
   ribbon, and an envelope of "secrets" that only says NICE TRY!
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

/** width/height plane size for a label texture at a given world width */
function labelSize(tex: CanvasTexture, width: number): [number, number] {
  const img = tex.image as HTMLCanvasElement
  return [width, (width * img.height) / img.width]
}

export default function Drawers() {
  const view = useSystem((s) => s.view)
  const [open, setOpen] = useState<[boolean, boolean]>([false, false])
  const [note, setNote] = useState(false)

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
  const niceTryTex = useMemo(
    () => makeLabel('NICE TRY!', '#1a1812', '#fdfcf7', 6, 10),
    [],
  )
  useEffect(
    () => () => {
      starGeo.dispose()
      floppyTexes.forEach((t) => t.dispose())
      starTex.dispose()
      secretTex.dispose()
      niceTryTex.dispose()
    },
    [starGeo, floppyTexes, starTex, secretTex, niceTryTex],
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
        <boxGeometry args={[PED.w, PED.h, PED.d]} />
        <meshStandardMaterial color="#503620" roughness={0.85} />
      </mesh>
      {/* kick plinth */}
      <mesh position={[0, 0.03, FRONT - 0.02]}>
        <boxGeometry args={[PED.w - 0.02, 0.06, 0.02]} />
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
                  <boxGeometry args={[PED.w - 0.04, 0.115, 0.02]} />
                  <meshStandardMaterial color="#5e4023" roughness={0.8} />
                </mesh>
                {/* handle */}
                <mesh position={[0, 0, FRONT + 0.028]}>
                  <boxGeometry args={[0.09, 0.012, 0.012]} />
                  <meshStandardMaterial
                    color={P.metal}
                    metalness={0.6}
                    roughness={0.4}
                  />
                </mesh>
              </Clickable>

              {/* tray box */}
              <mesh position={[0, -0.035, FRONT - 0.12]}>
                <boxGeometry args={[PED.w - 0.06, 0.012, 0.24]} />
                <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
              </mesh>
              {[-1, 1].map((s) => (
                <mesh
                  key={s}
                  position={[s * (PED.w / 2 - 0.036), -0.005, FRONT - 0.12]}
                >
                  <boxGeometry args={[0.01, 0.07, 0.24]} />
                  <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
                </mesh>
              ))}
              <mesh position={[0, -0.005, FRONT - 0.235]}>
                <boxGeometry args={[PED.w - 0.06, 0.07, 0.01]} />
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
                          <boxGeometry args={[0.09, 0.008, 0.093]} />
                          <meshStandardMaterial
                            color={FLOPPY_COLORS[k]}
                            roughness={0.8}
                          />
                        </mesh>
                        {/* metal shutter */}
                        <mesh position={[0.008, 0.0045, -0.028]}>
                          <boxGeometry args={[0.034, 0.001, 0.03]} />
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
                      <boxGeometry args={[0.1, 0.008, 0.1]} />
                      <meshStandardMaterial color="#3a1d20" roughness={1} />
                    </mesh>
                    {/* ribbon */}
                    <mesh position={[0, 0.01, -0.022]}>
                      <boxGeometry args={[0.026, 0.004, 0.036]} />
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

                  {/* envelope of secrets */}
                  <Clickable
                    enabled={view === 'room' && open[1]}
                    label="top secret"
                    onActivate={() => {
                      playClick()
                      setNote((n) => !n)
                    }}
                  >
                    <group position={[0.08, 0.008, 0.01]} rotation-y={-0.18}>
                      <mesh castShadow>
                        <boxGeometry args={[0.105, 0.004, 0.07]} />
                        <meshStandardMaterial color="#efe8d8" roughness={0.9} />
                      </mesh>
                      {/* flap seams */}
                      <mesh position={[-0.026, 0.0022, 0]} rotation-y={0.6}>
                        <boxGeometry args={[0.062, 0.0008, 0.0016]} />
                        <meshStandardMaterial
                          color="#c9c0ab"
                          roughness={0.9}
                        />
                      </mesh>
                      <mesh position={[0.026, 0.0022, 0]} rotation-y={-0.6}>
                        <boxGeometry args={[0.062, 0.0008, 0.0016]} />
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

                      {/* the note inside — "nice try" */}
                      <group ref={noteRig} position={[0, 0.02, 0]} visible={false}>
                        <mesh>
                          <planeGeometry args={labelSize(niceTryTex, 0.085)} />
                          <meshBasicMaterial
                            map={niceTryTex}
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
