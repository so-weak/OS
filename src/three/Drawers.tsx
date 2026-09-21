import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  CatmullRomCurve3,
  DoubleSide,
  ExtrudeGeometry,
  MathUtils,
  Shape,
  Vector3,
  type BufferGeometry,
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
import { brushedMetalMaps } from './tex/noise'
import {
  at,
  deform,
  lathe,
  mergeParts,
  softBox,
  sweep,
  tint,
  useWood,
  woodBox,
} from './tex/furniture'

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

/* ---------- the carcass, fronts and hardware ---------- */

/** drawer front height (pitch is 0.14, so a 5 mm reveal between them) */
const FRONT_H = 0.135
/** face of a drawer front, in tray space */
const FACE_Z = FRONT + 0.02
/** the file drawer that never opens, low on the pedestal */
const FILE = { y: 0.2373, h: 0.33 }

function buildCarcass(): BufferGeometry {
  const parts: BufferGeometry[] = []
  // side boards, vertical grain
  for (const s of [-1, 1]) {
    parts.push(
      tint(
        at(
          woodBox(0.018, PED.h, 0.5, 0.004, 2, 0.4, 'y'),
          s * (PED.w / 2 - 0.009),
          PED.h / 2,
          -0.01,
        ),
        '#c9baa6',
      ),
    )
  }
  // back board
  parts.push(
    tint(
      at(
        woodBox(0.4, PED.h - 0.08, 0.01, 0.002, 1, 0.4, 'x'),
        0,
        PED.h / 2 + 0.03,
        -0.255,
      ),
      '#8a7a68',
    ),
  )
  // dark front plate: what shows through the reveals
  parts.push(
    tint(
      at(
        woodBox(0.4, PED.h - 0.07, 0.012, 0.002, 1, 0.4, 'x'),
        0,
        0.07 + (PED.h - 0.07) / 2,
        0.234,
      ),
      '#3a3128',
    ),
  )
  // recessed toe-kick
  parts.push(
    tint(
      at(woodBox(0.4, 0.07, 0.42, 0.003, 1, 0.4, 'x'), 0, 0.035, -0.04),
      '#40372d',
    ),
  )
  // little leveller feet
  for (const sx of [-1, 1]) {
    parts.push(
      tint(
        at(
          lathe(
            [
              [0, 0],
              [0.014, 0],
              [0.014, 0.006],
              [0.01, 0.008],
              [0, 0.008],
            ],
            { segments: 10 },
          ),
          sx * 0.17,
          0,
          0.14,
        ),
        '#17181a',
      ),
    )
  }
  return mergeParts(parts, true)
}

function buildTray(): BufferGeometry {
  const parts: BufferGeometry[] = [
    tint(
      at(
        woodBox(PED.w - 0.06, 0.012, 0.24, 0.002, 1, 0.4, 'x'),
        0,
        -0.035,
        FRONT - 0.12,
      ),
      '#d8c4a8',
    ),
    tint(
      at(
        woodBox(PED.w - 0.06, 0.07, 0.01, 0.002, 1, 0.4, 'x'),
        0,
        -0.005,
        FRONT - 0.235,
      ),
      '#d8c4a8',
    ),
  ]
  for (const s of [-1, 1]) {
    parts.push(
      tint(
        at(
          woodBox(0.01, 0.07, 0.24, 0.002, 1, 0.4, 'z'),
          s * (PED.w / 2 - 0.036),
          -0.005,
          FRONT - 0.12,
        ),
        '#d8c4a8',
      ),
    )
  }
  return mergeParts(parts, true)
}

/** the three floppies, baked into the tray's frame (the group at
    [0, -0.025, FRONT - 0.12]): a slab with a cut corner, a write-protect
    hole, a steel shutter with its slot */
function buildFloppies(): { plastic: BufferGeometry; metal: BufferGeometry } {
  const plastic: BufferGeometry[] = []
  const metal: BufferGeometry[] = []
  FLOPPY_COLORS.forEach((hex, k) => {
    const x = -0.105 + k * 0.105
    const ry = (k - 1) * 0.16
    const pose = (
      g: BufferGeometry,
      lx = 0,
      ly = 0,
      lz = 0,
    ): BufferGeometry => {
      g.translate(lx, ly, lz)
      return at(g, x, 0.004, 0.01, 0, ry, 0)
    }
    const body = softBox(0.09, 0.008, 0.093, 0.0018, 0.05, 3)
    // the cut corner, front right
    deform(body, (p) => {
      const d = p.x / 0.045 + p.z / 0.0465 - 1.72
      if (d > 0) {
        p.x -= d * 0.02
        p.z -= d * 0.02
      }
    })
    plastic.push(pose(tint(body, hex)))
    // write-protect window and shutter slot: dark, a hair proud
    plastic.push(
      pose(
        tint(softBox(0.0075, 0.0012, 0.0062, 0.0004, 0.05, 2), '#0b0b0d'),
        -0.037,
        0.0038,
        0.041,
      ),
    )
    plastic.push(
      pose(
        tint(softBox(0.0075, 0.0016, 0.019, 0.0004, 0.05, 2), '#0b0b0d'),
        0.017,
        0.0046,
        -0.028,
      ),
    )
    metal.push(
      pose(
        softBox(0.036, 0.0012, 0.034, 0.0005, 0.05, 2),
        0.007,
        0.0042,
        -0.0285,
      ),
    )
  })
  return { plastic: mergeParts(plastic, true), metal: mergeParts(metal) }
}

/** a drawer front: overlay board with a soft edge */
function buildFront(h: number): BufferGeometry {
  return tint(
    at(woodBox(0.408, h, 0.02, 0.0035, 3, 0.4, 'x'), 0, 0, FRONT + 0.01),
    '#dfd0bb',
  )
}

/** bridge pull, lock and label holder for a front of height `h` */
function buildHardware(h: number, big: boolean): BufferGeometry {
  const parts: BufferGeometry[] = []
  const hw = big ? 0.062 : 0.05
  const hy = big ? h / 2 - 0.05 : -0.006
  const zf = FACE_Z
  const pull = new CatmullRomCurve3(
    [
      new Vector3(-hw, 0, 0),
      new Vector3(-hw, 0, 0.013),
      new Vector3(-hw + 0.008, 0, 0.0215),
      new Vector3(-hw + 0.02, 0, 0.0235),
      new Vector3(hw - 0.02, 0, 0.0235),
      new Vector3(hw - 0.008, 0, 0.0215),
      new Vector3(hw, 0, 0.013),
      new Vector3(hw, 0, 0),
    ],
    false,
    'centripetal',
  ).getPoints(28)
  parts.push(
    tint(
      at(
        sweep({
          path: pull,
          radial: 8,
          size: () => [0.0052, 0.0052],
          vTile: 0.05,
          capStart: true,
          capEnd: true,
        }),
        0,
        hy,
        zf,
      ),
      '#b9bec6',
    ),
  )
  for (const sx of [-1, 1]) {
    parts.push(
      tint(
        at(
          lathe(
            [
              [0, 0.0],
              [0.0095, 0.0],
              [0.0095, 0.0016],
              [0.0075, 0.0026],
              [0, 0.0026],
            ],
            { segments: 10 },
          ).rotateX(Math.PI / 2),
          sx * hw,
          hy,
          zf,
        ),
        '#b9bec6',
      ),
    )
  }
  // label-card holder: a brass frame just above the pull
  const ly = hy + (big ? 0.036 : 0.043)
  parts.push(
    tint(
      at(
        woodBox(0.076, 0.03, 0.0026, 0.0012, 1, 0.05, 'x'),
        0,
        ly,
        zf + 0.0013,
      ),
      '#c9a45a',
    ),
  )
  // lock: brass cylinder with a keyhole slot, upper right
  const lx = 0.15
  const ky = big ? h / 2 - 0.05 : 0.038
  parts.push(
    tint(
      at(
        lathe(
          [
            [0, 0.0],
            [0.0095, 0.0],
            [0.0095, 0.004],
            [0.0078, 0.0058],
            [0, 0.0058],
          ],
          { segments: 12 },
        ).rotateX(Math.PI / 2),
        lx,
        ky,
        zf,
      ),
      '#c9a45a',
    ),
  )
  parts.push(
    tint(
      at(
        woodBox(0.0016, 0.0062, 0.0012, 0.0005, 1, 0.05, 'x'),
        lx,
        ky,
        zf + 0.006,
      ),
      '#050505',
    ),
  )
  return mergeParts(parts, true)
}

export default function Drawers() {
  const view = useSystem((s) => s.view)
  const [open, setOpen] = useState<[boolean, boolean]>([false, false])
  const [note, setNote] = useState(false)
  /* every secret in the ledger found → the note relents */
  const complete = useWorld((s) => LEDGER.every((e) => s.found.includes(e.id)))

  const trays = useRef<(Group | null)[]>([null, null])
  /* the tray box and everything in it: skipped by the renderer while the
     drawer is shut (nobody can see inside a closed pedestal) */
  const insides = useRef<(Group | null)[]>([null, null])
  const noteRig = useRef<Group>(null!)
  const noteProg = useRef(0)

  const starGeo = useMemo(() => starGeometry(), [])

  /* the carcass, fronts, trays and hardware: built once, merged by material */
  const gl = useThree((st) => st.gl)
  const wood = useWood(
    gl.capabilities.getMaxAnisotropy(),
    P.deskWood,
    '#3d2a18',
  )
  const parts = useMemo(() => {
    const floppies = buildFloppies()
    return {
      carcass: buildCarcass(),
      tray: buildTray(),
      front: buildFront(FRONT_H),
      fileFront: buildFront(FILE.h),
      hardware: buildHardware(FRONT_H, false),
      fileHardware: buildHardware(FILE.h, true),
      floppyPlastic: floppies.plastic,
      floppyMetal: floppies.metal,
    }
  }, [])
  const brushed = useMemo(() => brushedMetalMaps(8, 256, 3), [])
  const holderTexes = useMemo(
    () =>
      ['PROJECTS', 'MISC.', 'FILES'].map((t) =>
        makeLabel(t, '#2a2620', '#e6e1d2', 3, 2),
      ),
    [],
  )
  useEffect(
    () => () => {
      Object.values(parts).forEach((g) => g.dispose())
      brushed.dispose()
      holderTexes.forEach((t) => t.dispose())
    },
    [parts, brushed, holderTexes],
  )
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
      const inner = insides.current[i]
      if (inner) inner.visible = open[i] || tray.position.z > 0.004
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
      {/* carcass: side boards, dark reveal plate, recessed toe-kick */}
      <mesh geometry={parts.carcass} castShadow receiveShadow>
        <meshStandardMaterial
          vertexColors
          map={wood.map}
          bumpMap={wood.bumpMap}
          bumpScale={0.002}
          roughnessMap={wood.roughnessMap}
          roughness={0.85}
        />
      </mesh>

      {/* the file drawer that never opens: locked, like the rest of his secrets */}
      <group position={[0, FILE.y, -0.01]}>
        <mesh geometry={parts.fileFront} castShadow receiveShadow>
          <meshStandardMaterial
            vertexColors
            map={wood.map}
            bumpMap={wood.bumpMap}
            bumpScale={0.002}
            roughnessMap={wood.roughnessMap}
            roughness={0.72}
          />
        </mesh>
        {/* the card in its holder */}
        <mesh position={[0, FILE.h / 2 - 0.05 + 0.036 + 0.0, FACE_Z + 0.0029]}>
          <planeGeometry args={labelSize(holderTexes[2], 0.06)} />
          <meshBasicMaterial map={holderTexes[2]} color="#c7c3b6" />
        </mesh>
        <mesh geometry={parts.fileHardware} castShadow>
          <meshStandardMaterial
            vertexColors
            metalness={1}
            roughness={0.42}
            roughnessMap={brushed.roughnessMap}
            normalMap={brushed.normalMap}
            normalScale={[0.25, 0.25]}
          />
        </mesh>
      </group>

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
                {/* drawer front: overlay board, 5 mm reveals */}
                <mesh geometry={parts.front} castShadow receiveShadow>
                  <meshStandardMaterial
                    vertexColors
                    map={wood.map}
                    bumpMap={wood.bumpMap}
                    bumpScale={0.002}
                    roughnessMap={wood.roughnessMap}
                    roughness={0.72}
                  />
                </mesh>
                {/* bridge pull, brass label holder and cylinder lock */}
                <mesh geometry={parts.hardware} castShadow>
                  <meshStandardMaterial
                    vertexColors
                    metalness={1}
                    roughness={0.42}
                    roughnessMap={brushed.roughnessMap}
                    normalMap={brushed.normalMap}
                    normalScale={[0.25, 0.25]}
                  />
                </mesh>
                {/* the card in the holder */}
                <mesh position={[0, 0.037, FACE_Z + 0.0029]}>
                  <planeGeometry args={labelSize(holderTexes[i], 0.06)} />
                  <meshBasicMaterial map={holderTexes[i]} color="#c7c3b6" />
                </mesh>
              </Clickable>

              <group
                ref={(el) => {
                  insides.current[i] = el
                }}
                visible={false}
              >
                {/* tray box: floor, sides and back in one mesh */}
                <mesh geometry={parts.tray} receiveShadow>
                  <meshStandardMaterial
                    vertexColors
                    map={wood.map}
                    bumpMap={wood.bumpMap}
                    bumpScale={0.002}
                    roughnessMap={wood.roughnessMap}
                    roughness={0.9}
                  />
                </mesh>

                {/* ============ contents ============ */}
                {i === 0 ? (
                  <group position={[0, -0.025, FRONT - 0.12]}>
                    {/* three floppies: shells, shutters and slots baked */}
                    <mesh geometry={parts.floppyPlastic} castShadow>
                      <meshStandardMaterial vertexColors roughness={0.55} />
                    </mesh>
                    <mesh geometry={parts.floppyMetal}>
                      <meshStandardMaterial
                        color="#b9bdc9"
                        metalness={0.85}
                        roughness={0.34}
                      />
                    </mesh>
                    {FLOPPY_LABELS.map((label, k) => {
                      const [lw, lh] = labelSize(floppyTexes[k], 0.055)
                      return (
                        <group
                          key={label}
                          position={[-0.105 + k * 0.105, 0.004, 0.01]}
                          rotation-y={(k - 1) * 0.16}
                        >
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
                      <group
                        position={[0.08, 0.004, -0.082]}
                        rotation-y={-0.12}
                      >
                        <group position={[0, 0.035, 0]} rotation-x={1.22}>
                          <mesh castShadow>
                            <roundedBoxGeometry args={rb(0.105, 0.004, 0.07)} />
                            <meshStandardMaterial
                              color="#efe8d8"
                              roughness={0.9}
                            />
                          </mesh>
                          {/* flap seams */}
                          <mesh position={[-0.026, 0.0022, 0]} rotation-y={0.6}>
                            <roundedBoxGeometry
                              args={rb(0.062, 0.0008, 0.0016)}
                            />
                            <meshStandardMaterial
                              color="#c9c0ab"
                              roughness={0.9}
                            />
                          </mesh>
                          <mesh position={[0.026, 0.0022, 0]} rotation-y={-0.6}>
                            <roundedBoxGeometry
                              args={rb(0.062, 0.0008, 0.0016)}
                            />
                            <meshStandardMaterial
                              color="#c9c0ab"
                              roughness={0.9}
                            />
                          </mesh>
                          {/* wax seal */}
                          <mesh position={[0, 0.0028, 0]}>
                            <cylinderGeometry
                              args={[0.008, 0.008, 0.002, 10]}
                            />
                            <meshStandardMaterial
                              color="#8c2f26"
                              roughness={0.5}
                            />
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
                        <group
                          ref={noteRig}
                          position={[0, 0.02, 0]}
                          visible={false}
                        >
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
          </group>
        )
      })}
    </group>
  )
}
