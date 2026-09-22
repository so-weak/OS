import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  ShapeUtils,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { WINDOW } from '../layout'
import { makeCanvas, mulberry } from '../textures'
import { fieldCanvas, normalCanvas, normalizeField } from './noise'

/* =====================================================================
   Carpentry for the window and the wall clock.

   Every moulded part in the window (casing, sash, glazing bars, sill,
   apron) is a PROFILE swept around or along a straight run — the way a
   joiner's router bit makes it — so the edges are real bevels and ogees
   that catch the lamp, not boxes. `loftRing` sweeps one profile round a
   rectangle and mitres the corners for free (each profile point is a
   nested rectangle); UVs run along the grain so the wood texture follows
   the length of each piece.

   Everything here returns plain BufferGeometry (position, normal, uv;
   non-indexed) so parts sharing a material can be merged into one draw
   call. All dimensions are metres in window-local space: origin at the
   centre of the opening on the wall face, +z into the room.
   ===================================================================== */

/* ---------- a tiny triangle soup ---------- */

type V8 = [number, number, number, number, number, number, number, number]

class Soup {
  pos: number[] = []
  nor: number[] = []
  uv: number[] = []

  /** one triangle; winding is flipped to agree with the vertex normals */
  tri(a: V8, b: V8, c: V8): void {
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const ez = b[2] - a[2]
    const fx = c[0] - a[0]
    const fy = c[1] - a[1]
    const fz = c[2] - a[2]
    const nx = ey * fz - ez * fy
    const ny = ez * fx - ex * fz
    const nz = ex * fy - ey * fx
    const dot =
      nx * (a[3] + b[3] + c[3]) + ny * (a[4] + b[4] + c[4]) + nz * (a[5] + b[5] + c[5])
    const t = dot < 0 ? [a, c, b] : [a, b, c]
    for (const v of t) {
      this.pos.push(v[0], v[1], v[2])
      this.nor.push(v[3], v[4], v[5])
      this.uv.push(v[6], v[7])
    }
  }

  quad(a: V8, b: V8, c: V8, d: V8): void {
    this.tri(a, b, c)
    this.tri(a, c, d)
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2))
    g.computeBoundingSphere()
    return g
  }
}

/** Merge parts that share a material into one geometry / one draw call. */
export function merged(parts: BufferGeometry[]): BufferGeometry {
  const list = parts.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g
    for (const k of Object.keys(ng.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') ng.deleteAttribute(k)
    }
    if (!ng.getAttribute('uv')) {
      const n = ng.getAttribute('position').count
      ng.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2))
    }
    return ng
  })
  const out = mergeGeometries(list, false)
  if (!out) throw new Error('window: geometry merge failed')
  out.computeBoundingSphere()
  return out
}

/* ---------- profiles ---------- */

/** [across, height, soft?] — `soft` smooths the normal through that point
    (curves); leave it off for a crisp arris. */
export type Pt = readonly [number, number, boolean?]

type N2 = [number, number]

function joinN(a: N2, b: N2): N2 {
  const x = a[0] + b[0]
  const y = a[1] + b[1]
  const l = Math.hypot(x, y) || 1
  return [x / l, y / l]
}

/** Per-segment start/end 2D normals and cumulative arc length of an open
    profile. The normal of a tangent (du,dw) is (-dw,du): a profile walked
    left→right with the solid below faces up. */
function profileFrames(prof: readonly Pt[]) {
  const n = prof.length - 1
  const sn: N2[] = []
  const arc: number[] = [0]
  for (let i = 0; i < n; i++) {
    const du = prof[i + 1][0] - prof[i][0]
    const dw = prof[i + 1][1] - prof[i][1]
    const l = Math.hypot(du, dw)
    sn.push(l > 1e-9 ? [-dw / l, du / l] : [0, 1])
    arc.push(arc[i] + l)
  }
  const start: N2[] = []
  const end: N2[] = []
  for (let i = 0; i < n; i++) {
    start.push(prof[i][2] && i > 0 ? joinN(sn[i - 1], sn[i]) : sn[i])
    end.push(prof[i + 1][2] && i + 1 < n ? joinN(sn[i], sn[i + 1]) : sn[i])
  }
  return { n, start, end, arc }
}

export interface RingOpts {
  /** outer half extents of the ring */
  hx: number
  hy: number
  cx?: number
  cy?: number
  /** height added to every profile point */
  z0?: number
  /** leave the bottom run out; the two uprights then end square at `buttY`
      (relative to cy) instead of mitring into it */
  omitBottom?: boolean
  buttY?: number
}

/** Sweep `prof` (u measured INWARD from the outer edge, w = height) round a
    rectangle. Corners are mitred because each profile point is its own
    nested rectangle. */
export function loftRing(prof: readonly Pt[], o: RingOpts): BufferGeometry {
  const { hx, hy, cx = 0, cy = 0, z0 = 0 } = o
  const f = profileFrames(prof)
  const s = new Soup()

  const yBot = (u: number) =>
    o.omitBottom && o.buttY !== undefined ? o.buttY : -(hy - u)

  type Side = {
    inward: N2
    e0: (u: number) => N2
    e1: (u: number) => N2
    along: 0 | 1
  }
  const sides: Side[] = [
    {
      inward: [0, -1],
      e0: (u) => [-(hx - u), hy - u],
      e1: (u) => [hx - u, hy - u],
      along: 0,
    },
    {
      inward: [1, 0],
      e0: (u) => [-(hx - u), yBot(u)],
      e1: (u) => [-(hx - u), hy - u],
      along: 1,
    },
    {
      inward: [-1, 0],
      e0: (u) => [hx - u, yBot(u)],
      e1: (u) => [hx - u, hy - u],
      along: 1,
    },
  ]
  if (!o.omitBottom) {
    sides.push({
      inward: [0, 1],
      e0: (u) => [-(hx - u), -(hy - u)],
      e1: (u) => [hx - u, -(hy - u)],
      along: 0,
    })
  }

  for (const side of sides) {
    for (let i = 0; i < f.n; i++) {
      const mk = (k: number, endpoint: 0 | 1, nrm: N2): V8 => {
        const u = prof[k][0]
        const p = endpoint === 0 ? side.e0(u) : side.e1(u)
        const nx = side.inward[0] * nrm[0]
        const ny = side.inward[1] * nrm[0]
        return [
          cx + p[0],
          cy + p[1],
          z0 + prof[k][1],
          nx,
          ny,
          nrm[1],
          p[side.along] + (side.along === 0 ? hx : hy),
          f.arc[k],
        ]
      }
      s.quad(
        mk(i, 0, f.start[i]),
        mk(i, 1, f.start[i]),
        mk(i + 1, 1, f.end[i]),
        mk(i + 1, 0, f.end[i]),
      )
    }
  }
  return s.geometry()
}

/** Sweep `prof` (s = signed offset to the LEFT of the run, w = height)
    along a straight run a→b in the xy plane. Ends are left open: bars butt
    into stiles. */
export function loftBar(
  prof: readonly Pt[],
  a: [number, number],
  b: [number, number],
  z0 = 0,
): BufferGeometry {
  const f = profileFrames(prof)
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  const px = -dy / len
  const py = dx / len
  const s = new Soup()
  for (let i = 0; i < f.n; i++) {
    const mk = (k: number, t: 0 | 1, nrm: N2): V8 => {
      const off = prof[k][0]
      const ax = t === 0 ? a[0] : b[0]
      const ay = t === 0 ? a[1] : b[1]
      return [
        ax + px * off,
        ay + py * off,
        z0 + prof[k][1],
        px * nrm[0],
        py * nrm[0],
        nrm[1],
        t === 0 ? 0 : len,
        f.arc[k],
      ]
    }
    s.quad(
      mk(i, 0, f.start[i]),
      mk(i, 1, f.start[i]),
      mk(i + 1, 1, f.end[i]),
      mk(i + 1, 0, f.end[i]),
    )
  }
  return s.geometry()
}

/** Extrude a closed (z,y) polygon along x from x0 to x1, with end caps.
    Points are [z, y, soft?]. UVs: u along x, v round the perimeter. */
export function extrudeProfile(
  poly: readonly Pt[],
  x0: number,
  x1: number,
  yShift = 0,
): BufferGeometry {
  const m = poly.length
  let area = 0
  for (let i = 0; i < m; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % m]
    area += p[0] * q[1] - q[0] * p[1]
  }
  const sgn = area > 0 ? 1 : -1
  // outward normal (nz, ny) of each edge
  const en: N2[] = []
  const arc: number[] = [0]
  for (let i = 0; i < m; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % m]
    const dz = q[0] - p[0]
    const dy = q[1] - p[1]
    const l = Math.hypot(dz, dy) || 1
    en.push([(sgn * dy) / l, (-sgn * dz) / l])
    arc.push(arc[i] + l)
  }
  const vn = (i: number, side: 0 | 1): N2 => {
    // side 0: start of edge i, side 1: end of edge i
    const k = side === 0 ? i : (i + 1) % m
    if (!poly[k][2]) return en[i]
    return side === 0 ? joinN(en[(i + m - 1) % m], en[i]) : joinN(en[i], en[(i + 1) % m])
  }
  const s = new Soup()
  for (let i = 0; i < m; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % m]
    const n0 = vn(i, 0)
    const n1 = vn(i, 1)
    const v = (x: number, pt: Pt, nn: N2, arcv: number): V8 => [
      x,
      pt[1] + yShift,
      pt[0],
      0,
      nn[1],
      nn[0],
      x,
      arcv,
    ]
    s.quad(v(x0, p, n0, arc[i]), v(x1, p, n0, arc[i]), v(x1, q, n1, arc[i + 1]), v(x0, q, n1, arc[i + 1]))
  }
  // caps
  const contour = poly.map((p) => new Vector2(p[0], p[1]))
  const tris = ShapeUtils.triangulateShape(contour, [])
  for (const [i, j, k] of tris) {
    const cap = (x: number, nx: number, a: number, b: number, c: number) => {
      const mkv = (idx: number): V8 => [
        x,
        poly[idx][1] + yShift,
        poly[idx][0],
        nx,
        0,
        0,
        poly[idx][0],
        poly[idx][1],
      ]
      s.tri(mkv(a), mkv(b), mkv(c))
    }
    cap(x1, 1, i, j, k)
    cap(x0, -1, i, j, k)
  }
  return s.geometry()
}

/* =====================================================================
   The window unit
   ===================================================================== */

const HX = WINDOW.frameW / 2
const HY = WINDOW.frameH / 2
const CW = WINDOW.casingW
const LINER_Z = -0.062 // front of the fixed frame
const SASH_Z = -0.07 // front of the sashes (set into the frame)
const GLASS_Z = -WINDOW.glassDepth
const SILL_TOP = -HY + 0.0015 // stool top, a hair above the opening floor
const SASH_HX = 0.1675
const SASH_HY = 0.436
const SASH_CX = 0.1685
const STILE = 0.03

/** Moulded casing: backband shoulder, flat field, ogee bead against the
    opening. u runs inward from the outer edge, 0 → casingW. */
const CASING: Pt[] = [
  [0.0, 0.0],
  [0.0, 0.011],
  [0.0015, 0.0136, true],
  [0.0055, 0.0151, true],
  [0.01, 0.0153, true],
  [0.0135, 0.0146, true],
  [0.017, 0.0124],
  [0.0195, 0.0111, true],
  [0.0225, 0.0108],
  [0.04, 0.0108],
  [0.0432, 0.0114, true],
  [0.0468, 0.0132, true],
  [0.0508, 0.0172, true],
  [0.0545, 0.0218, true],
  [0.0582, 0.0243, true],
  [0.0614, 0.0248, true],
  [0.0638, 0.0228, true],
  [0.065, 0.0165],
  [0.065, 0.0],
]

/** The fixed frame the sashes close into. */
const LINER: Pt[] = [
  [0.0, 0.0],
  [0.0006, 0.0006],
  [0.0175, 0.0006],
  [0.0195, -0.0004, true],
  [0.0212, -0.0022, true],
  [0.022, -0.0042],
  [0.022, -0.045],
]

/** Sash rail/stile: a small bead, then the putty bevel down to the glass. */
const SASH: Pt[] = [
  [0.0, -0.045],
  [0.0, -0.001],
  [0.001, 0.0],
  [0.0085, 0.0],
  [0.0105, 0.0011, true],
  [0.0135, 0.0016, true],
  [0.0165, 0.0009, true],
  [0.0192, 0.0],
  [0.0235, -0.0085],
  [0.0296, -0.0175],
  [0.0296, -0.0285],
]

/** Glazing bar (muntin) — symmetric, same bevel. s across, w up. */
const MUNTIN: Pt[] = [
  [-0.0115, -0.0285],
  [-0.0115, -0.0175],
  [-0.0075, -0.0085],
  [-0.0035, -0.0008],
  [-0.0025, 0.0],
  [0.0025, 0.0],
  [0.0035, -0.0008],
  [0.0075, -0.0085],
  [0.0115, -0.0175],
  [0.0115, -0.0285],
]

const SILL: Pt[] = [
  [-0.062, 0.0],
  [0.07, 0.0],
  [0.0768, -0.0007, true],
  [0.0812, -0.003, true],
  [0.084, -0.0066, true],
  [0.085, -0.011],
  [0.085, -0.0175],
  [0.0838, -0.0215, true],
  [0.0805, -0.0245, true],
  [0.076, -0.0264, true],
  [0.07, -0.0272],
  [0.0, -0.028],
  [-0.062, -0.028],
]

const APRON: Pt[] = [
  [0.0, 0.0],
  [0.0158, 0.0],
  [0.0158, -0.0335],
  [0.0168, -0.0372, true],
  [0.0181, -0.0408, true],
  [0.0181, -0.0448, true],
  [0.0164, -0.0482, true],
  [0.0132, -0.0497, true],
  [0.0, -0.05],
]

export interface WindowGeometry {
  /** casing, liner, sashes, bars, sill, apron — one varnished wood material */
  wood: BufferGeometry
  /** the fastener and its keeper, screws */
  brass: BufferGeometry
  /** weather-strip: bulb seal round the sashes and between the stiles */
  rubber: BufferGeometry
  /** the single pane behind the bars */
  glass: BufferGeometry
  /** soft contact shadow round the casing, sill and apron on the wall */
  halo: BufferGeometry
}

function screw(x: number, y: number, z: number): BufferGeometry {
  const g = new CylinderGeometry(0.0021, 0.0023, 0.0012, 10)
  g.rotateX(Math.PI / 2)
  g.translate(x, y, z)
  return g
}

/** RoundedBoxGeometry positioned at (x,y,z). */
function rbox(
  w: number,
  h: number,
  d: number,
  r: number,
  x: number,
  y: number,
  z: number,
  segments = 2,
): BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, segments, Math.min(r, Math.min(w, h, d) * 0.45))
  g.translate(x, y, z)
  return g
}

/** Soft "ambient occlusion" ring on the wall: vertex alpha falls from the
    silhouette outward. RGBA vertex colours; use with a black basic material. */
function haloGeometry(): BufferGeometry {
  const horn = WINDOW.sillHorn
  const halfW = HX + CW + horn
  const top = HY + CW
  const bottom = SILL_TOP - 0.028 - 0.05
  const steps: { o: number; a: number }[] = [
    { o: 0, a: 0.62 },
    { o: 0.012, a: 0.34 },
    { o: 0.034, a: 0.12 },
    { o: 0.07, a: 0 },
  ]
  const pos: number[] = []
  const col: number[] = []
  const z = 0.0007
  const push = (x: number, y: number, a: number) => {
    pos.push(x, y, z)
    col.push(0, 0, 0, a)
  }
  // the shadow reads mostly BELOW (light comes from the lamp and the room),
  // so the top and sides fall off faster than the bottom
  const rect = (o: number) => ({
    l: -(halfW + o * 0.8),
    r: halfW + o * 0.8,
    t: top + o * 0.7,
    b: bottom - o * 1.6,
  })
  for (let k = 0; k < steps.length - 1; k++) {
    const A = rect(steps[k].o)
    const B = rect(steps[k + 1].o)
    const a0 = steps[k].a
    const a1 = steps[k + 1].a
    const quad = (
      p0: [number, number],
      p1: [number, number],
      q1: [number, number],
      q0: [number, number],
    ) => {
      push(p0[0], p0[1], a0)
      push(p1[0], p1[1], a0)
      push(q1[0], q1[1], a1)
      push(p0[0], p0[1], a0)
      push(q1[0], q1[1], a1)
      push(q0[0], q0[1], a1)
    }
    quad([A.l, A.t], [A.r, A.t], [B.r, B.t], [B.l, B.t]) // top
    quad([A.r, A.t], [A.r, A.b], [B.r, B.b], [B.r, B.t]) // right
    quad([A.r, A.b], [A.l, A.b], [B.l, B.b], [B.r, B.b]) // bottom
    quad([A.l, A.b], [A.l, A.t], [B.l, B.t], [B.l, B.b]) // left
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new Float32BufferAttribute(col, 4))
  // the winding above is inconsistent by design: render both sides
  g.computeBoundingSphere()
  return g
}

export function buildWindowFrame(): WindowGeometry {
  const wood: BufferGeometry[] = []

  // casing: head + two jambs, sitting on the stool
  wood.push(
    loftRing(CASING, {
      hx: HX + CW,
      hy: HY + CW,
      omitBottom: true,
      buttY: SILL_TOP,
    }),
  )
  // the fixed frame in the tunnel
  wood.push(loftRing(LINER, { hx: HX, hy: HY, z0: LINER_Z }))

  // two casement sashes, each with a glazing bar across the middle
  for (const sgn of [-1, 1]) {
    wood.push(
      loftRing(SASH, { cx: sgn * SASH_CX, hx: SASH_HX, hy: SASH_HY, z0: SASH_Z }),
    )
    // the bar runs between the two stiles: glass edge to glass edge
    const xa = sgn * (SASH_CX - SASH_HX + STILE)
    const xb = sgn * (SASH_CX + SASH_HX - STILE)
    wood.push(loftBar(MUNTIN, [Math.min(xa, xb), 0], [Math.max(xa, xb), 0], SASH_Z))
  }

  // stool (sill) and apron
  const sillHalf = HX + CW + WINDOW.sillHorn
  wood.push(extrudeProfile(SILL, -sillHalf, sillHalf, SILL_TOP))
  wood.push(extrudeProfile(APRON, -(HX + CW - 0.02), HX + CW - 0.02, SILL_TOP - 0.028))

  // ----- brass: cockspur fastener on the left stile, keeper on the right
  const zf = SASH_Z
  const ly = -0.11
  const brass: BufferGeometry[] = []
  brass.push(rbox(0.022, 0.06, 0.0035, 0.0014, -0.0155, ly, zf + 0.00175))
  {
    const boss = new CylinderGeometry(0.0062, 0.0068, 0.0055, 20)
    boss.rotateX(Math.PI / 2)
    boss.translate(-0.0155, ly + 0.006, zf + 0.0063)
    brass.push(boss)
  }
  {
    // the lever: a flat arm with a rounded grip, pointing across the meeting
    const arm = rbox(0.046, 0.0075, 0.0038, 0.0018, 0.0075, ly + 0.006, zf + 0.0093)
    brass.push(arm)
    const grip = new SphereGeometry(0.0058, 14, 10)
    grip.translate(0.031, ly + 0.006, zf + 0.0098)
    brass.push(grip)
  }
  brass.push(rbox(0.018, 0.03, 0.003, 0.0012, 0.0165, ly + 0.006, zf + 0.0015))
  {
    // the catch the lever hooks over
    const catchG = rbox(0.011, 0.0055, 0.0055, 0.0018, 0.0165, ly + 0.006, zf + 0.0056)
    brass.push(catchG)
  }
  // butt hinges where each sash meets the fixed frame: a leaf across the
  // joint, the knuckle standing proud of it, and two screws
  for (const sgn of [-1, 1]) {
    for (const hy of [-0.33, 0.0, 0.33]) {
      const hx = sgn * (SASH_CX + SASH_HX + 0.001)
      brass.push(rbox(0.03, 0.062, 0.0018, 0.0006, hx, hy, LINER_Z + 0.0009, 1))
      const knuckle = new CylinderGeometry(0.0034, 0.0034, 0.058, 12)
      knuckle.translate(hx, hy, LINER_Z + 0.0033)
      brass.push(knuckle)
      brass.push(screw(hx - sgn * 0.0095, hy - 0.019, LINER_Z + 0.0022))
      brass.push(screw(hx - sgn * 0.0095, hy + 0.019, LINER_Z + 0.0022))
    }
  }
  for (const [sx, sy] of [
    [-0.0155, ly - 0.024],
    [-0.0155, ly + 0.024],
    [0.0165, ly - 0.008],
    [0.0165, ly + 0.02],
  ] as const) {
    brass.push(screw(sx, sy, zf + 0.0037))
  }

  // ----- rubber: bulb seal round each sash and down the meeting line
  const rub: BufferGeometry[] = []
  const SEAL: Pt[] = [
    [0.0, 0.0],
    [0.0007, 0.0024, true],
    [0.0022, 0.0033, true],
    [0.0037, 0.0024, true],
    [0.0044, 0.0],
  ]
  rub.push(
    loftRing(SEAL, {
      hx: HX - 0.0205,
      hy: HY - 0.0205,
      z0: LINER_Z - 0.0005,
    }),
  )
  rub.push(
    loftBar(
      [
        [-0.0011, 0.0],
        [-0.0011, 0.0012],
        [-0.0004, 0.0019, true],
        [0.0004, 0.0019, true],
        [0.0011, 0.0012],
        [0.0011, 0.0],
      ],
      [0, -SASH_HY + 0.006],
      [0, SASH_HY - 0.006],
      SASH_Z,
    ),
  )

  const gw = 2 * (SASH_CX + SASH_HX - STILE) // 0.612
  const glass = new PlaneGeometry(gw, 2 * (SASH_HY - STILE))
  glass.translate(0, 0, GLASS_Z)

  return {
    wood: merged(wood),
    brass: merged(brass),
    rubber: merged(rub),
    glass,
    halo: haloGeometry(),
  }
}

/* =====================================================================
   Venetian blind parts
   ===================================================================== */

export const SLAT_LEN = 0.7
export const SLAT_WIDTH = 0.05

/** One aluminium slat: a shallow cupped blade (edges curl up 4 mm), about a
    millimetre thick, with the plan-view corners rounded. Lofted along x in
    cross-sections whose width shrinks through the rounded ends. */
export function buildSlat(): BufferGeometry {
  const c = SLAT_WIDTH / 2
  const sag = 0.0042
  const th = 0.0011
  const L = SLAT_LEN
  const r = 0.0055
  const N = 7 // samples across each surface
  // x stations and their half-width scale
  const st: { x: number; k: number }[] = []
  const ends = 4
  for (let i = 0; i < ends; i++) {
    const a = (i / (ends - 1)) * (Math.PI / 2)
    st.push({ x: -L / 2 + r - r * Math.sin(a), k: (c - r + r * Math.cos(a)) / c })
  }
  st.reverse()
  // st now runs from the very end inward; rebuild the full sequence
  const left = st // x: -L/2 … -L/2+r (k rising 1)
  const seq = [...left]
  for (let i = ends - 1; i >= 0; i--) {
    seq.push({ x: -left[i].x, k: left[i].k })
  }
  // cross-section loop: top surface (−c → c) then bottom back (c → −c)
  const section = (k: number): [number, number][] => {
    const pts: [number, number][] = []
    for (let i = 0; i <= N; i++) {
      const zn = -1 + (2 * i) / N
      pts.push([zn * c * k, sag * zn * zn * k * k + th / 2])
    }
    for (let i = N; i >= 0; i--) {
      const zn = -1 + (2 * i) / N
      pts.push([zn * c * k, sag * zn * zn * k * k - th / 2])
    }
    return pts
  }
  const M = 2 * (N + 1)
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  seq.forEach((s, si) => {
    const sec = section(s.k)
    sec.forEach(([z, y]) => {
      pos.push(s.x, y, z)
      // fine brushing runs along the blade, at a couple of millimetres a line
      uv.push(s.x / 0.35, (z / 0.05) * 0.3 + 0.5)
    })
    if (si > 0) {
      const a = (si - 1) * M
      const b = si * M
      for (let j = 0; j < M; j++) {
        const j2 = (j + 1) % M
        idx.push(a + j, b + j2, b + j, a + j, a + j2, b + j2)
      }
    }
  })
  // end caps (their own vertices, so the normals stay flat)
  const capTris = (si: number, nx: number) => {
    const sec = section(seq[si].k).map(([z, y]) => new Vector2(z, y))
    const t = ShapeUtils.triangulateShape(sec, [])
    const base = pos.length / 3
    sec.forEach((p) => {
      pos.push(seq[si].x, p.y, p.x)
      uv.push(0, 0)
    })
    for (const [a, b, c2] of t) {
      // triangle (x,y,z) cross product must point along nx
      const ay = sec[a].y
      const az = sec[a].x
      const cr =
        (sec[b].y - ay) * (sec[c2].x - az) - (sec[b].x - az) * (sec[c2].y - ay)
      if (cr * nx >= 0) idx.push(base + a, base + b, base + c2)
      else idx.push(base + a, base + c2, base + b)
    }
  }
  capTris(0, -1)
  capTris(seq.length - 1, 1)
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

/** Hardware that does not move with the tilt: headrail with its end caps
    and valance lip, bottom rail. One paint-finished aluminium material. */
export function buildBlindRails(): BufferGeometry {
  const parts: BufferGeometry[] = []
  // headrail: a rounded channel, plus a thin front lip
  parts.push(rbox(0.706, 0.034, 0.052, 0.008, 0, 0.443, -0.035))
  parts.push(rbox(0.7, 0.006, 0.058, 0.0028, 0, 0.4245, -0.035))
  // end caps
  parts.push(rbox(0.004, 0.036, 0.056, 0.0016, -0.353, 0.443, -0.035))
  parts.push(rbox(0.004, 0.036, 0.056, 0.0016, 0.353, 0.443, -0.035))
  // bottom rail with a rolled edge
  parts.push(rbox(0.702, 0.014, 0.032, 0.005, 0, -0.4085, -0.035))
  return merged(parts)
}

/** Ladder tapes: two woven straps each side, rungs at every slat, and the
    cord-lock plugs on the headrail. Cloth-finish. */
export function buildBlindTapes(
  slats: number,
  top: number,
  step: number,
): BufferGeometry {
  const parts: BufferGeometry[] = []
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new BoxGeometry(w, h, d)
    g.translate(x, y, z)
    return g
  }
  for (const x of [-0.2, 0.2]) {
    // front and back strap
    parts.push(box(0.009, 0.842, 0.0009, x, 0.0, -0.035 + 0.0295))
    parts.push(box(0.009, 0.842, 0.0009, x, 0.0, -0.035 - 0.0295))
    // rungs
    for (let i = 0; i < slats; i++) {
      parts.push(box(0.009, 0.0011, 0.0596, x, top - i * step - 0.0011, -0.035))
    }
    // the tape's cap on the headrail
    parts.push(rbox(0.018, 0.005, 0.03, 0.0016, x, 0.4245, -0.035))
  }
  return merged(parts)
}

/** The tilt wand: a thin rod on a swivel hook, hanging from the headrail. */
export function buildBlindWand(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const rod = new CylinderGeometry(0.0033, 0.0033, 0.46, 12)
  rod.translate(0, -0.23, 0)
  parts.push(rod)
  const hook = new CylinderGeometry(0.0045, 0.0045, 0.014, 12)
  hook.rotateX(Math.PI / 2)
  hook.translate(0, 0.0, 0)
  parts.push(hook)
  const knob = new SphereGeometry(0.0052, 12, 10)
  knob.translate(0, -0.463, 0)
  parts.push(knob)
  return merged(parts)
}

/** The cord pull: a cord, and a turned acorn at the end. Two geometries so
    the cord and the wooden pull can take different materials. */
export function buildCordPull(len: number): { cord: BufferGeometry; acorn: BufferGeometry } {
  const cord = new CylinderGeometry(0.0021, 0.0021, len, 8)
  cord.translate(0, -len / 2, 0)
  const prof: Vector2[] = [
    [0.0, -0.001],
    [0.0022, -0.001],
    [0.0034, -0.006],
    [0.0056, -0.014],
    [0.0066, -0.022],
    [0.0058, -0.029],
    [0.0038, -0.034],
    [0.0012, -0.0365],
    [0.0, -0.037],
  ].map(([x, y]) => new Vector2(x, y))
  const acorn = new LatheGeometry(prof, 14)
  acorn.translate(0, -len, 0)
  return { cord, acorn }
}

/* =====================================================================
   The wall clock
   ===================================================================== */

export const CLOCK = {
  R: 0.11,
  dialZ: 0.0165,
  dialR: 0.0975,
  glassZ: 0.0272,
} as const

/** Lathe-turned case: rolled back edge, straight side, rounded bezel lip
    stepping down into the dial recess. Axis along +z. */
export function buildClockCase(): BufferGeometry {
  const pts: [number, number][] = [
    [0.0, 0.0],
    [0.098, 0.0],
    [0.104, 0.0008],
    [0.1085, 0.004],
    [0.11, 0.008],
    [0.11, 0.02],
    [0.1094, 0.0236],
    [0.1068, 0.0263],
    [0.1032, 0.0279],
    [0.1, 0.0283],
    [0.0986, 0.0274],
    [0.0979, 0.0246],
    [0.0975, 0.0205],
    [0.0972, CLOCK.dialZ],
  ]
  const g = new LatheGeometry(
    pts.map(([r, z]) => new Vector2(r, z)),
    72,
  )
  g.rotateX(Math.PI / 2)
  return g
}

/** The rear: battery-compartment bump, hanger slot boss and the nail it
    hangs from. Sits behind the case (z < 0). */
export function buildClockBack(): BufferGeometry {
  const parts: BufferGeometry[] = []
  // battery bump
  parts.push(rbox(0.05, 0.062, 0.009, 0.004, 0, -0.012, -0.0045))
  // hanger boss near the top with its slot
  parts.push(rbox(0.028, 0.02, 0.005, 0.0025, 0, 0.078, -0.0025))
  return merged(parts)
}

/** Shallow domed crystal over the dial. Axis +z, apex at glassZ + h. */
export function buildClockDome(): BufferGeometry {
  const a = CLOCK.dialR - 0.0008
  const h = 0.0064
  const Rs = (a * a + h * h) / (2 * h)
  const theta = Math.asin(a / Rs)
  const g = new SphereGeometry(Rs, 56, 6, 0, Math.PI * 2, 0, theta)
  g.rotateX(Math.PI / 2)
  g.translate(0, 0, CLOCK.glassZ + h - Rs)
  // planar UVs, so a glare painted on the crystal stays where it is painted
  const pos = g.getAttribute('position')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / (2 * a) + 0.5
    uv[i * 2 + 1] = pos.getY(i) / (2 * a) + 0.5
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  return g
}

/** What the crystal carries: a barely-there veil, a crescent of window
    light hugging the upper-left rim, a soft diagonal streak across. Alpha
    only in spirit — the RGB is white. */
export function clockGlare(size = 256): CanvasTexture {
  const ctx = makeCanvas(size, size)
  const c = size / 2
  ctx.fillStyle = 'rgba(255,255,255,0.035)'
  ctx.beginPath()
  ctx.arc(c, c, c, 0, Math.PI * 2)
  ctx.fill()
  // crescent along the rim
  const g = ctx.createLinearGradient(size * 0.1, size * 0.1, size * 0.5, size * 0.5)
  g.addColorStop(0, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.strokeStyle = g
  ctx.lineCap = 'round'
  ctx.lineWidth = size * 0.028
  ctx.beginPath()
  ctx.arc(c, c, c * 0.9, Math.PI * 1.05, Math.PI * 1.55)
  ctx.stroke()
  ctx.lineWidth = size * 0.012
  ctx.beginPath()
  ctx.arc(c, c, c * 0.78, Math.PI * 1.12, Math.PI * 1.45)
  ctx.stroke()
  // a soft streak from upper left to lower right
  ctx.save()
  ctx.translate(c, c)
  ctx.rotate(-0.7)
  const sg = ctx.createLinearGradient(0, -c * 0.32, 0, c * 0.32)
  sg.addColorStop(0, 'rgba(255,255,255,0)')
  sg.addColorStop(0.5, 'rgba(255,255,255,0.09)')
  sg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = sg
  ctx.fillRect(-c, -c * 0.32, size, c * 0.64)
  ctx.restore()
  const t = new CanvasTexture(ctx.canvas)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

function leafHand(len: number, tail: number, wMax: number, wNeck: number, at: number): Shape {
  const s = new Shape()
  s.moveTo(0, -tail)
  s.lineTo(wNeck * 0.75, -tail + 0.003)
  s.lineTo(wNeck, 0)
  s.lineTo(wNeck, len * at * 0.55)
  s.quadraticCurveTo(wMax * 1.15, len * at, wNeck * 0.6, len * 0.8)
  s.lineTo(0, len)
  s.lineTo(-wNeck * 0.6, len * 0.8)
  s.quadraticCurveTo(-wMax * 1.15, len * at, -wNeck, len * at * 0.55)
  s.lineTo(-wNeck, 0)
  s.lineTo(-wNeck * 0.75, -tail + 0.003)
  s.closePath()
  return s
}

/** Hour and minute hands: pierced-leaf shapes, thin with a small bevel. */
export function buildClockHand(kind: 'hour' | 'minute'): BufferGeometry {
  const shape =
    kind === 'hour'
      ? leafHand(0.062, 0.014, 0.0052, 0.0016, 0.62)
      : leafHand(0.092, 0.018, 0.0036, 0.0012, 0.66)
  const g = new ExtrudeGeometry(shape, {
    depth: 0.0006,
    bevelEnabled: true,
    bevelThickness: 0.00025,
    bevelSize: 0.00025,
    bevelSegments: 1,
    curveSegments: 8,
  })
  g.translate(0, 0, -0.0003)
  return g
}

/** Sweep second hand: needle, counterweight disc, and a ring near the tip. */
export function buildSecondHand(): BufferGeometry {
  const parts: BufferGeometry[] = []
  parts.push(rbox(0.0013, 0.112, 0.0005, 0.0002, 0, 0.038, 0))
  const cw = new CylinderGeometry(0.0046, 0.0046, 0.0005, 18)
  cw.rotateX(Math.PI / 2)
  cw.translate(0, -0.022, 0)
  parts.push(cw)
  const ring = new TorusGeometry(0.0034, 0.0006, 6, 20)
  ring.translate(0, 0.066, 0)
  parts.push(ring)
  return merged(parts)
}

/* =====================================================================
   Materials' maps
   ===================================================================== */

export interface WoodMaps {
  map: CanvasTexture
  normalMap: CanvasTexture
  roughnessMap: CanvasTexture
  dispose: () => void
}

/** Geometry UVs are metres; one wood tile covers this much. */
export const WOOD_TILE = { u: 0.6, v: 0.14 } as const

/** Tileable value noise with separate lattice counts along x and y (so it
    can be stretched into grain). `noise.ts` stretches by sampling a square
    lattice, which does not wrap on the short axis; this one does. */
function stretchedNoise(
  size: number,
  seed: number,
  nx: number,
  ny: number,
  octaves: number,
  persistence: number,
): Float32Array {
  const rand = mulberry(seed)
  const out = new Float32Array(size * size)
  const sm = (t: number) => t * t * (3 - 2 * t)
  // table-driven (see fbmField in noise.ts): the x cell/weight per column
  // once per octave, and each row blends its two lattice rows up front
  const XA = new Int32Array(size)
  const XB = new Int32Array(size)
  const TX = new Float64Array(size)
  let amp = 1
  for (let o = 0; o < octaves; o++) {
    const lx = nx * 2 ** o
    const ly = ny * 2 ** o
    const g = new Float32Array(lx * ly)
    for (let i = 0; i < g.length; i++) g[i] = rand()
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * lx
      const x0 = Math.floor(fx)
      TX[x] = sm(fx - x0)
      XA[x] = x0 % lx
      XB[x] = (x0 + 1) % lx
    }
    const row = new Float64Array(lx)
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * ly
      const y0 = Math.floor(fy)
      const ty = sm(fy - y0)
      const ra = (y0 % ly) * lx
      const rb = ((y0 + 1) % ly) * lx
      for (let j = 0; j < lx; j++) {
        const a = g[ra + j]
        row[j] = a + (g[rb + j] - a) * ty
      }
      const base = y * size
      for (let x = 0; x < size; x++) {
        const a = row[XA[x]]
        out[base + x] += amp * (a + (row[XB[x]] - a) * TX[x])
      }
    }
    amp *= persistence
  }
  return normalizeField(out)
}

/** Varnished teak: long grain streaks, growth rings that wander, fine dark
    pores, plus a normal and a roughness map from the same height (the
    pores are rougher than the varnished ridges). Grain runs along U. */
export function teakMaps(seed = 5, size = 384): WoodMaps {
  const grain = stretchedNoise(size, seed, 2, 56, 4, 0.6)
  // the rings' wander is low-frequency: paint it at a quarter size
  const wsz = size >> 2
  const warpSmall = stretchedNoise(wsz, seed + 1, 2, 3, 3, 0.5)
  const rand = mulberry(seed + 7)
  const height = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  const ctx = makeCanvas(size, size, true)
  const img = ctx.createImageData(size, size)
  const dark = [50, 32, 20]
  const light = [128, 92, 58]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const g = grain[i]
      const w = warpSmall[(y >> 2) * wsz + (x >> 2)]
      const ring = 0.5 + 0.5 * Math.sin(((y / size) * 8 + w * 3.4) * Math.PI * 2)
      const ringLine = Math.pow(ring, 6)
      const pore = rand() < 0.008 ? 1 : 0
      const tone = 0.36 + 0.34 * g + 0.2 * (1 - ringLine) - 0.16 * pore
      height[i] = 0.5 * g + 0.3 * ringLine - 0.1 * pore
      rough[i] = 0.35 + 0.4 * (1 - g) + 0.35 * pore + 0.1 * ringLine
      const t = Math.max(0, Math.min(1, tone))
      img.data[i * 4] = dark[0] + (light[0] - dark[0]) * t
      img.data[i * 4 + 1] = dark[1] + (light[1] - dark[1]) * t
      img.data[i * 4 + 2] = dark[2] + (light[2] - dark[2]) * t
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  normalizeField(height)
  normalizeField(rough)
  const mk = (canvas: HTMLCanvasElement, srgb: boolean) => {
    const t = new CanvasTexture(canvas)
    if (srgb) t.colorSpace = SRGBColorSpace
    t.wrapS = t.wrapT = RepeatWrapping
    t.magFilter = LinearFilter
    t.minFilter = LinearMipmapLinearFilter
    t.anisotropy = 4
    t.repeat.set(1 / WOOD_TILE.u, 1 / WOOD_TILE.v)
    t.needsUpdate = true
    return t
  }
  const map = mk(ctx.canvas, true)
  const normalMap = mk(normalCanvas(height, size, 0.9), false)
  const roughnessMap = mk(fieldCanvas(rough, size, 0.42, 0.82), false)
  return {
    map,
    normalMap,
    roughnessMap,
    dispose: () => {
      map.dispose()
      normalMap.dispose()
      roughnessMap.dispose()
    },
  }
}

/** The pane's own texture: almost nothing (alpha 0.03) plus the life of a
    real window — a diagonal sheen, cloth-wipe arcs, smudges, a few
    fingerprints, dust, dirt collecting in the lower corners. Alpha-only in
    spirit; the RGB is a cool white. */
export function glassTexture(seed = 21, w = 512, h = 704): CanvasTexture {
  const ctx = makeCanvas(w, h)
  const rand = mulberry(seed)
  ctx.fillStyle = 'rgba(205,220,245,0.035)'
  ctx.fillRect(0, 0, w, h)
  // diagonal sheen bands, wide and faint
  for (const [cx, width, a] of [
    [0.28, 0.1, 0.16],
    [0.42, 0.035, 0.13],
    [0.86, 0.14, 0.1],
  ] as const) {
    const g = ctx.createLinearGradient(w * (cx - width), 0, w * (cx + width), h * 0.4)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.5, `rgba(235,244,255,${a})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(w * (cx - width), 0)
    ctx.lineTo(w * (cx + width + 0.55), 0)
    ctx.lineTo(w * (cx + width - 0.05), h)
    ctx.lineTo(w * (cx - width - 0.6), h)
    ctx.closePath()
    ctx.fill()
  }
  // cloth wipes: big shallow arcs
  ctx.lineCap = 'round'
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = `rgba(230,236,248,${0.03 + rand() * 0.02})`
    ctx.lineWidth = 34 + rand() * 30
    ctx.beginPath()
    const y0 = h * (0.15 + rand() * 0.7)
    ctx.moveTo(-20, y0)
    ctx.bezierCurveTo(w * 0.3, y0 - 60 - rand() * 60, w * 0.7, y0 + 50 + rand() * 60, w + 20, y0 - 10)
    ctx.stroke()
  }
  // smudges
  for (let i = 0; i < 22; i++) {
    const x = rand() * w
    const y = rand() * h
    const r = 18 + rand() * 80
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(222,228,238,${0.04 + rand() * 0.08})`)
    g.addColorStop(1, 'rgba(222,228,238,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // fingerprints
  for (let i = 0; i < 4; i++) {
    const x = 60 + rand() * (w - 120)
    const y = 60 + rand() * (h - 120)
    ctx.strokeStyle = `rgba(238,240,248,${0.05 + rand() * 0.05})`
    ctx.lineWidth = 1
    for (let r = 3; r < 21; r += 2.3) {
      ctx.beginPath()
      ctx.ellipse(x, y, r * 0.8, r, 0.6, 0.4, Math.PI * 1.7)
      ctx.stroke()
    }
  }
  // dust
  for (let i = 0; i < 560; i++) {
    ctx.fillStyle = `rgba(236,236,226,${0.1 + rand() * 0.3})`
    const s = rand() < 0.1 ? 2 : 1
    ctx.fillRect(rand() * w, rand() * h, s, s)
  }
  // a few long hairlines
  ctx.lineWidth = 1
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = `rgba(240,244,255,${0.08 + rand() * 0.1})`
    ctx.beginPath()
    const x = rand() * w
    const y = rand() * h
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rand() - 0.5) * 90, y + (rand() - 0.5) * 60)
    ctx.stroke()
  }
  // dirt in the lower corners and along the bottom rail
  for (const [gx, gy, r, a] of [
    [0, h, 200, 0.11],
    [w, h, 200, 0.1],
    [w * 0.5, h + 20, 260, 0.08],
    [0, 0, 120, 0.05],
    [w, 0, 120, 0.05],
  ] as const) {
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r)
    g.addColorStop(0, `rgba(170,160,140,${a})`)
    g.addColorStop(1, 'rgba(170,160,140,0)')
    ctx.fillStyle = g
    ctx.fillRect(gx - r, gy - r, r * 2, r * 2)
  }
  const t = new CanvasTexture(ctx.canvas)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

/** Feathered dark oval for the clock's shadow on the wall. */
export function shadowBlob(size = 128): CanvasTexture {
  const ctx = makeCanvas(size, size)
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size * 0.5)
  g.addColorStop(0, 'rgba(0,0,0,0.85)')
  g.addColorStop(0.55, 'rgba(0,0,0,0.42)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const t = new CanvasTexture(ctx.canvas)
  t.colorSpace = SRGBColorSpace
  t.needsUpdate = true
  return t
}

/* =====================================================================
   The moth
   ===================================================================== */

export interface MothTextures {
  wings: CanvasTexture
  body: CanvasTexture
  dispose: () => void
}

/** Two sprites' worth of moth, painted top-down with the head up: a pair of
    forewings (long, pointed, banded, with an eye-spot) over a pair of
    hindwings, and a furry body with feathery antennae. The wings are their
    own sprite so the wing-beat can squash them without squashing the body. */
export function mothTextures(): MothTextures {
  const S = 128
  const w = makeCanvas(S, S)
  const c = S / 2
  const wingPath = (
    ctx: CanvasRenderingContext2D,
    pts: [number, number][],
    mirror: boolean,
  ) => {
    const m = (x: number) => (mirror ? S - x : x)
    ctx.beginPath()
    ctx.moveTo(m(pts[0][0]), pts[0][1])
    for (let i = 1; i + 1 < pts.length; i += 2) {
      ctx.quadraticCurveTo(m(pts[i][0]), pts[i][1], m(pts[i + 1][0]), pts[i + 1][1])
    }
    ctx.closePath()
  }
  const fore: [number, number][] = [
    [c + 3, 62],
    [c + 30, 30],
    [c + 60, 30],
    [c + 66, 46],
    [c + 44, 74],
    [c + 3, 76],
  ]
  const hind: [number, number][] = [
    [c + 2, 70],
    [c + 30, 74],
    [c + 44, 100],
    [c + 30, 112],
    [c + 8, 100],
    [c + 2, 86],
  ]
  for (const mirror of [false, true]) {
    // hindwings first: they sit under the forewings
    wingPath(w, hind, mirror)
    const hg = w.createLinearGradient(c, 74, c + 44 * (mirror ? -1 : 1), 108)
    hg.addColorStop(0, '#dccaa0')
    hg.addColorStop(1, '#b59f72')
    w.fillStyle = hg
    w.fill()
    w.strokeStyle = 'rgba(245,235,205,0.7)'
    w.lineWidth = 1.5
    w.stroke()
    wingPath(w, fore, mirror)
    const fg = w.createLinearGradient(c, 60, c + 64 * (mirror ? -1 : 1), 40)
    fg.addColorStop(0, '#eadbb5')
    fg.addColorStop(0.7, '#d2bf92')
    fg.addColorStop(1, '#a68f5f')
    w.fillStyle = fg
    w.fill()
    w.strokeStyle = 'rgba(252,246,224,0.75)'
    w.lineWidth = 1.5
    w.stroke()
    // veins and the darker cross-band
    w.save()
    wingPath(w, fore, mirror)
    w.clip()
    w.strokeStyle = 'rgba(96,78,44,0.28)'
    w.lineWidth = 1
    for (let i = 0; i < 6; i++) {
      w.beginPath()
      w.moveTo(mirror ? S - (c + 4) : c + 4, 66)
      w.lineTo(mirror ? S - (c + 40 + i * 5) : c + 40 + i * 5, 34 + i * 7)
      w.stroke()
    }
    w.strokeStyle = 'rgba(84,66,36,0.42)'
    w.lineWidth = 3
    w.beginPath()
    w.moveTo(mirror ? S - (c + 30) : c + 30, 36)
    w.quadraticCurveTo(mirror ? S - (c + 26) : c + 26, 56, mirror ? S - (c + 34) : c + 34, 76)
    w.stroke()
    // an eye-spot near the tip
    w.fillStyle = 'rgba(60,46,26,0.55)'
    w.beginPath()
    w.arc(mirror ? S - (c + 50) : c + 50, 46, 3.2, 0, Math.PI * 2)
    w.fill()
    w.fillStyle = 'rgba(250,240,210,0.7)'
    w.beginPath()
    w.arc(mirror ? S - (c + 49) : c + 49, 45, 1.1, 0, Math.PI * 2)
    w.fill()
    w.restore()
  }
  const wings = new CanvasTexture(w.canvas)
  wings.colorSpace = SRGBColorSpace
  wings.anisotropy = 4
  wings.needsUpdate = true

  const b = makeCanvas(64, 64)
  // abdomen: a tapering, furry teardrop
  const ag = b.createLinearGradient(32, 26, 32, 60)
  ag.addColorStop(0, '#a99163')
  ag.addColorStop(1, '#7d6a44')
  b.fillStyle = ag
  b.beginPath()
  b.moveTo(32, 26)
  b.quadraticCurveTo(43, 38, 33, 60)
  b.lineTo(31, 60)
  b.quadraticCurveTo(21, 38, 32, 26)
  b.fill()
  // banding
  b.strokeStyle = 'rgba(70,56,32,0.35)'
  b.lineWidth = 1
  for (let y = 36; y < 58; y += 5) {
    b.beginPath()
    b.moveTo(26 + (y - 36) * 0.15, y)
    b.lineTo(38 - (y - 36) * 0.15, y)
    b.stroke()
  }
  // thorax and head
  b.fillStyle = '#b39a6a'
  b.beginPath()
  b.ellipse(32, 26, 7, 8, 0, 0, Math.PI * 2)
  b.fill()
  b.fillStyle = '#5f5030'
  b.beginPath()
  b.arc(32, 16.5, 3.8, 0, Math.PI * 2)
  b.fill()
  b.fillStyle = 'rgba(20,14,6,0.8)'
  b.beginPath()
  b.arc(30, 15.5, 1.1, 0, Math.PI * 2)
  b.arc(34, 15.5, 1.1, 0, Math.PI * 2)
  b.fill()
  // feathery antennae
  b.strokeStyle = '#54462a'
  b.lineWidth = 1
  for (const sgn of [-1, 1]) {
    b.beginPath()
    b.moveTo(32 + sgn * 2, 13.5)
    b.quadraticCurveTo(32 + sgn * 8, 5, 32 + sgn * 15, 3)
    b.stroke()
    b.lineWidth = 0.6
    for (let i = 1; i <= 6; i++) {
      const t = i / 7
      const x = 32 + sgn * (2 + 13 * t)
      const y = 13.5 - 10.5 * t + 4 * t * (1 - t) * -1
      b.beginPath()
      b.moveTo(x, y)
      b.lineTo(x + sgn * 1.2, y - 2.2)
      b.stroke()
    }
    b.lineWidth = 1
  }
  const body = new CanvasTexture(b.canvas)
  body.colorSpace = SRGBColorSpace
  body.anisotropy = 4
  body.needsUpdate = true
  return {
    wings,
    body,
    dispose: () => {
      wings.dispose()
      body.dispose()
    },
  }
}
