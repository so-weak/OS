import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  Euler,
  ExtrudeGeometry,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  NoColorSpace,
  Quaternion,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type ColorRepresentation,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { makeCanvas, mulberry } from '../textures'
import {
  fbmField,
  fieldCanvas,
  mix,
  normalizeField,
  pbrFromFields,
} from './noise'

/* =====================================================================
   Electronics toolkit: the geometry and texture helpers behind the CRT,
   the keyboard, the mouse, the tower and the desk clutter.

   The recipe for every beige box in this room:
     1. build parts from real profiles (lofted rounded rectangles, lathes,
        extrusions) instead of boxes;
     2. `part()` each one: weld, crease-smooth the normals, project a
        world-scale UV and bake a vertex colour;
     3. `mergeParts()` everything that shares a material into ONE mesh.
   A whole monitor is a single draw call that still carries slots, screws,
   seams and a yellowing gradient. Units are metres, deterministic.
   ===================================================================== */

export type V3 = [number, number, number]

/* ---------------------------------------------------------------------
   Parts: normalise any geometry so it can merge with any other
   --------------------------------------------------------------------- */

const _m = new Matrix4()
const _q = new Quaternion()
const _e = new Euler()
const _p = new Vector3()
const _s = new Vector3()
const _c = new Color()

export interface PartOpts {
  pos?: V3
  rot?: V3
  scale?: number | V3
  /** baked vertex colour (sRGB hex); multiplies the material colour */
  color?: ColorRepresentation
  /** crease angle for normal smoothing (radians); false keeps the source normals as flat faces */
  crease?: number | false
  /** planar-UV tile size in metres (default 0.05); 0 = no texture detail (constant UV) */
  tile?: number
}

/** World-scale planar UVs, chosen per triangle by its dominant axis. Plastic
    grain is noise, so the seams between projections are invisible, and one
    256 px tile can serve every part at a believable physical size. */
export function planarUV(g: BufferGeometry, tile: number): void {
  const pos = g.attributes.position
  const n = pos.count
  const uv = new Float32Array(n * 2)
  for (let i = 0; i + 2 < n; i += 3) {
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i)
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1)
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2)
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = Math.abs(uy * vz - uz * vy)
    const ny = Math.abs(uz * vx - ux * vz)
    const nz = Math.abs(ux * vy - uy * vx)
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k), y = pos.getY(i + k), z = pos.getZ(i + k)
      let u: number, v: number
      if (nx >= ny && nx >= nz) { u = z; v = y }
      else if (ny >= nz) { u = x; v = z }
      else { u = x; v = y }
      uv[(i + k) * 2] = u / tile
      uv[(i + k) * 2 + 1] = v / tile
    }
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2))
}

/** Bake one colour into every vertex (linear, as three expects). */
export function paintGeo(g: BufferGeometry, color: ColorRepresentation): BufferGeometry {
  _c.set(color)
  const n = g.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    a[i * 3] = _c.r
    a[i * 3 + 1] = _c.g
    a[i * 3 + 2] = _c.b
  }
  g.setAttribute('color', new BufferAttribute(a, 3))
  return g
}

/** three's BufferGeometryUtils.toCreasedNormals, same maths and same
    output bit for bit, without its per-vertex string keys and Vector3
    allocations — every part() of every prop goes through it on first load.
    Positions share a normal pool when they fall in the same 1 cm cell
    (three's hash); face normals meeting within `creaseAngle` average. */
export function toCreasedNormals(geometry: BufferGeometry, creaseAngle = Math.PI / 3): BufferGeometry {
  const creaseDot = Math.cos(creaseAngle)
  const k = (1 + 1e-10) * 1e2
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  const pos = g.attributes.position
  const count = pos.count
  const faces = count / 3
  // face normals, exactly as crossVectors(c - b, a - b).normalize()
  const fn = new Float64Array(faces * 3)
  const keyOf = new Float64Array(count)
  const cell = new Map<number, number[]>()
  for (let f = 0; f < faces; f++) {
    const i = f * 3
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i)
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1)
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2)
    const ux = cx - bx, uy = cy - by, uz = cz - bz
    const vx = ax - bx, vy = ay - by, vz = az - bz
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const s = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1)
    nx *= s
    ny *= s
    nz *= s
    fn[f * 3] = nx
    fn[f * 3 + 1] = ny
    fn[f * 3 + 2] = nz
    for (let n = 0; n < 3; n++) {
      // three: `${~~(x*k)},${~~(y*k)},${~~(z*k)}` — the same cell, as a number
      const qx = ~~(pos.getX(i + n) * k)
      const qy = ~~(pos.getY(i + n) * k)
      const qz = ~~(pos.getZ(i + n) * k)
      const key = ((qx + 0x8000) * 0x10000 + (qy + 0x8000)) * 0x10000 + (qz + 0x8000)
      keyOf[i + n] = key
      const list = cell.get(key)
      if (list) list.push(f)
      else cell.set(key, [f])
    }
  }
  const out = new Float32Array(count * 3)
  for (let f = 0; f < faces; f++) {
    const tx = fn[f * 3], ty = fn[f * 3 + 1], tz = fn[f * 3 + 2]
    for (let n = 0; n < 3; n++) {
      const v = f * 3 + n
      const others = cell.get(keyOf[v])!
      let sx = 0, sy = 0, sz = 0
      for (let j = 0; j < others.length; j++) {
        const o = others[j] * 3
        const ox = fn[o], oy = fn[o + 1], oz = fn[o + 2]
        if (tx * ox + ty * oy + tz * oz > creaseDot) {
          sx += ox
          sy += oy
          sz += oz
        }
      }
      const s = 1 / (Math.sqrt(sx * sx + sy * sy + sz * sz) || 1)
      out[v * 3] = sx * s
      out[v * 3 + 1] = sy * s
      out[v * 3 + 2] = sz * s
    }
  }
  g.setAttribute('normal', new BufferAttribute(out, 3, false))
  return g
}

/** Copy of `src` as a non-indexed {position, normal, uv, color} geometry. */
export function part(src: BufferGeometry, o: PartOpts = {}): BufferGeometry {
  let g = src.index ? src.toNonIndexed() : src.clone()
  const keep = o.crease === false ? ['position', 'normal'] : ['position']
  for (const k of Object.keys(g.attributes)) {
    if (!keep.includes(k)) g.deleteAttribute(k)
  }
  if (o.pos || o.rot || o.scale !== undefined) {
    const s = o.scale ?? 1
    _e.set(...(o.rot ?? [0, 0, 0]))
    _q.setFromEuler(_e)
    _p.set(...(o.pos ?? [0, 0, 0]))
    if (typeof s === 'number') _s.set(s, s, s)
    else _s.set(...s)
    _m.compose(_p, _q, _s)
    g.applyMatrix4(_m)
  }
  if (o.crease !== false) g = toCreasedNormals(g, o.crease ?? 0.9)
  if (o.tile === 0) g.setAttribute('uv', new BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
  else planarUV(g, o.tile ?? 0.05)
  paintGeo(g, o.color ?? '#ffffff')
  return g
}

/** Weld same-material parts into ONE geometry (one draw call). */
export function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error('mergeParts: incompatible attributes')
  merged.computeBoundingSphere()
  merged.computeBoundingBox()
  return merged
}

/** Flip triangle winding, if needed, so most faces point away from (cx, cy, cz).
    For open surface patches whose 'outward' cannot be read off a ring. */
export function orientOutward(g: BufferGeometry, cx: number, cy: number, cz: number): BufferGeometry {
  const idx = g.index
  const pos = g.attributes.position
  const n = idx ? idx.count : pos.count
  const at = (k: number) => (idx ? idx.getX(k) : k)
  let vote = 0
  for (let k = 0; k + 2 < n; k += 3) {
    const a = at(k), b = at(k + 1), c = at(k + 2)
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a)
    const ux = pos.getX(b) - ax, uy = pos.getY(b) - ay, uz = pos.getZ(b) - az
    const vx = pos.getX(c) - ax, vy = pos.getY(c) - ay, vz = pos.getZ(c) - az
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const mx = (ax + pos.getX(b) + pos.getX(c)) / 3 - cx
    const my = (ay + pos.getY(b) + pos.getY(c)) / 3 - cy
    const mz = (az + pos.getZ(b) + pos.getZ(c)) / 3 - cz
    vote += Math.sign(nx * mx + ny * my + nz * mz)
  }
  if (vote < 0) {
    if (idx) {
      for (let k = 0; k + 2 < n; k += 3) {
        const t = idx.getY(k) // swap 2nd and 3rd of every triangle
        idx.setY(k, idx.getZ(k))
        idx.setZ(k, t)
      }
      idx.needsUpdate = true
    } else {
      for (let k = 0; k + 2 < n; k += 3) {
        for (let c = 0; c < 3; c++) {
          const t = pos.getComponent(k + 1, c)
          pos.setComponent(k + 1, c, pos.getComponent(k + 2, c))
          pos.setComponent(k + 2, c, t)
        }
      }
      pos.needsUpdate = true
    }
  }
  return g
}

/** Recolour a geometry through a function of its vertex position. */
export function tintGeo(
  g: BufferGeometry,
  fn: (x: number, y: number, z: number, out: Color) => void,
): BufferGeometry {
  const pos = g.attributes.position
  const col = g.attributes.color as BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    _c.setRGB(col.getX(i), col.getY(i), col.getZ(i))
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), _c)
    col.setXYZ(i, _c.r, _c.g, _c.b)
  }
  col.needsUpdate = true
  return g
}

/** Smooth 3D value noise in 0..1 (for gradients and mottling on vertices). */
export function noise3(x: number, y: number, z: number, seed = 1): number {
  const hash = (a: number, b: number, c: number) => {
    let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647) ^ Math.imul(seed, 1274126177)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const fx = x - xi, fy = y - yi, fz = z - zi
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  return l(
    l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), sx), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), sx), sy),
    l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), sx), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), sx), sy),
    sz,
  )
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/* ---------------------------------------------------------------------
   Rounded-rectangle rings and lofts
   --------------------------------------------------------------------- */

/** How a rounded rectangle is sampled. Every ring built with the SAME spec
    has the same point count, so rings of any size can be lofted together. */
export interface RingSpec {
  /** segments per 90 degree corner arc */
  arc: number
  /** segments along the right, top, left and bottom straight edges */
  nR: number
  nT: number
  nL: number
  nB: number
}

export function ringSize(s: RingSpec): number {
  return 4 * (s.arc + 1) + (s.nR - 1) + (s.nT - 1) + (s.nL - 1) + (s.nB - 1)
}

/** Points of a rounded rectangle, counter-clockwise from the bottom-right
    arc (x right, y up). Index i means the same place on every ring. */
export function rrectPts(hw: number, hh: number, r: number, s: RingSpec): [number, number][] {
  const rr = Math.max(1e-5, Math.min(r, hw - 1e-5, hh - 1e-5))
  const out: [number, number][] = []
  const corners: [number, number, number, number][] = [
    [hw - rr, -(hh - rr), -Math.PI / 2, s.nR],
    [hw - rr, hh - rr, 0, s.nT],
    [-(hw - rr), hh - rr, Math.PI / 2, s.nL],
    [-(hw - rr), -(hh - rr), Math.PI, s.nB],
  ]
  corners.forEach(([cx, cy, a0, edgeSeg], ci) => {
    for (let k = 0; k <= s.arc; k++) {
      const a = a0 + (k / s.arc) * (Math.PI / 2)
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr])
    }
    // the straight edge that follows this arc
    const [nx, ny] = corners[(ci + 1) % 4]
    const ex = nx + Math.cos(corners[(ci + 1) % 4][2]) * rr
    const ey = ny + Math.sin(corners[(ci + 1) % 4][2]) * rr
    const sx = cx + Math.cos(a0 + Math.PI / 2) * rr
    const sy = cy + Math.sin(a0 + Math.PI / 2) * rr
    for (let k = 1; k < edgeSeg; k++) {
      const t = k / edgeSeg
      out.push([sx + (ex - sx) * t, sy + (ey - sy) * t])
    }
  })
  return out
}

/** Lofted surface through same-length rings (each ring = array of xyz).
    `orient` 'outward' makes triangles face away from each ring's centroid;
    a vector makes them face that way (flat frames). Indexed, welded around
    the ring. Does not close the ends. */
export function loftRings(
  rings: V3[][],
  orient: 'outward' | 'inward' | V3 = 'outward',
  closed = true,
): BufferGeometry {
  const K = rings.length
  const N = rings[0].length
  const pos = new Float32Array(K * N * 3)
  rings.forEach((r, k) =>
    r.forEach((p, i) => {
      pos[(k * N + i) * 3] = p[0]
      pos[(k * N + i) * 3 + 1] = p[1]
      pos[(k * N + i) * 3 + 2] = p[2]
    }),
  )
  const idx: number[] = []
  const M = closed ? N : N - 1
  for (let k = 0; k < K - 1; k++) {
    for (let i = 0; i < M; i++) {
      const a = k * N + i
      const b = k * N + ((i + 1) % N)
      const c = (k + 1) * N + i
      const d = (k + 1) * N + ((i + 1) % N)
      idx.push(a, b, c, b, d, c)
    }
  }
  // decide winding from a sample face
  const ax = pos[idx[0] * 3], ay = pos[idx[0] * 3 + 1], az = pos[idx[0] * 3 + 2]
  const bx = pos[idx[1] * 3], by = pos[idx[1] * 3 + 1], bz = pos[idx[1] * 3 + 2]
  const cx = pos[idx[2] * 3], cy = pos[idx[2] * 3 + 1], cz = pos[idx[2] * 3 + 2]
  const ux = bx - ax, uy = by - ay, uz = bz - az
  const vx = cx - ax, vy = cy - ay, vz = cz - az
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  let dot: number
  if (orient === 'outward' || orient === 'inward') {
    let mx = 0, my = 0, mz = 0
    for (const p of rings[0]) { mx += p[0]; my += p[1]; mz += p[2] }
    mx /= N; my /= N; mz /= N
    dot = nx * (ax - mx) + ny * (ay - my) + nz * (az - mz)
    if (orient === 'inward') dot = -dot
  } else {
    dot = nx * orient[0] + ny * orient[1] + nz * orient[2]
  }
  if (dot < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1]
      idx[i + 1] = idx[i + 2]
      idx[i + 2] = t
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}

/** Planar cap over a ring: a fan from the centroid, facing `facing`. */
export function capFan(ring: V3[], facing: V3): BufferGeometry {
  const N = ring.length
  let mx = 0, my = 0, mz = 0
  for (const p of ring) { mx += p[0]; my += p[1]; mz += p[2] }
  const pos = new Float32Array((N + 1) * 3)
  ring.forEach((p, i) => pos.set(p, i * 3))
  pos.set([mx / N, my / N, mz / N], N * 3)
  const idx: number[] = []
  for (let i = 0; i < N; i++) idx.push(i, (i + 1) % N, N)
  const ux = pos[3] - pos[0], uy = pos[4] - pos[1], uz = pos[5] - pos[2]
  const vx = pos[N * 3] - pos[0], vy = pos[N * 3 + 1] - pos[1], vz = pos[N * 3 + 2] - pos[2]
  const dot =
    (uy * vz - uz * vy) * facing[0] + (uz * vx - ux * vz) * facing[1] + (ux * vy - uy * vx) * facing[2]
  if (dot < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}

/** Rounded-rectangle slab from an extruded, bevelled plan outline: a
    cushion-edged pad, faceplate or lid. Extends along +z by `depth`
    with its centre at the origin, edges rounded by `bevel`. */
export function roundedSlab(
  w: number,
  h: number,
  depth: number,
  corner: number,
  bevel: number,
  bevelSeg = 3,
  hole?: { w: number; h: number; corner: number; x?: number; y?: number },
): BufferGeometry {
  const rr = (hw: number, hh: number, r: number, cx = 0, cy = 0, path: Shape | import('three').Path) => {
    r = Math.min(r, hw - 1e-4, hh - 1e-4)
    path.moveTo(cx - hw + r, cy - hh)
    path.lineTo(cx + hw - r, cy - hh)
    path.absarc(cx + hw - r, cy - hh + r, r, -Math.PI / 2, 0, false)
    path.lineTo(cx + hw, cy + hh - r)
    path.absarc(cx + hw - r, cy + hh - r, r, 0, Math.PI / 2, false)
    path.lineTo(cx - hw + r, cy + hh)
    path.absarc(cx - hw + r, cy + hh - r, r, Math.PI / 2, Math.PI, false)
    path.lineTo(cx - hw, cy - hh + r)
    path.absarc(cx - hw + r, cy - hh + r, r, Math.PI, Math.PI * 1.5, false)
  }
  const shape = new Shape()
  const b = Math.min(bevel, depth * 0.5 - 1e-5, w * 0.3, h * 0.3)
  rr(w / 2 - b, h / 2 - b, Math.max(corner - b, 1e-4), 0, 0, shape)
  if (hole) {
    const hp = new Shape()
    rr(hole.w / 2 + b, hole.h / 2 + b, hole.corner + b, hole.x ?? 0, hole.y ?? 0, hp)
    shape.holes.push(hp)
  }
  // tessellate by size: a 3 mm corner needs two segments, a 3 cm one needs six
  const curveSegments = Math.max(1, Math.min(6, Math.round(corner / 0.0025)))
  const g = new ExtrudeGeometry(shape, {
    depth: depth - 2 * b,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: b < 0.0007 ? 1 : bevelSeg,
    curveSegments,
  })
  g.translate(0, 0, -(depth - 2 * b) / 2)
  return g
}

/** Lathe from a (radius, height) profile, bottom to top. */
export function lathe(profile: [number, number][], seg = 28): BufferGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), seg)
}

/** Gear-toothed disc for knurled knobs: `teeth` ridges, extruded along +z. */
export function knurlGeometry(radius: number, height: number, teeth = 24, depth = 0.0004): BufferGeometry {
  const s = new Shape()
  const n = teeth * 4
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    // ridge profile: flat top, steep flank
    const ph = i % 4
    const r = ph === 0 || ph === 1 ? radius : radius - depth
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  s.closePath()
  return new ExtrudeGeometry(s, { depth: height, bevelEnabled: false, curveSegments: 1 })
}

/** A small screw head: dome plus a dark cross slot. Axis +z. */
export function screwHead(r: number, dark = '#2b2a27', light = '#8b8a86'): BufferGeometry {
  const head = lathe(
    [
      [0.0001, 0],
      [r, 0],
      [r * 0.98, r * 0.18],
      [r * 0.8, r * 0.42],
      [r * 0.3, r * 0.5],
      [0.0001, r * 0.52],
    ],
    12,
  )
  head.rotateX(Math.PI / 2)
  const slotShape = new Shape()
  slotShape.moveTo(-r * 0.66, -r * 0.09)
  slotShape.lineTo(r * 0.66, -r * 0.09)
  slotShape.lineTo(r * 0.66, r * 0.09)
  slotShape.lineTo(-r * 0.66, r * 0.09)
  slotShape.closePath()
  const slotA = new ExtrudeGeometry(slotShape, { depth: r * 0.06, bevelEnabled: false })
  slotA.translate(0, 0, r * 0.47)
  const slotB = slotA.clone()
  slotB.rotateZ(Math.PI / 2)
  return mergeParts([
    part(head, { color: light, tile: 0 }),
    part(slotA, { color: dark, tile: 0, crease: false }),
    part(slotB, { color: dark, tile: 0, crease: false }),
  ])
}

/* ---------------------------------------------------------------------
   Material maps
   --------------------------------------------------------------------- */

export interface SurfaceSet {
  normalMap: CanvasTexture
  roughnessMap: CanvasTexture
  map?: CanvasTexture
  normalScale: [number, number]
  dispose: () => void
}

/** Injection-moulded ABS: a fine orange-peel stipple over a barely-there mould
    swirl, plus a few hairline scratches. Deliberately gentle: real ABS is
    nearly smooth to the eye and only shows its grain in raking light.
    UVs from part() are metric (tile 0.05), so repeat stays 1.
    `strength` is the material's normalScale, 0..1. */
export function plasticSet(seed = 7, size = 256, strength = 0.7): SurfaceSet {
  const fine = fbmField(size, seed, { octaves: 3, freq: 96, persistence: 0.5 })
  const mid = fbmField(size, seed + 1, { octaves: 2, freq: 10, persistence: 0.5 })
  const h = mix(fine, mid, 0.1)
  const rand = mulberry(seed + 9)
  for (let i = 0; i < size * 0.25; i++) {
    let x = rand() * size
    let y = rand() * size
    const a = 0.3 + (rand() - 0.5) * 0.6
    const len = 10 + rand() * 34
    const depth = 0.03 + rand() * 0.12
    for (let k = 0; k < len; k++) {
      const px = Math.floor(x + size) % size
      const py = Math.floor(y + size) % size
      h[py * size + px] -= depth
      x += Math.cos(a)
      y += Math.sin(a)
    }
  }
  normalizeField(h)
  const rough = fbmField(size, seed + 2, { octaves: 3, freq: 8, persistence: 0.6 })
  const pm = pbrFromFields(h, rough, size, { strength: 0.055, repeat: 1, roughLo: 0.86, roughHi: 1.0 })
  pm.heightMap.dispose()
  return {
    normalMap: pm.normalMap,
    roughnessMap: pm.roughnessMap,
    normalScale: [strength, strength],
    dispose: pm.dispose,
  }
}

let sharedPlasticSet: SurfaceSet | null = null

/** One plastic grain for every beige part in the room (monitor, keyboard,
    tower, mouse, desk props): the texture is generated once and lives for
    the session, like the halo falloff. Set the strength per material with
    `normalScale`. */
export function sharedPlastic(): SurfaceSet {
  if (!sharedPlasticSet) {
    const p = plasticSet(7, 256, 1)
    sharedPlasticSet = { ...p, dispose: () => undefined }
  }
  return sharedPlasticSet
}

/** Fine matte texture for keycaps: PBT-like sandpaper grain, and a worn
    shiny thumb-print in the middle of every cap (UV 0..1 = the cap top). */
export function keycapSet(seed = 11, size = 256, strength = 0.35): SurfaceSet {
  const grain = fbmField(size, seed, { octaves: 3, freq: 64, persistence: 0.6 })
  const soft = fbmField(size, seed + 1, { octaves: 3, freq: 5, persistence: 0.5 })
  const h = mix(grain, soft, 0.15)
  normalizeField(h)
  // wear: rougher rim, polished centre (roughness grows with distance from the middle)
  const rough = new Float32Array(size * size)
  const n2 = fbmField(size, seed + 2, { octaves: 4, freq: 6, persistence: 0.6 })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x / size - 0.5) * 2
      const dy = (y / size - 0.5) * 2
      const d = Math.min(1, Math.hypot(dx * 0.9, dy * 0.9))
      const wear = 1 - smooth(0.15, 0.7, d)
      rough[y * size + x] = clamp01(0.85 - wear * (0.5 + 0.3 * n2[y * size + x]) + (n2[y * size + x] - 0.5) * 0.2)
    }
  }
  const pm = pbrFromFields(h, rough, size, { strength: 0.9, repeat: 1, roughLo: 0.0, roughHi: 1.0 })
  // pbrFromFields data() wraps with repeat; caps must clamp so the wear blob does not tile
  pm.heightMap.dispose()
  // the wear blob must not tile across a 9u spacebar: clamp it to one centred patch
  pm.roughnessMap.wrapS = pm.roughnessMap.wrapT = ClampToEdgeWrapping
  pm.roughnessMap.needsUpdate = true
  return {
    normalMap: pm.normalMap,
    roughnessMap: pm.roughnessMap,
    normalScale: [strength, strength],
    dispose: pm.dispose,
  }
}

/** Faint albedo mottling for large plastic parts (sun-fade, hand oils). */
export function mottleMap(seed = 21, size = 256, base = '#ffffff'): CanvasTexture {
  const ctx = makeCanvas(size, size)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  const f = fbmField(size, seed, { octaves: 4, freq: 4, persistence: 0.55 })
  const g = fbmField(size, seed + 1, { octaves: 3, freq: 30, persistence: 0.5 })
  const img = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < f.length; i++) {
    const v = 0.955 + f[i] * 0.06 + (g[i] - 0.5) * 0.02
    const j = i * 4
    img.data[j] = Math.min(255, img.data[j] * v)
    img.data[j + 1] = Math.min(255, img.data[j + 1] * v * 0.995)
    img.data[j + 2] = Math.min(255, img.data[j + 2] * v * 0.985)
  }
  ctx.putImageData(img, 0, 0)
  return surfaceTex(ctx, true)
}

/** Roughness for the tube glass: a clean 0.06 nearly everywhere (glass is
    sharp) with soft, sparse patches where dust and fingerprints smear the
    reflection up to ~0.4. Multiplies material roughness = 1. */
export function smudgeMap(seed = 4, size = 128): CanvasTexture {
  const f = fbmField(size, seed, { octaves: 4, freq: 3, persistence: 0.6 })
  const g = new Float32Array(f.length)
  for (let i = 0; i < f.length; i++) g[i] = 0.06 + 0.34 * smooth(0.56, 0.85, f[i])
  const t = new CanvasTexture(fieldCanvas(g, size, 0, 1))
  t.colorSpace = NoColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.minFilter = LinearMipmapLinearFilter
  t.magFilter = LinearFilter
  t.needsUpdate = true
  return t
}

/** Mipmapped, anisotropic, repeat-wrapped canvas texture. */
export function surfaceTex(ctx: CanvasRenderingContext2D, srgb = true, aniso = 8): CanvasTexture {
  const t = new CanvasTexture(ctx.canvas)
  if (srgb) t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.minFilter = LinearMipmapLinearFilter
  t.magFilter = LinearFilter
  t.anisotropy = aniso
  t.needsUpdate = true
  return t
}

/** Clamped (non-repeating) mipmapped canvas texture: labels and decals. */
export function decalTex(ctx: CanvasRenderingContext2D, aniso = 8): CanvasTexture {
  const t = new CanvasTexture(ctx.canvas)
  t.colorSpace = SRGBColorSpace
  t.minFilter = LinearMipmapLinearFilter
  t.magFilter = LinearFilter
  t.anisotropy = aniso
  t.needsUpdate = true
  return t
}

/** Sans text with real letter-spacing, drawn onto an existing context. */
export function drawSpaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  spacing = 0,
  align: 'left' | 'center' | 'right' = 'left',
): void {
  ctx.font = font
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  const chars = [...text]
  const widths = chars.map((c) => ctx.measureText(c).width + spacing)
  const total = widths.reduce((a, b) => a + b, 0) - spacing
  let cx = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total
  ctx.textAlign = 'left'
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y)
    cx += widths[i]
  })
}

/** A printed badge / sticker as a clamped texture. `draw` paints a w×h canvas. */
export function makeDecal(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const ctx = makeCanvas(w, h)
  draw(ctx, w, h)
  return decalTex(ctx)
}

/** Deterministic rng re-export so components need one import. */
export { mulberry }
