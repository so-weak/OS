import { useEffect, useMemo } from 'react'
import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { DESK_TOP } from './layout'
import { makeCanvas, mulberry } from './textures'
import {
  decalTex,
  drawSpaced,
  lathe,
  makeDecal,
  mergeParts,
  part,
  sharedPlastic,
} from './tex/electronics'
import Staged from './Staged'

/* =====================================================================
   The lived-in layer on the desk: a pen cup with a ruler leaning in it, a
   stack of jewel-cased CDs with a loose disc on top, a box of floppies, and
   a yellow sticky pad with a pen beside it. Small, period-correct and
   parked at the far right end of the desk, out of the lamp's pool and clear
   of the screen: the desk stays the hero. Mounted once from Scene.tsx, in
   world coordinates. Nothing here is a resume fact — just stuff.
   ===================================================================== */

type Part = Parameters<typeof part>[1]

/** a ballpoint / marker: body, cap, clip, tip. Axis +y from 0 to `len`. */
function pen(len: number, r: number, body: string, cap: string, opts: { pencil?: boolean } = {}): BufferGeometry {
  const parts: BufferGeometry[] = []
  const add = (g: BufferGeometry, o: Part) => parts.push(part(g, { tile: 0, ...o }))
  if (opts.pencil) {
    const hex = new CylinderGeometry(r * 1.05, r * 1.05, len - 0.02, 6)
    add(hex, { pos: [0, 0.01 + (len - 0.02) / 2, 0], color: body, crease: 0.4 })
    add(lathe([[0.0001, 0], [r * 0.95, 0.011], [r * 0.95, 0.012], [0.0001, 0.012]], 8), { pos: [0, 0, 0], color: '#d9b48a' })
    add(lathe([[0.0001, 0], [0.0006, 0.0], [0.0007, 0.0025], [0.0001, 0.0028]], 6), { pos: [0, 0, 0], color: '#2a2a2a' })
    add(new CylinderGeometry(r * 1.08, r * 1.08, 0.008, 10), { pos: [0, len - 0.004, 0], color: '#d98a8a' })
    add(new CylinderGeometry(r * 1.1, r * 1.1, 0.006, 10), { pos: [0, len - 0.011, 0], color: '#b9bcc2' })
    return mergeParts(parts)
  }
  add(lathe([[0.0001, 0], [0.0007, 0], [r * 0.6, 0.006], [r * 0.9, 0.014], [r * 0.9, len * 0.62], [r * 0.9, len * 0.62 + 0.0005], [0.0001, len * 0.62 + 0.0005]], 12), { color: body })
  add(new CylinderGeometry(r * 1.06, r * 1.06, len * 0.38, 12), { pos: [0, len * 0.62 + len * 0.19, 0], color: cap })
  add(new CylinderGeometry(r * 1.07, r * 1.07, 0.0025, 12), { pos: [0, len * 0.62, 0], color: '#a9adb4' })
  add(new BoxGeometry(0.0016, len * 0.2, 0.0022), { pos: [r * 1.07, len * 0.84, 0], color: '#a9adb4', crease: 0.5 })
  return mergeParts(parts)
}

/** aim a geometry along `dir` (from +y) and plant its foot at `at` */
function lean(g: BufferGeometry, dir: Vector3, at: Vector3): BufferGeometry {
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize()))
  g.translate(at.x, at.y, at.z)
  return g
}

function buildCup() {
  const cup = part(
    lathe(
      [
        [0.0001, 0],
        [0.03, 0],
        [0.0325, 0.0018],
        [0.0342, 0.006],
        [0.0362, 0.09],
        [0.0372, 0.0935],
        [0.0355, 0.0955],
        [0.0343, 0.0925],
        [0.0333, 0.008],
        [0.0001, 0.007],
      ],
      36,
    ),
    { color: '#2f4d6e', tile: 0, crease: 1.0 },
  )
  const rand = mulberry(11)
  const pens: BufferGeometry[] = []
  const spec: [number, number, string, string, boolean][] = [
    [0.145, 0.0046, '#1c3f9a', '#1c3f9a', false],
    [0.15, 0.0046, '#a3231d', '#a3231d', false],
    [0.14, 0.0043, '#1a1a1c', '#2d2d30', false],
    [0.16, 0.0038, '#e5b422', '#e5b422', true],
    [0.135, 0.0046, '#2b7a4b', '#2b7a4b', false],
  ]
  spec.forEach(([len, r, body, capC, pencil], i) => {
    const phi = (i / spec.length) * Math.PI * 2 + rand() * 0.6
    const th = 0.1 + rand() * 0.16
    const dir = new Vector3(Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th))
    pens.push(
      lean(pen(len, r, body, capC, { pencil }), dir, new Vector3(-Math.cos(phi) * 0.008, 0.011, -Math.sin(phi) * 0.008)),
    )
  })
  // the ruler leans against the rim, its foot inside the cup, its face toward the room
  const ruler = new BoxGeometry(0.0286, 0.19, 0.0018)
  ruler.translate(0, 0.095, 0)
  lean(ruler, new Vector3(0.05, 1, -0.2), new Vector3(0.002, 0.012, 0.014))
  return { cup, pens: mergeParts(pens), ruler }
}

/** the clear-plastic ruler's printed ticks */
function rulerTex() {
  const W = 96
  const H = 768
  const ctx = makeCanvas(W, H)
  ctx.fillStyle = '#d9d4a5'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(0, 0, 10, H)
  ctx.fillStyle = '#2a2822'
  const pxPerMm = (H - 24) / 190
  for (let mm = 0; mm <= 180; mm++) {
    const y = H - 12 - mm * pxPerMm
    const len = mm % 10 === 0 ? 34 : mm % 5 === 0 ? 24 : 14
    ctx.fillRect(W - len - 8, y, len, mm % 10 === 0 ? 2.4 : 1.6)
    if (mm % 10 === 0 && mm > 0 && mm < 180) {
      ctx.save()
      ctx.translate(20, y + 6)
      ctx.font = "700 20px 'Helvetica Neue', Arial, sans-serif"
      ctx.textBaseline = 'middle'
      ctx.fillText(String(mm / 10), 0, 0)
      ctx.restore()
    }
  }
  return decalTex(ctx, 8)
}

/** a hand-lettered insert seen through a jewel case's lid */
function insertTex(title: string, sub: string, hue: string, hue2: string) {
  const W = 512
  const ctx = makeCanvas(W, W)
  const g = ctx.createLinearGradient(0, 0, W, W)
  g.addColorStop(0, hue)
  g.addColorStop(1, hue2)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, W)
  const rand = mulberry(title.length * 17 + 3)
  ctx.globalAlpha = 0.28
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = rand() < 0.5 ? '#ffffff' : '#000000'
    const s = 20 + rand() * 90
    ctx.fillRect(rand() * W, rand() * W, s, s * (0.2 + rand() * 0.5))
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.fillRect(28, 300, W - 56, 150)
  ctx.fillStyle = '#1b1b22'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = "700 74px 'Marker Felt', 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive"
  ctx.fillText(title, W / 2, 352)
  ctx.font = "600 40px 'Marker Felt', 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive"
  ctx.fillText(sub, W / 2, 412)
  // clear-plastic sheen
  const sh = ctx.createLinearGradient(0, 0, W, W * 0.6)
  sh.addColorStop(0, 'rgba(255,255,255,0.16)')
  sh.addColorStop(0.5, 'rgba(255,255,255,0)')
  ctx.fillStyle = sh
  ctx.fillRect(0, 0, W, W)
  return decalTex(ctx, 8)
}

/** a burned disc, marker on the label side up, rainbow tracks catching light */
function discTex() {
  const S = 512
  const ctx = makeCanvas(S, S)
  ctx.clearRect(0, 0, S, S)
  const cg = ctx.createConicGradient(0.4, S / 2, S / 2)
  const stops = ['#c9ccd2', '#e8e4ea', '#b6bdc9', '#d5cdd9', '#aeb6c4', '#e5e9ee', '#c2c6d0', '#c9ccd2']
  stops.forEach((c, i) => cg.addColorStop(i / (stops.length - 1), c))
  ctx.fillStyle = cg
  ctx.beginPath()
  ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2)
  ctx.fill()
  // printable ring, hub ring, marker scrawl
  ctx.fillStyle = 'rgba(245,245,240,0.55)'
  ctx.beginPath()
  ctx.arc(S / 2, S / 2, S * 0.4, 0, Math.PI * 2)
  ctx.arc(S / 2, S / 2, S * 0.14, 0, Math.PI * 2, true)
  ctx.fill()
  ctx.strokeStyle = 'rgba(40,40,50,0.5)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(S / 2, S / 2, S * 0.16, 0, Math.PI * 2)
  ctx.stroke()
  ctx.save()
  ctx.translate(S / 2, S / 2)
  ctx.rotate(-0.25)
  ctx.fillStyle = '#1c2f7c'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = "700 64px 'Marker Felt', 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive"
  ctx.fillText('MIX 3', 0, -112)
  ctx.font = "600 36px 'Marker Felt', 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive"
  ctx.fillText('do not scratch', 0, 112)
  ctx.restore()
  return decalTex(ctx, 8)
}

function padNoteTex() {
  const W = 256
  const ctx = makeCanvas(W, W)
  ctx.fillStyle = '#ecd35c'
  ctx.fillRect(0, 0, W, W)
  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  ctx.fillRect(0, 0, W, 22)
  ctx.fillStyle = '#233a86'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = "600 30px 'Marker Felt', 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive"
  ;['[ ] back up disks', '[x] water plant', '[ ] buy milk'].forEach((t, i) => ctx.fillText(t, 20, 70 + i * 46))
  ctx.strokeStyle = 'rgba(35,58,134,0.55)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(24, 228)
  ctx.bezierCurveTo(60, 212, 100, 242, 150, 224)
  ctx.stroke()
  return decalTex(ctx, 8)
}

function floppyBoxLabel() {
  return makeDecal(256, 96, (ctx, w, h) => {
    ctx.fillStyle = '#e6e2d3'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#b3352d'
    ctx.fillRect(0, 0, w, 14)
    drawSpaced(ctx, 'DISKETTES  3.5"', w / 2, 52, "700 30px 'Helvetica Neue', Arial, sans-serif", '#2a2925', 3, 'center')
    drawSpaced(ctx, 'HD 1.44MB  x10', w / 2, 80, "600 18px 'Helvetica Neue', Arial, sans-serif", '#5b5a52', 2, 'center')
  })
}

/** three jewel cases squared up roughly, and the loose-disc puck on top */
function buildCases() {
  const rand = mulberry(5)
  const parts: BufferGeometry[] = []
  const T = 0.0102
  for (let i = 0; i < 3; i++) {
    const g = new RoundedBoxGeometry(0.142, T, 0.125, 2, 0.0012)
    parts.push(
      part(g, {
        pos: [(rand() - 0.5) * 0.008, T / 2 + i * (T + 0.0004), (rand() - 0.5) * 0.008],
        rot: [0, (rand() - 0.5) * 0.09, 0],
        color: i === 1 ? '#c7cbd0' : '#d3d7db',
        tile: 0,
        crease: 1.0,
      }),
    )
    // hinge spine ridge
    parts.push(
      part(new BoxGeometry(0.0022, T * 0.7, 0.122), {
        pos: [-0.0715, T / 2 + i * (T + 0.0004), 0],
        color: '#a9adb2',
        tile: 0,
        crease: 0.5,
      }),
    )
  }
  return mergeParts(parts)
}

function buildFloppyBox() {
  const parts: BufferGeometry[] = []
  const add = (g: BufferGeometry, o: Part) => parts.push(part(g, { tile: 0, ...o }))
  add(new RoundedBoxGeometry(0.106, 0.034, 0.099, 3, 0.003), { pos: [0, 0.017, 0], color: '#34383d', crease: 1.1 })
  add(new RoundedBoxGeometry(0.106, 0.014, 0.099, 3, 0.003), { pos: [0, 0.041, 0], color: '#3b4046', crease: 1.1 })
  // hinge and latch
  add(new BoxGeometry(0.03, 0.006, 0.004), { pos: [0, 0.036, -0.0475], color: '#22252a', crease: 0.5 })
  add(new BoxGeometry(0.014, 0.012, 0.004), { pos: [0, 0.036, 0.0505], color: '#22252a', crease: 0.5 })
  // two loose diskettes on the lid and beside the box
  const disk = (x: number, y: number, z: number, rot: number, body: string) => {
    add(new RoundedBoxGeometry(0.09, 0.0033, 0.094, 2, 0.0012), { pos: [x, y, z], rot: [0, rot, 0], color: body, crease: 1.0 })
    add(new BoxGeometry(0.034, 0.0012, 0.03), { pos: [x, y + 0.0011, z], rot: [0, rot, 0], color: '#c3c6ce', crease: 0.5 })
    add(new BoxGeometry(0.06, 0.0009, 0.034), { pos: [x, y + 0.0021, z + 0.0], rot: [0, rot, 0], color: '#ebe8dc', crease: 0.5 })
  }
  disk(0.006, 0.0507, 0.004, 0.22, '#2b3a8c')
  return mergeParts(parts)
}

function buildPad() {
  const parts: BufferGeometry[] = []
  const add = (g: BufferGeometry, o: Part) => parts.push(part(g, { tile: 0, ...o }))
  add(new BoxGeometry(0.076, 0.009, 0.076), { pos: [0, 0.0045, 0], color: '#efe9d3', crease: 0.5 })
  ;[0.0075, 0.0082, 0.0089].forEach((y, i) =>
    add(new BoxGeometry(0.0762, 0.0004, 0.0762), { pos: [0, y, 0], color: i % 2 ? '#f0d75f' : '#ecd05a', crease: 0.5 }),
  )
  return mergeParts(parts)
}

function DeskClutterBody() {
  const cup = useMemo(() => buildCup(), [])
  const cases = useMemo(() => buildCases(), [])
  const box = useMemo(() => buildFloppyBox(), [])
  const pad = useMemo(() => buildPad(), [])
  const notePen = useMemo(
    () => lean(pen(0.14, 0.0046, '#a3231d', '#a3231d'), new Vector3(1, 0, 0), new Vector3(-0.07, 0.0046, 0)),
    [],
  )
  const plastic = useMemo(() => sharedPlastic(), [])
  const ruler = useMemo(() => rulerTex(), [])
  const coverA = useMemo(() => insertTex('BACKUPS', 'disc 2 of 3', '#2c5fa8', '#7a2a86'), [])
  const disc = useMemo(() => discTex(), [])
  const note = useMemo(() => padNoteTex(), [])
  const boxLabel = useMemo(() => floppyBoxLabel(), [])
  useEffect(
    () => () => {
      cup.cup.dispose()
      cup.pens.dispose()
      cup.ruler.dispose()
      cases.dispose()
      box.dispose()
      pad.dispose()
      notePen.dispose()
      plastic.dispose()
      ruler.dispose()
      coverA.dispose()
      disc.dispose()
      note.dispose()
      boxLabel.dispose()
    },
    [cup, cases, box, pad, notePen, plastic, ruler, coverA, disc, note, boxLabel],
  )

  const y = DESK_TOP
  return (
    <group>
      {/* pen cup, back right corner */}
      <group position={[0.83, y, -0.865]} rotation-y={0.4}>
        <mesh geometry={cup.cup} castShadow>
          <meshStandardMaterial vertexColors roughness={0.28} />
        </mesh>
        <mesh geometry={cup.pens} castShadow>
          <meshStandardMaterial vertexColors roughness={0.4} />
        </mesh>
        {/* the ruler leaning against the rim */}
        <mesh geometry={cup.ruler} castShadow>
          <meshStandardMaterial map={ruler} roughness={0.35} />
        </mesh>
      </group>

      {/* jewel cases and a loose disc, right of the mouse pad */}
      <group position={[0.8, y, -0.5]} rotation-y={0.32}>
        <mesh geometry={cases} castShadow receiveShadow>
          <meshStandardMaterial
            vertexColors
            roughness={0.18}
            normalMap={plastic.normalMap}
            normalScale={[0.5, 0.5]}
          />
        </mesh>
        {/* the insert seen through the top lid */}
        <mesh position={[0.003, 3 * 0.0106 + 0.0003, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.1195, 0.118]} />
          <meshStandardMaterial map={coverA} roughness={0.22} />
        </mesh>
        {/* a burned disc left on top, off-centre */}
        <mesh position={[0.02, 3 * 0.0106 + 0.0016, 0.012]} rotation={[-Math.PI / 2, 0, 0.5]}>
          <ringGeometry args={[0.0075, 0.06, 56]} />
          <meshStandardMaterial map={disc} metalness={0.55} roughness={0.28} side={DoubleSide} />
        </mesh>
      </group>

      {/* box of diskettes, front of the pen cup */}
      <group position={[0.795, y, -0.66]} rotation-y={-0.28}>
        <mesh geometry={box} castShadow receiveShadow>
          <meshStandardMaterial
            vertexColors
            roughness={0.42}
            normalMap={plastic.normalMap}
            normalScale={[0.5, 0.5]}
          />
        </mesh>
        <mesh position={[0, 0.019, 0.0498]}>
          <planeGeometry args={[0.078, 0.022]} />
          <meshStandardMaterial map={boxLabel} roughness={0.6} />
        </mesh>
      </group>

      {/* sticky pad and the pen that wrote on it, between mouse pad and mug */}
      <group position={[0.545, y, -0.665]} rotation-y={0.35}>
        <mesh geometry={pad} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.0092, 0]} rotation-x={-Math.PI / 2} rotation-z={0.02}>
          <planeGeometry args={[0.0758, 0.0758]} />
          <meshStandardMaterial map={note} roughness={0.9} />
        </mesh>
        <mesh geometry={notePen} position={[0.02, 0.0004, 0.052]} rotation-y={0.3} castShadow>
          <meshStandardMaterial vertexColors roughness={0.4} />
        </mesh>
      </group>
    </group>
  )
}

/* first load: mounted in its own turn of the staged build (stage.ts) */
export default function DeskClutter() {
  return (
    <Staged id="clutter">
      <DeskClutterBody />
    </Staged>
  )
}
