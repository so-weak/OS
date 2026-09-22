import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RGBADepthPacking,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { useSystem } from '../os/store'
import { playBeep, playClick } from '../os/sound'
import { useWorld } from '../world'
import Halo from './Halo'
import { useLibrary } from './libraryState'
import { usePins } from './pinState'
import { useRoom } from './roomState'
import { DESK_TOP, P } from './layout'
import { rb } from './rbox'
import { makeCanvas } from './textures'
import {
  capFan,
  clamp01,
  decalTex,
  drawSpaced,
  keycapSet,
  lathe,
  loftRings,
  makeDecal,
  mergeParts,
  noise3,
  part,
  sharedPlastic,
  roundedSlab,
  rrectPts,
  screwHead,
  smooth,
  tintGeo,
  type RingSpec,
  type V3,
} from './tex/electronics'

/* =====================================================================
   A beige full-size keyboard, 101 keys at real 19 mm pitch. Every keycap
   is one instance of a tapered, dished, rounded cap (one draw call); a
   second InstancedMesh of tiny decal quads carries the printed legends
   from a 1024 px atlas and follows the very same per-key transforms, so a
   pressed key takes its letter down with it. Wide keys (Backspace, Enter,
   the spacebar, the numpad plus) stretch through a vertex-shader 9-slice,
   so their corners stay exactly as round as a 1u cap's.

   It is ALIVE: while you are in room view, real keystrokes depress the
   matching 3D keycap with a clack. Typing "hire" makes the sticky note
   on the monitor glow and pops a hint toast. (Easter egg mandate.)
   ===================================================================== */

const U = 0.0186 // key pitch (19 mm ≈ real, a hair under)
const CAP = 0.0174 // 1u cap footprint at the base
const CAP_H = 0.0086 // cap height
const TRAVEL = 0.0034 // key press depth
const W = 0.445 // case width
const D = 0.163 // case depth
const H = 0.024 // rim height above the desk plane of the flat case
const DECK_TOP = 0.017 // the dark plate the switches mount to
const CAP_Y0 = DECK_TOP + 0.0022 + CAP_H / 2 // resting height of a cap centre
const TILT = 0.075 // rear feet lift the back by ~1.2 cm
const X0 = -W / 2 + 0.0087 // left edge of column 0
const Z_TOP = -D / 2 + 0.02 // back edge of row 0
const KBD_POS = new Vector3(0.12, DESK_TOP + 0.0008, -0.44)
const KBD_YAW = 0.05
const LEGEND_Q = 0.56 // legend quad size in 1u caps

interface KeySpec {
  x: number
  z: number
  /** stretch of the cap in 1u caps (x, z) */
  stx: number
  stz: number
  mod: boolean
  /** KeyboardEvent.code that presses this cap */
  code: string
  main: string
  sub?: string
  /** legend quad size in 1u caps */
  qw: number
  qh: number
}

/* ---------------------------------------------------------------------
   The layout: ANSI full-size, columns in key units
   --------------------------------------------------------------------- */
function planKeys(): KeySpec[] {
  const out: KeySpec[] = []
  const add = (
    row: number,
    col: number,
    code: string,
    main: string,
    o: { w?: number; h?: number; sub?: string; mod?: boolean } = {},
  ) => {
    const w = o.w ?? 1
    const h = o.h ?? 1
    const stx = 1 + ((w - 1) * U) / CAP
    const stz = 1 + ((h - 1) * U) / CAP
    out.push({
      x: X0 + (col + w / 2) * U,
      z: Z_TOP + ((row > 0 ? row + 0.5 : row) + h / 2) * U,
      stx,
      stz,
      mod: o.mod ?? false,
      code,
      main,
      sub: o.sub,
      qw: LEGEND_Q + (stx - 1),
      qh: LEGEND_Q + (stz - 1),
    })
  }
  const m = { mod: true }

  // row 0: Esc, F1-F12 in fours, print block
  add(0, 0, 'Escape', 'Esc', m)
  ;[2, 3, 4, 5, 6.5, 7.5, 8.5, 9.5, 11, 12, 13, 14].forEach((c, i) =>
    add(0, c, `F${i + 1}`, `F${i + 1}`, m),
  )
  add(0, 15.5, 'PrintScreen', 'PrtSc', m)
  add(0, 16.5, 'ScrollLock', 'ScrLk', m)
  add(0, 17.5, 'Pause', 'Pause', m)

  // row 1: numbers
  const num: [string, string, string][] = [
    ['Backquote', '`', '~'],
    ['Digit1', '1', '!'],
    ['Digit2', '2', '@'],
    ['Digit3', '3', '#'],
    ['Digit4', '4', '$'],
    ['Digit5', '5', '%'],
    ['Digit6', '6', '^'],
    ['Digit7', '7', '&'],
    ['Digit8', '8', '*'],
    ['Digit9', '9', '('],
    ['Digit0', '0', ')'],
    ['Minus', '-', '_'],
    ['Equal', '=', '+'],
  ]
  num.forEach(([code, main, sub], i) => add(1, i, code, main, { sub }))
  add(1, 13, 'Backspace', 'Backspace', { w: 2, mod: true })
  add(1, 15.5, 'Insert', 'Ins', m)
  add(1, 16.5, 'Home', 'Home', m)
  add(1, 17.5, 'PageUp', 'PgUp', m)
  add(1, 19, 'NumLock', 'Num', m)
  add(1, 20, 'NumpadDivide', '/', m)
  add(1, 21, 'NumpadMultiply', '*', m)
  add(1, 22, 'NumpadSubtract', '-', m)

  // row 2: QWERTY
  add(2, 0, 'Tab', 'Tab', { w: 1.5, mod: true })
  'QWERTYUIOP'.split('').forEach((ch, i) => add(2, 1.5 + i, `Key${ch}`, ch))
  add(2, 11.5, 'BracketLeft', '[', { sub: '{' })
  add(2, 12.5, 'BracketRight', ']', { sub: '}' })
  add(2, 13.5, 'Backslash', '\\', { w: 1.5, sub: '|' })
  add(2, 15.5, 'Delete', 'Del', m)
  add(2, 16.5, 'End', 'End', m)
  add(2, 17.5, 'PageDown', 'PgDn', m)
  add(2, 19, 'Numpad7', '7', { sub: 'Home' })
  add(2, 20, 'Numpad8', '8', { sub: '↑' })
  add(2, 21, 'Numpad9', '9', { sub: 'PgUp' })
  add(2, 22, 'NumpadAdd', '+', { h: 2, mod: true })

  // row 3: home row
  add(3, 0, 'CapsLock', 'Caps Lock', { w: 1.75, mod: true })
  'ASDFGHJKL'.split('').forEach((ch, i) => add(3, 1.75 + i, `Key${ch}`, ch))
  add(3, 10.75, 'Semicolon', ';', { sub: ':' })
  add(3, 11.75, 'Quote', "'", { sub: '"' })
  add(3, 12.75, 'Enter', 'Enter', { w: 2.25, mod: true })
  add(3, 19, 'Numpad4', '4', { sub: '←' })
  add(3, 20, 'Numpad5', '5')
  add(3, 21, 'Numpad6', '6', { sub: '→' })

  // row 4: shift row
  add(4, 0, 'ShiftLeft', 'Shift', { w: 2.25, mod: true })
  'ZXCVBNM'.split('').forEach((ch, i) => add(4, 2.25 + i, `Key${ch}`, ch))
  add(4, 9.25, 'Comma', ',', { sub: '<' })
  add(4, 10.25, 'Period', '.', { sub: '>' })
  add(4, 11.25, 'Slash', '/', { sub: '?' })
  add(4, 12.25, 'ShiftRight', 'Shift', { w: 2.75, mod: true })
  add(4, 16.5, 'ArrowUp', '↑', m)
  add(4, 19, 'Numpad1', '1', { sub: 'End' })
  add(4, 20, 'Numpad2', '2', { sub: '↓' })
  add(4, 21, 'Numpad3', '3', { sub: 'PgDn' })
  add(4, 22, 'NumpadEnter', 'Enter', { h: 2, mod: true })

  // row 5: the bottom row and the spacebar
  add(5, 0, 'ControlLeft', 'Ctrl', { w: 1.5, mod: true })
  add(5, 1.5, 'AltLeft', 'Alt', { w: 1.5, mod: true })
  add(5, 3, 'Space', '', { w: 9 })
  add(5, 12, 'AltRight', 'Alt', { w: 1.5, mod: true })
  add(5, 13.5, 'ControlRight', 'Ctrl', { w: 1.5, mod: true })
  add(5, 15.5, 'ArrowLeft', '←', m)
  add(5, 16.5, 'ArrowDown', '↓', m)
  add(5, 17.5, 'ArrowRight', '→', m)
  add(5, 19, 'Numpad0', '0', { w: 2, sub: 'Ins' })
  add(5, 21, 'NumpadDecimal', '.', { sub: 'Del' })
  return out
}

/* deterministic tiny wobble so StrictMode renders identically */
function wonk(i: number, salt: number): number {
  return (Math.sin(i * 127.1 + salt * 311.7) % 1) * 0.5
}

const _dummy = new Object3D()

/** A cap's transform (press = 0..1 travel), and its legend's, which shares
    everything but the scale. */
function writeKey(
  spec: KeySpec,
  i: number,
  press: number,
  caps: InstancedMesh,
  legends: InstancedMesh,
): void {
  const y = CAP_Y0 - press * TRAVEL + wonk(i, 2) * 0.00018
  _dummy.position.set(spec.x + wonk(i, 1) * 0.0004, y, spec.z + wonk(i, 5) * 0.0003)
  _dummy.rotation.set(0, wonk(i, 3) * 0.022, 0)
  _dummy.scale.set(CAP, CAP_H, CAP)
  _dummy.updateMatrix()
  caps.setMatrixAt(i, _dummy.matrix)
  // the legend sits on the dish floor: 0.45 of the cap height above centre
  _dummy.position.y = y + CAP_H * 0.45 + 0.00007
  _dummy.scale.set(spec.qw * CAP, 1, spec.qh * CAP)
  _dummy.updateMatrix()
  legends.setMatrixAt(i, _dummy.matrix)
}

/* ---------------------------------------------------------------------
   The keycap: tapered walls, rolled shoulder, a dished top. One unit cap
   (x, z in -0.5..0.5) — wide keys stretch it in the vertex shader.
   --------------------------------------------------------------------- */
const CAP_RING: RingSpec = { arc: 2, nR: 1, nT: 1, nL: 1, nB: 1 }

function buildCap(): BufferGeometry {
  const ring = (half: number, r: number, y: number): V3[] =>
    rrectPts(half, half, r, CAP_RING).map(([x, z]) => [x, y, z])
  const R0 = ring(0.5, 0.085, -0.5)
  const S = ring(0.455, 0.11, 0.4)
  const E1 = ring(0.44, 0.125, 0.475)
  const E = ring(0.425, 0.14, 0.5)
  const D1 = ring(0.35, 0.16, 0.478)
  const D2 = ring(0.27, 0.15, 0.45)
  const walls = loftRings([R0, S, E1, E], 'outward')
  const top = loftRings([E, D1, D2], [0, 1, 0])
  const floor = capFan(D2, [0, 1, 0])
  const g = mergeParts([
    part(walls, { crease: 1.1, tile: 1 }),
    part(top, { crease: 1.1, tile: 1 }),
    part(floor, { crease: 1.1, tile: 1 }),
  ])
  // centre the UV on the cap so the "worn thumb" blob sits under the finger
  const uv = g.attributes.uv as BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + 0.5, uv.getY(i) + 0.5)
  uv.needsUpdate = true
  return g
}

/** Push the unit cap out by (stretch - 1) on each side of the centre: corners
    stay rigid, the middle stretches. Shared by the cap and its shadow. */
function stretchPatch(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 instanceSize;')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      transformed.x += sign(position.x) * (instanceSize.x - 1.0) * 0.5;
      transformed.z += sign(position.z) * (instanceSize.y - 1.0) * 0.5;`,
    )
    // the surface grain rides the same 9-slice, so a 9u spacebar keeps 1:1 texel scale
    .replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vec2 grainShift = vec2(sign(position.x) * (instanceSize.x - 1.0) * 0.5, sign(position.z) * (instanceSize.y - 1.0) * 0.5);
      #ifdef USE_NORMALMAP
      vNormalMapUv += grainShift;
      #endif
      #ifdef USE_ROUGHNESSMAP
      vRoughnessMapUv += grainShift;
      #endif`,
    )
}

/* ---------------------------------------------------------------------
   Legends: one atlas, one instanced decal quad per key
   --------------------------------------------------------------------- */
const ATLAS = 1024
const PX = 120 // atlas pixels per 1u cap
const PAD = 5
const INK = '#211d18'

interface AtlasCell {
  key: string
  x: number
  y: number
  w: number
  h: number
}

function legendKey(s: KeySpec): string {
  return `${s.main}|${s.sub ?? ''}|${s.qw.toFixed(2)}|${s.qh.toFixed(2)}`
}

function buildAtlas(specs: KeySpec[]): { tex: CanvasTexture; cells: Map<string, AtlasCell> } {
  const cells = new Map<string, AtlasCell>()
  const uniq = new Map<string, KeySpec>()
  for (const s of specs) if (s.main && !uniq.has(legendKey(s))) uniq.set(legendKey(s), s)
  // tall cells (numpad plus / enter) live in a strip down the right edge
  const tall: KeySpec[] = []
  const rest: KeySpec[] = []
  for (const s of uniq.values()) (s.qh > 1 ? tall : rest).push(s)
  let ty = 0
  const tallX = ATLAS - Math.round(LEGEND_Q * PX) - PAD * 2 - 4
  for (const s of tall) {
    const w = Math.round(s.qw * PX)
    const h = Math.round(s.qh * PX)
    cells.set(legendKey(s), { key: legendKey(s), x: tallX + PAD, y: ty + PAD, w, h })
    ty += h + PAD * 2
  }
  // shelves for everything else, widest-last so rows stay tidy
  let x = 0
  let y = 0
  let rowH = 0
  const rowLimit = tallX - 2
  for (const s of rest) {
    const w = Math.round(s.qw * PX)
    const h = Math.round(s.qh * PX)
    if (x + w + PAD * 2 > rowLimit) {
      x = 0
      y += rowH
      rowH = 0
    }
    cells.set(legendKey(s), { key: legendKey(s), x: x + PAD, y: y + PAD, w, h })
    x += w + PAD * 2
    rowH = Math.max(rowH, h + PAD * 2)
  }

  const ctx = makeCanvas(ATLAS, ATLAS)
  ctx.clearRect(0, 0, ATLAS, ATLAS)
  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const font = (px: number, weight = 600) =>
    `${weight} ${px}px "Helvetica Neue", Arial, "Segoe UI", sans-serif`
  for (const [k, spec] of uniq) {
    const c = cells.get(k)!
    const cx = c.x + c.w / 2
    const isWord = spec.main.length > 1 && !'↑↓←→'.includes(spec.main)
    const sub = spec.sub
    const subIsWord = !!sub && sub.length > 1 && !'↑↓←→'.includes(sub)
    // fit text into `maxW` by shrinking the font
    const fit = (text: string, px: number, maxW: number, weight = 600) => {
      let size = px
      ctx.font = font(size, weight)
      while (ctx.measureText(text).width > maxW && size > 8) {
        size -= 1
        ctx.font = font(size, weight)
      }
      return size
    }
    if (sub) {
      // numbers, punctuation, numpad: the shifted glyph rides above the main one
      const subPx = subIsWord ? PX * 0.2 : PX * 0.27
      fit(sub, subPx, c.w * 0.92)
      ctx.fillText(sub, cx, c.y + c.h * (subIsWord ? 0.26 : 0.27))
      fit(spec.main, PX * 0.36, c.w * 0.9)
      ctx.fillText(spec.main, cx, c.y + c.h * 0.7)
    } else if (isWord) {
      fit(spec.main, PX * 0.26, c.w * 0.9)
      ctx.fillText(spec.main, cx, c.y + c.h * 0.52)
    } else {
      fit(spec.main, PX * (spec.main.match(/[A-Z]/) ? 0.4 : 0.36), c.w * 0.9)
      ctx.fillText(spec.main, cx, c.y + c.h * 0.52)
    }
  }
  const tex = decalTex(ctx, 8)
  return { tex, cells }
}

/* ---------------------------------------------------------------------
   The case: rim, deck plate, feet, badge, LED window
   --------------------------------------------------------------------- */
const HOLE_W = 23 * U + 0.004
const HOLE_D = 6.5 * U + 0.004
const HOLE_Z0 = Z_TOP - 0.002 // back edge of the opening

function buildCase(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const add = (g: BufferGeometry, o: Parameters<typeof part>[1] = {}) =>
    parts.push(part(g, { color: '#ffffff', tile: 0.03, ...o }))
  const flat = -Math.PI / 2 // plan (x, y) -> world (x, -z), extrusion -> +y
  const holeCz = HOLE_Z0 + HOLE_D / 2

  // rim frame with the key opening
  add(
    roundedSlab(W, D, H, 0.013, 0.0035, 3, { w: HOLE_W, h: HOLE_D, corner: 0.005, y: -holeCz }),
    { pos: [0, H / 2, 0], rot: [flat, 0, 0] },
  )
  // dark deck plate the caps mount to
  add(roundedSlab(HOLE_W + 0.001, HOLE_D + 0.001, 0.004, 0.005, 0.0008, 2), {
    pos: [0, DECK_TOP - 0.002, holeCz],
    rot: [flat, 0, 0],
    color: '#2f2c27',
  })
  // rear tilt feet, each cut flat to the desk by the tilt angle
  for (const sx of [-0.175, 0.175]) {
    const zc = -D / 2 + 0.028
    const yb = -(D / 2 - zc) * Math.tan(TILT)
    const foot = new BoxGeometry(0.034, 0.0134 + Math.abs(yb), 0.011)
    add(foot, { pos: [sx, yb / 2 + 0.0002, zc], rot: [-TILT, 0, 0], color: '#3a3833', crease: 0.6 })
  }
  // the split line where the two case halves meet
  add(roundedSlab(W + 0.0006, D + 0.0006, 0.0009, 0.0133, 0.0002, 1, { w: W - 0.006, h: D - 0.006, corner: 0.011 }), {
    pos: [0, 0.0075, 0],
    rot: [flat, 0, 0],
    color: '#8e887a',
    tile: 0.03,
  })
  // badge plate and lock-light window on the rear rim
  add(roundedSlab(0.05, 0.0085, 0.0008, 0.002, 0.0003, 2), {
    pos: [-0.16, H + 0.0002, -D / 2 + 0.0095],
    rot: [flat, 0, 0],
    color: '#b8b5ac',
  })
  add(roundedSlab(0.062, 0.0095, 0.0009, 0.002, 0.0003, 2), {
    pos: [0.168, H + 0.0002, -D / 2 + 0.0095],
    rot: [flat, 0, 0],
    color: '#2b2a26',
  })
  // four screws along the front lip
  for (const sx of [-0.19, -0.06, 0.06, 0.19]) {
    add(screwHead(0.0025), {
      pos: [sx, H + 0.0004, D / 2 - 0.0095],
      rot: [-Math.PI / 2, 0, 0],
      tile: 0,
    })
  }
  const merged = mergeParts(parts)
  tintGeo(merged, (x, y, z, out) => {
    const n = noise3(x * 12, y * 12, z * 12, 9)
    const amt = clamp01(0.1 + 0.22 * smooth(0.015, 0.03, y) + (n - 0.5) * 0.22)
    out.multiply(new Color().setRGB(1 - amt * 0.03, 1 - amt * 0.11, 1 - amt * 0.34))
  })
  return merged
}

/** Braided lead leaves the rear face through a moulded boot; the desk cable
    (Desk.tsx) starts inside it. Built in keyboard-frame coordinates. */
function buildBoot(): BufferGeometry {
  const c = Math.cos(KBD_YAW)
  const s = Math.sin(KBD_YAW)
  const local = (wx: number, wy: number, wz: number) => {
    const dx = wx - KBD_POS.x
    const dz = wz - KBD_POS.z
    return new Vector3(dx * c - dz * s, wy - KBD_POS.y, dx * s + dz * c)
  }
  const a = local(0.17, 0.7615, -0.522)
  const b = local(0.178, 0.7505, -0.55)
  const dir = b.clone().sub(a).normalize()
  const boot = lathe(
    [
      [0.0001, -0.008],
      [0.0072, -0.008],
      [0.0078, 0.0],
      [0.0068, 0.008],
      [0.0056, 0.018],
      [0.0046, 0.026],
      [0.004, 0.0275],
      [0.0001, 0.0275],
    ],
    14,
  )
  boot.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir))
  boot.translate(a.x, a.y, a.z)
  return part(boot, { color: '#1a1a1c', tile: 0.02 })
}

const LED_X = [0.1455, 0.168, 0.1905]

export default function Keyboard() {
  const powered = useSystem((s) => s.power !== 'off')
  const specs = useMemo(() => planKeys(), [])
  const plastic = useMemo(() => sharedPlastic(), [])
  const capSet = useMemo(() => keycapSet(11, 256, 0.09), [])
  const atlas = useMemo(() => buildAtlas(specs), [specs])
  const caseGeo = useMemo(() => buildCase(), [])
  const bootGeo = useMemo(() => buildBoot(), [])
  const badge = useMemo(
    () =>
      makeDecal(512, 64, (ctx, w, h) => {
        ctx.fillStyle = '#c9c6bd'
        ctx.fillRect(0, 0, w, h)
        drawSpaced(ctx, 'SYNTHKEY 101', w / 2, h / 2 + 1, "700 34px 'Helvetica Neue', Arial, sans-serif", '#4b473f', 6, 'center')
      }),
    [],
  )
  const lockIcons = useMemo(
    () =>
      makeDecal(512, 64, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h)
        const ink = '#b9b4a6'
        drawSpaced(ctx, 'NUM', w * 0.14, h / 2, "700 26px 'Helvetica Neue', Arial, sans-serif", ink, 2, 'center')
        drawSpaced(ctx, 'CAPS', w * 0.5, h / 2, "700 26px 'Helvetica Neue', Arial, sans-serif", ink, 2, 'center')
        drawSpaced(ctx, 'SCRL', w * 0.86, h / 2, "700 26px 'Helvetica Neue', Arial, sans-serif", ink, 2, 'center')
      }),
    [],
  )

  /* the two instanced meshes, built once */
  const { caps, legends, capMat, legendMat, depthMat } = useMemo(() => {
    const n = specs.length
    const capGeo = buildCap()
    const size = new Float32Array(n * 2)
    specs.forEach((s, i) => {
      size[i * 2] = s.stx
      size[i * 2 + 1] = s.stz
    })
    capGeo.setAttribute('instanceSize', new InstancedBufferAttribute(size, 2))

    const capMat = new MeshStandardMaterial({
      color: '#ffffff',
      roughness: 1,
      roughnessMap: capSet.roughnessMap,
      normalMap: capSet.normalMap,
      normalScale: new Vector2(capSet.normalScale[0], capSet.normalScale[1]),
    })
    capMat.onBeforeCompile = stretchPatch
    const depthMat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
    depthMat.onBeforeCompile = stretchPatch

    const caps = new InstancedMesh(capGeo, capMat, n)
    caps.customDepthMaterial = depthMat
    caps.castShadow = true
    const color = new Color()
    specs.forEach((s, i) => {
      color.set(s.mod ? '#a8a08b' : '#dad3bf')
      color.offsetHSL(0, 0, wonk(i, 4) * 0.018)
      caps.setColorAt(i, color)
    })

    // legends: a flat quad on the dish floor, atlas UVs per instance
    const qg = new PlaneGeometry(1, 1)
    qg.rotateX(-Math.PI / 2)
    const uvs = new Float32Array(n * 4)
    specs.forEach((s, i) => {
      const c = s.main ? atlas.cells.get(legendKey(s)) : undefined
      if (!c) return
      uvs[i * 4] = c.x / ATLAS
      uvs[i * 4 + 1] = 1 - (c.y + c.h) / ATLAS
      uvs[i * 4 + 2] = c.w / ATLAS
      uvs[i * 4 + 3] = c.h / ATLAS
    })
    qg.setAttribute('instanceUv', new InstancedBufferAttribute(uvs, 4))
    const legendMat = new MeshStandardMaterial({
      map: atlas.tex,
      color: '#ffffff',
      roughness: 1,
      envMapIntensity: 0.35,
      transparent: true,
      alphaTest: 0.03,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    legendMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 instanceUv;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          #ifdef USE_MAP
          vMapUv = vMapUv * instanceUv.zw + instanceUv.xy;
          #endif`,
        )
    }
    const legends = new InstancedMesh(qg, legendMat, n)
    // keys with no legend (the spacebar) collapse to nothing
    specs.forEach((s, i) => {
      writeKey(s, i, 0, caps, legends)
      if (!s.main) {
        _dummy.scale.set(0, 0, 0)
        _dummy.updateMatrix()
        legends.setMatrixAt(i, _dummy.matrix)
      }
    })
    caps.instanceMatrix.needsUpdate = true
    if (caps.instanceColor) caps.instanceColor.needsUpdate = true
    legends.instanceMatrix.needsUpdate = true
    return { caps, legends, capMat, legendMat, depthMat }
  }, [specs, capSet, atlas])

  const codeIndex = useMemo(() => {
    const m = new Map<string, number>()
    specs.forEach((s, i) => m.set(s.code, i))
    return m
  }, [specs])

  useEffect(
    () => () => {
      caps.geometry.dispose()
      legends.geometry.dispose()
      capMat.dispose()
      legendMat.dispose()
      depthMat.dispose()
      caps.dispose()
      legends.dispose()
    },
    [caps, legends, capMat, legendMat, depthMat],
  )
  useEffect(
    () => () => {
      plastic.dispose()
      capSet.dispose()
      atlas.tex.dispose()
      caseGeo.dispose()
      bootGeo.dispose()
      badge.dispose()
      lockIcons.dispose()
    },
    [plastic, capSet, atlas, caseGeo, bootGeo, badge, lockIcons],
  )

  /* useFrame mutates the instances through these ref aliases */
  const capsRef = useRef<InstancedMesh>(null)
  const legendsRef = useRef<InstancedMesh>(null)
  const press = useRef(new Float32Array(specs.length))
  const target = useRef(new Float32Array(specs.length))
  const active = useRef(new Set<number>())
  const typed = useRef('')

  /* real keystrokes press the 3D caps (room view only) */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (useSystem.getState().view !== 'room') return
      // typing into a field (or searching the library) is not desk typing;
      // nor is Esc / the arrow keys at the pin-up board
      if (useLibrary.getState().open || usePins.getState().open) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      const idx = codeIndex.get(e.code)
      if (idx !== undefined) {
        target.current[idx] = 1
        active.current.add(idx)
        if (!e.repeat) playClick()
      }
      // rolling buffer — typing "hire" pings the sticky note
      if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
        typed.current = (typed.current + e.key.toLowerCase()).slice(-6)
        if (typed.current.endsWith('hire')) {
          typed.current = ''
          // the sticky note glows, the ledger notes it, and the machine
          // boots straight into Contact (the OS side handles the rest)
          useRoom.getState().pingHire()
          useWorld.getState().mark('hire')
          useSystem.getState().powerOnForHire()
          playBeep()
        }
      }
    }
    const up = (e: KeyboardEvent) => {
      const idx = codeIndex.get(e.code)
      if (idx !== undefined) target.current[idx] = 0
    }
    const blur = () => {
      target.current.fill(0)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [codeIndex])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const c = capsRef.current
    const l = legendsRef.current
    if (!c || !l || active.current.size === 0) return
    for (const i of active.current) {
      const p = MathUtils.damp(press.current[i], target.current[i], 34, dt)
      press.current[i] = p
      if (target.current[i] === 0 && p < 0.002) {
        press.current[i] = 0
        active.current.delete(i)
        writeKey(specs[i], i, 0, c, l)
      } else {
        writeKey(specs[i], i, p, c, l)
      }
      if (!specs[i].main) {
        _dummy.scale.set(0, 0, 0)
        _dummy.updateMatrix()
        l.setMatrixAt(i, _dummy.matrix)
      }
    }
    c.instanceMatrix.needsUpdate = true
    l.instanceMatrix.needsUpdate = true
  })

  const ledOn = powered ? 1.3 : 0
  const ledY = H + 0.0016
  const ledZ = -D / 2 + 0.0095

  return (
    <group position={KBD_POS} rotation-y={KBD_YAW}>
      {/* the rear feet lift the back: tilt about the front bottom edge */}
      <group position={[0, 0, D / 2]} rotation-x={TILT}>
        <group position={[0, 0, -D / 2]}>
          <mesh geometry={caseGeo} castShadow receiveShadow>
            <meshStandardMaterial
              color="#d9d0b8"
              roughness={0.62}
              vertexColors
              normalMap={plastic.normalMap}
              normalScale={[0.4, 0.4]}
              roughnessMap={plastic.roughnessMap}
            />
          </mesh>

          <primitive ref={capsRef} object={caps} />
          <primitive ref={legendsRef} object={legends} />

          {/* badge and lock-light captions printed on the rim */}
          <mesh position={[-0.16, H + 0.0011, ledZ]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[0.042, 0.0055]} />
            <meshBasicMaterial map={badge} toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
          </mesh>
          <mesh position={[0.168, H + 0.0012, ledZ + 0.0032]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[0.056, 0.0035]} />
            <meshBasicMaterial map={lockIcons} transparent toneMapped={false} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
          </mesh>

          {/* lock LEDs, lit while the machine runs */}
          {LED_X.map((x) => (
            <group key={x} position={[x, ledY, ledZ - 0.0015]}>
              <mesh>
                <roundedBoxGeometry args={rb(0.0065, 0.0016, 0.0028, 0.0006, 2)} />
                <meshStandardMaterial
                  color="#1c2f14"
                  emissive={P.ledGreen}
                  emissiveIntensity={ledOn}
                />
              </mesh>
              <Halo
                color={P.ledGreen}
                size={0.016}
                intensity={Math.min(0.5, ledOn * 0.3)}
                position={[0, 0.0016, 0]}
              />
            </group>
          ))}
        </group>
      </group>

      {/* strain-relief boot on the rear face; the cable itself is the desk's */}
      <mesh geometry={bootGeo} castShadow>
        <meshStandardMaterial vertexColors roughness={0.7} />
      </mesh>
    </group>
  )
}
