import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  NoColorSpace,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type ColorRepresentation,
} from 'three'
import { useEffect, useState } from 'react'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import {
  disposeSurface,
  makeCanvas,
  makeWoodMaps,
  mulberry,
  type SurfaceMaps,
} from '../textures'
import {
  fabricMaps,
  fbmField,
  normalizeField,
  pbrFromFields,
  type PbrMaps,
} from './noise'

/* =====================================================================
   Furniture toolkit — the geometry and texture helpers behind the chair,
   lamp, desk, drawers, mug, cables, bin and paperwork.

   The point of this file: nothing in a real room is a box. Everything
   here is built to let a few dozen small, honest parts merge into a
   handful of draw calls:

     at()        place a geometry (position, euler, scale) — chainable
     tint()      bake a vertex colour so one material can paint many parts
     mergeParts  weld same-material parts into ONE mesh (one draw call)
     lathe()     surface of revolution with real hard/soft edge control
     sweep()     a tube/leg/handle along a path, any superellipse section
     slab()      pillowy rounded slab: seat cushions, drawer fronts, pads
     deform()    bend/dish/bulge a geometry and keep its normals right
     crumple()   a noise-displaced wad of paper

   Everything is deterministic (seeded) so StrictMode double-renders and
   HMR rebuild identical parts. All units are metres.
   ===================================================================== */

/* ---------------------------------------------------------------------
   Placing, colouring, merging
   --------------------------------------------------------------------- */

const _m = new Matrix4()
const _q = new Quaternion()
const _e = new Euler()
const _p = new Vector3()
const _s = new Vector3()

/** Transform a geometry in place: position, XYZ euler, uniform/xyz scale.
    Returns it, so parts read as `at(lathe(...), 0, 0.1, 0)`. */
export function at(
  geo: BufferGeometry,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  scale: number | [number, number, number] = 1,
): BufferGeometry {
  _e.set(rx, ry, rz)
  _q.setFromEuler(_e)
  if (typeof scale === 'number') _s.set(scale, scale, scale)
  else _s.set(scale[0], scale[1], scale[2])
  _m.compose(_p.set(x, y, z), _q, _s)
  geo.applyMatrix4(_m)
  return geo
}

/** Rotate a geometry about a pivot point (euler XYZ). */
export function pivot(
  geo: BufferGeometry,
  cx: number,
  cy: number,
  cz: number,
  rx = 0,
  ry = 0,
  rz = 0,
): BufferGeometry {
  geo.translate(-cx, -cy, -cz)
  _e.set(rx, ry, rz)
  geo.applyQuaternion(_q.setFromEuler(_e))
  geo.translate(cx, cy, cz)
  return geo
}

/** Bake one flat vertex colour (sRGB hex in, linear in the buffer). */
export function tint(
  geo: BufferGeometry,
  color: ColorRepresentation,
): BufferGeometry {
  const c = new Color(color)
  const n = geo.getAttribute('position').count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r
    a[i * 3 + 1] = c.g
    a[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new BufferAttribute(a, 3))
  return geo
}

/** Bake vertex colours from a function of position/normal. `out` arrives
    holding the current colour (white if none) and is written back. */
export function paint(
  geo: BufferGeometry,
  fn: (p: Vector3, n: Vector3, out: Color) => void,
): BufferGeometry {
  const pos = geo.getAttribute('position')
  const nor = geo.getAttribute('normal')
  const n = pos.count
  const col = geo.getAttribute('color') as BufferAttribute | undefined
  const a = col ? (col.array as Float32Array) : new Float32Array(n * 3).fill(1)
  const p = new Vector3()
  const nn = new Vector3()
  const c = new Color()
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i)
    nn.fromBufferAttribute(nor, i)
    c.setRGB(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])
    fn(p, nn, c)
    a[i * 3] = c.r
    a[i * 3 + 1] = c.g
    a[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new BufferAttribute(a, 3))
  return geo
}

/** Weld same-material parts into one geometry (one draw call). Parts are
    reduced to position/normal/uv (+ colour when `colored`), de-indexed,
    merged, and the sources disposed. */
export function mergeParts(
  parts: BufferGeometry[],
  colored = false,
): BufferGeometry {
  const clean = parts.map((g) => {
    const src = g.index ? g.toNonIndexed() : g
    const count = src.getAttribute('position').count
    const out = new BufferGeometry()
    out.setAttribute('position', src.getAttribute('position').clone())
    out.setAttribute('normal', src.getAttribute('normal').clone())
    const uv = src.getAttribute('uv')
    out.setAttribute(
      'uv',
      uv
        ? uv.clone()
        : new Float32BufferAttribute(new Float32Array(count * 2), 2),
    )
    if (colored) {
      const col = src.getAttribute('color')
      out.setAttribute(
        'color',
        col
          ? col.clone()
          : new Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3),
      )
    }
    if (src !== g) src.dispose()
    return out
  })
  const merged = mergeGeometries(clean, false)
  clean.forEach((g) => g.dispose())
  parts.forEach((g) => g.dispose())
  if (!merged) throw new Error('mergeParts: attribute mismatch')
  merged.computeBoundingSphere()
  merged.computeBoundingBox()
  return merged
}

/** Flip triangle winding when the majority of faces disagree with the
    stored vertex normals (lets builders ignore handedness worries). */
function fixWinding(geo: BufferGeometry): void {
  const pos = geo.getAttribute('position')
  const nor = geo.getAttribute('normal')
  const idx = geo.index
  if (!idx) return
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const n = new Vector3()
  let agree = 0
  let total = 0
  const step = Math.max(1, Math.floor(idx.count / 3 / 400))
  for (let t = 0; t < idx.count; t += 3 * step) {
    a.fromBufferAttribute(pos, idx.getX(t))
    b.fromBufferAttribute(pos, idx.getX(t + 1))
    c.fromBufferAttribute(pos, idx.getX(t + 2))
    const fn = b.sub(a).cross(c.sub(a))
    if (fn.lengthSq() < 1e-14) continue
    n.fromBufferAttribute(nor, idx.getX(t))
    n.add(new Vector3().fromBufferAttribute(nor, idx.getX(t + 1)))
    n.add(new Vector3().fromBufferAttribute(nor, idx.getX(t + 2)))
    total++
    if (fn.dot(n) > 0) agree++
  }
  if (total > 0 && agree < total / 2) {
    for (let t = 0; t < idx.count; t += 3) {
      const i1 = idx.getX(t + 1)
      idx.setX(t + 1, idx.getX(t + 2))
      idx.setX(t + 2, i1)
    }
    idx.needsUpdate = true
  }
}

/* ---------------------------------------------------------------------
   Deformation that keeps normals honest
   --------------------------------------------------------------------- */

/** Bend/dish/bulge a geometry. `fn` mutates the point it is handed. The
    normals are pushed through the deformation's Jacobian (finite
    differences), so a dished cushion is lit like a dished cushion. */
export function deform(
  geo: BufferGeometry,
  fn: (p: Vector3) => void,
): BufferGeometry {
  const pos = geo.getAttribute('position')
  const nor = geo.getAttribute('normal')
  const eps = 4e-4
  const p0 = new Vector3()
  const q0 = new Vector3()
  const c1 = new Vector3()
  const c2 = new Vector3()
  const c3 = new Vector3()
  const t = new Vector3()
  const n = new Vector3()
  const nn = new Vector3()
  const sample = (x: number, y: number, z: number, out: Vector3): Vector3 => {
    out.set(x, y, z)
    fn(out)
    return out
  }
  for (let i = 0; i < pos.count; i++) {
    p0.fromBufferAttribute(pos, i)
    sample(p0.x, p0.y, p0.z, q0)
    sample(p0.x + eps, p0.y, p0.z, c1)
      .sub(q0)
      .divideScalar(eps)
    sample(p0.x, p0.y + eps, p0.z, c2)
      .sub(q0)
      .divideScalar(eps)
    sample(p0.x, p0.y, p0.z + eps, c3)
      .sub(q0)
      .divideScalar(eps)
    n.fromBufferAttribute(nor, i)
    // n' ∝ J^-T n  =  nx (c2×c3) + ny (c3×c1) + nz (c1×c2)
    nn.set(0, 0, 0)
    nn.addScaledVector(t.crossVectors(c2, c3), n.x)
    nn.addScaledVector(t.crossVectors(c3, c1), n.y)
    nn.addScaledVector(t.crossVectors(c1, c2), n.z)
    if (nn.lengthSq() < 1e-12) nn.copy(n)
    nn.normalize()
    pos.setXYZ(i, q0.x, q0.y, q0.z)
    nor.setXYZ(i, nn.x, nn.y, nn.z)
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  geo.computeBoundingSphere()
  geo.computeBoundingBox()
  return geo
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/* ---------------------------------------------------------------------
   lathe — surface of revolution about Y with hard/soft edges
   --------------------------------------------------------------------- */

export interface LatheOpts {
  segments?: number
  /** turn angle above which a profile vertex becomes a hard edge */
  crease?: number
  phiStart?: number
  phiLength?: number
  /** metres of profile per V tile / metres of circumference per U tile
      (default: V and U both run 0..1 once around/along) */
  vTile?: number
  uTile?: number
}

/** Profile = [radius, y] pairs walked bottom-to-top for an OUTWARD-facing
    surface (top-to-bottom for an inner wall). Vertices where the profile
    turns sharply are split so the edge stays crisp; everything else is
    smooth. */
export function lathe(
  profile: [number, number][],
  o: LatheOpts = {},
): BufferGeometry {
  const {
    segments = 24,
    crease = 0.75,
    phiStart = 0,
    phiLength = Math.PI * 2,
  } = o
  const n = profile.length
  // per-segment outward normals (2D: [nr, ny])
  const segN: [number, number][] = []
  const segLen: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dr = profile[i + 1][0] - profile[i][0]
    const dy = profile[i + 1][1] - profile[i][1]
    const len = Math.hypot(dr, dy) || 1e-9
    segN.push([dy / len, -dr / len])
    segLen.push(len)
  }
  // vertex list with duplication at creases
  interface V {
    r: number
    y: number
    nr: number
    ny: number
    s: number
  }
  const verts: V[] = []
  let run = 0
  for (let i = 0; i < n; i++) {
    const [r, y] = profile[i]
    if (i > 0) run += segLen[i - 1]
    const prev = i > 0 ? segN[i - 1] : null
    const next = i < n - 1 ? segN[i] : null
    if (prev && next) {
      const dot = prev[0] * next[0] + prev[1] * next[1]
      if (Math.acos(Math.min(1, Math.max(-1, dot))) > crease) {
        verts.push({ r, y, nr: prev[0], ny: prev[1], s: run })
        verts.push({ r, y, nr: next[0], ny: next[1], s: run })
        continue
      }
      let nr = prev[0] + next[0]
      let ny = prev[1] + next[1]
      const l = Math.hypot(nr, ny) || 1
      nr /= l
      ny /= l
      verts.push({ r, y, nr, ny, s: run })
    } else {
      const s = (prev ?? next) as [number, number]
      verts.push({ r, y, nr: s[0], ny: s[1], s: run })
    }
  }
  const rings = verts.length
  const cols = segments + 1
  const pos = new Float32Array(rings * cols * 3)
  const nor = new Float32Array(rings * cols * 3)
  const uv = new Float32Array(rings * cols * 2)
  const rMax = profile.reduce((m, p) => Math.max(m, p[0]), 0.001)
  for (let i = 0; i < rings; i++) {
    const v = verts[i]
    for (let j = 0; j < cols; j++) {
      const phi = phiStart + (j / segments) * phiLength
      const sx = Math.sin(phi)
      const cz = Math.cos(phi)
      const k = i * cols + j
      pos[k * 3] = v.r * sx
      pos[k * 3 + 1] = v.y
      pos[k * 3 + 2] = v.r * cz
      nor[k * 3] = v.nr * sx
      nor[k * 3 + 1] = v.ny
      nor[k * 3 + 2] = v.nr * cz
      const circ = 2 * Math.PI * rMax * (phiLength / (Math.PI * 2))
      uv[k * 2] = o.uTile ? (j / segments) * (circ / o.uTile) : j / segments
      uv[k * 2 + 1] = o.vTile ? v.s / o.vTile : v.s / Math.max(run, 1e-9)
    }
  }
  const idx: number[] = []
  for (let i = 0; i < rings - 1; i++) {
    // skip the zero-length strip between a crease's duplicate rings
    if (verts[i].r === verts[i + 1].r && verts[i].y === verts[i + 1].y) continue
    for (let j = 0; j < segments; j++) {
      const a = i * cols + j
      const b = (i + 1) * cols + j
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('normal', new BufferAttribute(nor, 3))
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
  geo.setIndex(idx)
  fixWinding(geo)
  return geo
}

/** Circle points for lathe profiles: arc from angle a0 to a1 (radians,
    0 = +x, counter-clockwise in the (r, y) plane) about (cr, cy). */
export function arc(
  cr: number,
  cy: number,
  rad: number,
  a0: number,
  a1: number,
  steps: number,
): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    out.push([cr + rad * Math.cos(a), cy + rad * Math.sin(a)])
  }
  return out
}

/* ---------------------------------------------------------------------
   sweep — a tube / leg / handle along a centre-line
   --------------------------------------------------------------------- */

export interface SweepOpts {
  /** dense centre-line points (use CatmullRomCurve3.getPoints) */
  path: Vector3[]
  radial?: number
  /** half-extents [along `side`, along `up`] at t in 0..1 */
  size: (t: number) => [number, number]
  /** frame helper: side = T × ref. Default +Z (right for paths in XY). */
  ref?: Vector3
  /** superellipse exponent: 2 = ellipse, 4 = soft rounded rectangle */
  exponent?: number
  capStart?: boolean
  capEnd?: boolean
  closed?: boolean
  /** metres of path per V tile */
  vTile?: number
}

const _refAlt = new Vector3(0, 1, 0)

export function sweep(o: SweepOpts): BufferGeometry {
  const {
    path,
    radial = 10,
    size,
    ref = new Vector3(0, 0, 1),
    exponent = 2,
    capStart = false,
    capEnd = false,
    closed = false,
    vTile = 0.05,
  } = o
  const L = path.length
  const ring = radial + 1
  const pos: number[] = []
  const uv: number[] = []
  const T = new Vector3()
  const side = new Vector3()
  const up = new Vector3()
  const e = 2 / exponent
  let run = 0
  const frames: { T: Vector3; side: Vector3; up: Vector3 }[] = []
  for (let i = 0; i < L; i++) {
    const ia = closed ? (i - 1 + L) % L : Math.max(0, i - 1)
    const ib = closed ? (i + 1) % L : Math.min(L - 1, i + 1)
    T.subVectors(path[ib], path[ia]).normalize()
    side.crossVectors(T, ref)
    if (side.lengthSq() < 1e-8) side.crossVectors(T, _refAlt)
    side.normalize()
    up.crossVectors(side, T).normalize()
    frames.push({ T: T.clone(), side: side.clone(), up: up.clone() })
    if (i > 0) run += path[i].distanceTo(path[i - 1])
    const [sa, sb] = size(L === 1 ? 0 : i / (L - 1))
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2
      const c = Math.cos(th)
      const s = Math.sin(th)
      const x = sa * Math.sign(c) * Math.abs(c) ** e
      const y = sb * Math.sign(s) * Math.abs(s) ** e
      pos.push(
        path[i].x + side.x * x + up.x * y,
        path[i].y + side.y * x + up.y * y,
        path[i].z + side.z * x + up.z * y,
      )
      uv.push(j / radial, run / vTile)
    }
  }
  const idx: number[] = []
  const rows = closed ? L : L - 1
  for (let i = 0; i < rows; i++) {
    const i2 = (i + 1) % L
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j
      const b = i2 * ring + j
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  // computeVertexNormals leaves a hard line at the duplicated UV seam
  const nor = geo.getAttribute('normal')
  const tmp = new Vector3()
  for (let i = 0; i < L; i++) {
    const a = i * ring
    const b = i * ring + radial
    tmp
      .fromBufferAttribute(nor, a)
      .add(new Vector3().fromBufferAttribute(nor, b))
      .normalize()
    nor.setXYZ(a, tmp.x, tmp.y, tmp.z)
    nor.setXYZ(b, tmp.x, tmp.y, tmp.z)
  }
  if (closed) {
    // join the first and last rings' normals too
    for (let j = 0; j < ring; j++) {
      const a = j
      const b = (L - 1) * ring + j
      tmp
        .fromBufferAttribute(nor, a)
        .add(new Vector3().fromBufferAttribute(nor, b))
        .normalize()
      nor.setXYZ(a, tmp.x, tmp.y, tmp.z)
      nor.setXYZ(b, tmp.x, tmp.y, tmp.z)
    }
  }
  fixWinding(geo)
  if (capStart || capEnd)
    return addCaps(geo, path, frames, ring, radial, capStart, capEnd)
  return geo
}

/** Close tube ends with flat fans (own vertices, so the rim stays crisp). */
function addCaps(
  geo: BufferGeometry,
  path: Vector3[],
  frames: { T: Vector3 }[],
  ring: number,
  radial: number,
  start: boolean,
  end: boolean,
): BufferGeometry {
  const pos = Array.from(geo.getAttribute('position').array)
  const nor = Array.from(geo.getAttribute('normal').array)
  const uv = Array.from(geo.getAttribute('uv').array)
  const idx = Array.from(geo.index!.array)
  const cap = (i: number, sign: number): void => {
    const base = pos.length / 3
    const c = path[i]
    const T = frames[i].T
    pos.push(c.x, c.y, c.z)
    nor.push(T.x * sign, T.y * sign, T.z * sign)
    uv.push(0.5, 0.5)
    for (let j = 0; j <= radial; j++) {
      const k = (i * ring + j) * 3
      pos.push(pos[k], pos[k + 1], pos[k + 2])
      nor.push(T.x * sign, T.y * sign, T.z * sign)
      uv.push(
        0.5 + 0.5 * Math.cos((j / radial) * Math.PI * 2),
        0.5 + 0.5 * Math.sin((j / radial) * Math.PI * 2),
      )
    }
    for (let j = 0; j < radial; j++) {
      if (sign < 0) idx.push(base, base + 1 + j, base + 2 + j)
      else idx.push(base, base + 2 + j, base + 1 + j)
    }
  }
  if (start) cap(0, -1)
  if (end) cap(path.length - 1, 1)
  const out = new BufferGeometry()
  out.setAttribute('position', new Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  out.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  out.setIndex(idx)
  geo.dispose()
  fixWinding(out)
  return out
}

/** A helix (spring) centre-line from `a` to `b`. */
export function helixPath(
  a: Vector3,
  b: Vector3,
  radius: number,
  turns: number,
  perTurn = 9,
): Vector3[] {
  const axis = new Vector3().subVectors(b, a)
  const len = axis.length()
  axis.normalize()
  const u = new Vector3()
    .crossVectors(axis, Math.abs(axis.y) < 0.9 ? _refAlt : new Vector3(1, 0, 0))
    .normalize()
  const v = new Vector3().crossVectors(axis, u).normalize()
  const n = Math.max(2, Math.round(turns * perTurn))
  const out: Vector3[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const ang = t * turns * Math.PI * 2
    out.push(
      new Vector3()
        .copy(a)
        .addScaledVector(axis, t * len)
        .addScaledVector(u, Math.cos(ang) * radius)
        .addScaledVector(v, Math.sin(ang) * radius),
    )
  }
  return out
}

/* ---------------------------------------------------------------------
   slab — the pillowy rounded slab
   ---------------------------------------------------------------------
   A rounded-rectangle plan (big plan-corner radius) whose top and bottom
   edges roll over with their own radii — the shape of a seat cushion, a
   drawer front, an armrest pad, a desk top. Built as a loft of closed
   loops, so the top has real interior vertices for `deform` to dish.

   UVs are metric (one tile = `tile` metres): planar on the flat top and
   bottom, wrapped around the sides, with a texture break at the 45° line
   of each rolled edge — which is exactly where an upholsterer puts the
   piping seam. y runs 0 (underside) … h (top). */

export interface SlabOpts {
  hx: number
  hz: number
  h: number
  rc: number
  rt: number
  rbot?: number
  tile?: number
  rings?: number
  bottomRings?: number
  arc?: number
  straight?: number
  /** segments in one quarter-round of an edge (rounded up to even) */
  bevel?: number
}

interface Loop {
  x: Float32Array
  z: Float32Array
  nx: Float32Array
  nz: Float32Array
  n: number
}

function outlineLoop(
  hx: number,
  hz: number,
  rcIn: number,
  arcSeg: number,
  straight: number,
): Loop {
  const rc = Math.max(0.0006, Math.min(rcIn, hx - 0.0002, hz - 0.0002))
  const cx = hx - rc
  const cz = hz - rc
  const n = 4 * (arcSeg + 1 + straight)
  const x = new Float32Array(n)
  const z = new Float32Array(n)
  const nx = new Float32Array(n)
  const nz = new Float32Array(n)
  const centres: [number, number][] = [
    [cx, cz],
    [-cx, cz],
    [-cx, -cz],
    [cx, -cz],
  ]
  let k = 0
  for (let c = 0; c < 4; c++) {
    const a0 = (c * Math.PI) / 2
    for (let i = 0; i <= arcSeg; i++) {
      const a = a0 + ((Math.PI / 2) * i) / arcSeg
      const co = Math.cos(a)
      const si = Math.sin(a)
      x[k] = centres[c][0] + rc * co
      z[k] = centres[c][1] + rc * si
      nx[k] = co
      nz[k] = si
      k++
    }
    // straight to the next corner
    const nc = centres[(c + 1) % 4]
    const aN = a0 + Math.PI / 2
    const ex = centres[c][0] + rc * Math.cos(aN)
    const ez = centres[c][1] + rc * Math.sin(aN)
    const sx = nc[0] + rc * Math.cos(aN)
    const sz = nc[1] + rc * Math.sin(aN)
    for (let i = 1; i <= straight; i++) {
      const t = i / (straight + 1)
      x[k] = ex + (sx - ex) * t
      z[k] = ez + (sz - ez) * t
      nx[k] = Math.cos(aN)
      nz[k] = Math.sin(aN)
      k++
    }
  }
  return { x, z, nx, nz, n }
}

interface Prof {
  d: number
  y: number
  no: number
  nu: number
}

function slabProfile(o: SlabOpts): {
  prof: Prof[]
  topSplit: number
  botSplit: number
} {
  const { hx, hz, h, rt } = o
  const rbot = o.rbot ?? rt
  const rings = o.rings ?? 8
  const botRings = o.bottomRings ?? 3
  const bevel = Math.max(2, Math.ceil((o.bevel ?? 6) / 2) * 2)
  const dmax = Math.min(hx, hz) - 0.001
  const prof: Prof[] = []
  for (let k = 0; k <= rings; k++) {
    const d = rt + (dmax - rt) * (1 - k / rings)
    prof.push({ d, y: h, no: 0, nu: 1 })
  }
  for (let i = 1; i <= bevel; i++) {
    const a = ((Math.PI / 2) * i) / bevel
    prof.push({
      d: rt - rt * Math.sin(a),
      y: h - rt + rt * Math.cos(a),
      no: Math.sin(a),
      nu: Math.cos(a),
    })
  }
  const topSplit = rings + bevel / 2
  const sideLen = h - rt - rbot
  const first = sideLen > 1e-5 ? 0 : 1
  let botSplit = 0
  for (let i = first; i <= bevel; i++) {
    const b = ((Math.PI / 2) * i) / bevel
    prof.push({
      d: rbot - rbot * Math.cos(b),
      y: rbot - rbot * Math.sin(b),
      no: Math.cos(b),
      nu: -Math.sin(b),
    })
    if (i === bevel / 2) botSplit = prof.length - 1
  }
  for (let k = 1; k <= botRings; k++) {
    prof.push({ d: rbot + (dmax - rbot) * (k / botRings), y: 0, no: 0, nu: -1 })
  }
  return { prof, topSplit, botSplit }
}

export function slab(o: SlabOpts): BufferGeometry {
  const { hx, hz, rc } = o
  const tile = o.tile ?? 0.1
  const arcSeg = o.arc ?? 6
  const straight = o.straight ?? 8
  const { prof, topSplit, botSplit } = slabProfile(o)
  const outer = outlineLoop(hx, hz, rc, arcSeg, straight)
  const N = outer.n
  // outer perimeter arclength → integral number of tiles around
  const s = new Float32Array(N + 1)
  for (let i = 1; i <= N; i++) {
    const a = i - 1
    const b = i % N
    s[i] =
      s[i - 1] + Math.hypot(outer.x[b] - outer.x[a], outer.z[b] - outer.z[a])
  }
  const perim = s[N]
  const uWrap = Math.max(1, Math.round(perim / tile)) / perim

  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []

  const region = (from: number, to: number, planar: boolean): number => {
    const base = pos.length / 3
    let vRun = 0
    for (let k = from; k <= to; k++) {
      const pr = prof[k]
      if (k > from && !planar) {
        const q = prof[k - 1]
        const dd = Math.hypot(pr.d - q.d, pr.y - q.y)
        // arc length of a bevel step ≈ chord
        vRun += dd
      }
      const lp = outlineLoop(hx - pr.d, hz - pr.d, rc - pr.d, arcSeg, straight)
      for (let i = 0; i <= N; i++) {
        const j = i % N
        pos.push(lp.x[j], pr.y, lp.z[j])
        nor.push(lp.nx[j] * pr.no, pr.nu, lp.nz[j] * pr.no)
        if (planar) uv.push(lp.x[j] / tile, lp.z[j] / tile)
        else uv.push(s[i] * uWrap, vRun / tile)
      }
    }
    const cols = N + 1
    for (let k = 0; k < to - from; k++) {
      for (let i = 0; i < N; i++) {
        const a = base + k * cols + i
        const b = base + (k + 1) * cols + i
        idx.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
    return base + (to - from) * cols
  }
  // the innermost loops of the top and bottom collapse to a thin sliver;
  // fan them closed so there is never a see-through slot
  const cap = (ring: number, ny: number): void => {
    const c = pos.length / 3
    pos.push(0, ny > 0 ? prof[0].y : 0, 0)
    nor.push(0, ny, 0)
    uv.push(0, 0)
    for (let i = 0; i < N; i++) {
      if (ny > 0) idx.push(c, ring + i, ring + i + 1)
      else idx.push(c, ring + i + 1, ring + i)
    }
  }
  cap(region(0, topSplit, true) - topSplit * (N + 1), 1)
  region(topSplit, botSplit, false)
  cap(region(botSplit, prof.length - 1, true), -1)

  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  fixWinding(geo)
  geo.computeBoundingSphere()
  return geo
}

/** The closed loop where the rolled edge meets the side (the seam line),
    for piping: `edge` 'top' | 'bottom', pushed `lift` metres outward. */
export function slabSeam(
  o: SlabOpts,
  edge: 'top' | 'bottom',
  lift = 0,
): Vector3[] {
  const { hx, hz, h, rc } = o
  const arcSeg = o.arc ?? 6
  const straight = o.straight ?? 8
  const rt = o.rt
  const rbot = o.rbot ?? o.rt
  const a = Math.PI / 4
  const d = edge === 'top' ? rt - rt * Math.sin(a) : rbot - rbot * Math.cos(a)
  const y =
    edge === 'top' ? h - rt + rt * Math.cos(a) : rbot - rbot * Math.sin(a)
  const no = edge === 'top' ? Math.sin(a) : Math.cos(a)
  const nu = edge === 'top' ? Math.cos(a) : -Math.sin(a)
  const lp = outlineLoop(hx - d, hz - d, rc - d, arcSeg, straight)
  const out: Vector3[] = []
  for (let i = 0; i < lp.n; i++) {
    out.push(
      new Vector3(
        lp.x[i] + lp.nx[i] * no * lift,
        y + nu * lift,
        lp.z[i] + lp.nz[i] * no * lift,
      ),
    )
  }
  return out
}

/* ---------------------------------------------------------------------
   Rounded boxes with metric UVs (small parts that want a real texture)
   --------------------------------------------------------------------- */

/** A slab standing in for a rounded box: centred on the origin. */
export function softBox(
  w: number,
  h: number,
  d: number,
  r: number,
  tile = 0.1,
  bevel = 4,
): BufferGeometry {
  const rr = Math.min(r, Math.min(w, d) / 2 - 0.0005, h / 2 - 0.0002)
  const g = slab({
    hx: w / 2,
    hz: d / 2,
    h,
    rc: Math.min(Math.max(rr, 0.001), Math.min(w, d) / 2 - 0.0004),
    rt: rr,
    rbot: rr,
    tile,
    rings: 2,
    bottomRings: 1,
    arc: Math.max(3, Math.round(bevel * 1.2)),
    straight: 3,
    bevel,
  })
  g.translate(0, -h / 2, 0)
  return g
}

/** A knurled knob: a cylinder along Z whose side is cut with V flutes. */
export function knurled(
  radius: number,
  length: number,
  ridges = 18,
  depth = 0.09,
  perRidge = 2,
): BufferGeometry {
  const g = new CylinderGeometry(
    radius,
    radius,
    length,
    ridges * perRidge,
    1,
    false,
  )
  const pos = g.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const r = Math.hypot(x, z)
    if (r < 1e-6) continue
    const th = Math.atan2(z, x)
    const f = ((((th * ridges) / (Math.PI * 2)) % 1) + 1) % 1
    const k = 1 - depth * Math.abs(f - 0.5) * 2
    pos.setX(i, x * k)
    pos.setZ(i, z * k)
  }
  g.computeVertexNormals()
  g.rotateX(Math.PI / 2)
  return g
}

/** A straight or gently curved round rod/wire between points. */
export function rod(
  pts: Vector3[],
  radius: number,
  radial = 8,
  caps = true,
): BufferGeometry {
  return sweep({
    path: pts,
    radial,
    size: () => [radius, radius],
    capStart: caps,
    capEnd: caps,
    vTile: 0.06,
  })
}

/* ---------------------------------------------------------------------
   Wood: metric UVs and one shared set of maps
   --------------------------------------------------------------------- */

/** A rounded box with metric UVs (one unit = `tile` metres) and the wood
    grain running along `grain`. Faces are mapped planar by dominant
    normal, so the seam sits on the 45-degree line of each rounded edge,
    exactly where an edge band would end. */
export function woodBox(
  w: number,
  h: number,
  d: number,
  r: number,
  seg: number,
  tile: number,
  grain: 'x' | 'y' | 'z',
): BufferGeometry {
  const g = new RoundedBoxGeometry(
    w,
    h,
    d,
    seg,
    Math.min(r, Math.min(w, h, d) * 0.45),
  )
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i))
    const ay = Math.abs(nor.getY(i))
    const az = Math.abs(nor.getZ(i))
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    let u: number
    let v: number
    if (ax >= ay && ax >= az) {
      // faces looking along x: the two remaining axes are y and z
      if (grain === 'y') [u, v] = [y, z]
      else [u, v] = [z, y]
    } else if (ay >= az) {
      if (grain === 'x') [u, v] = [x, z]
      else [u, v] = [z, x]
    } else if (grain === 'y') [u, v] = [y, x]
    else [u, v] = [x, y]
    uv[i * 2] = u / tile
    uv[i * 2 + 1] = v / tile
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  return g
}

/* One wood texture set for the whole desk (top, panels, pedestal), reference
   counted so it is built once and freed when the last user unmounts. The
   deferred free lets StrictMode's mount/unmount/mount pass straight through. */
let woodShared: { maps: SurfaceMaps; refs: number; timer: number } | null = null

function woodGet(aniso: number, base: string, seam: string): SurfaceMaps {
  if (!woodShared)
    woodShared = { maps: makeWoodMaps(base, seam, 9, aniso), refs: 0, timer: 0 }
  return woodShared.maps
}

export function useWood(
  aniso: number,
  base: string,
  seam: string,
): SurfaceMaps {
  const [maps] = useState(() => woodGet(aniso, base, seam))
  useEffect(() => {
    const ws = woodShared
    if (!ws) return
    window.clearTimeout(ws.timer)
    ws.refs++
    return () => {
      ws.refs--
      if (ws.refs <= 0) {
        ws.timer = window.setTimeout(() => {
          if (woodShared === ws && ws.refs <= 0) {
            disposeSurface(ws.maps)
            woodShared = null
          }
        }, 250)
      }
    }
  }, [])
  return maps
}

/* ---------------------------------------------------------------------
   Noise, crumpled paper
   --------------------------------------------------------------------- */

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h =
    (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1274126177) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967296
}

/** Smooth 3D value noise, 0..1. */
export function noise3(x: number, y: number, z: number, seed = 1): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const fx = x - xi
  const fy = y - yi
  const fz = z - zi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const sz = fz * fz * (3 - 2 * fz)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  const h = (dx: number, dy: number, dz: number) =>
    hash3(xi + dx, yi + dy, zi + dz, seed)
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), sx), l(h(0, 1, 0), h(1, 1, 0), sx), sy),
    l(l(h(0, 0, 1), h(1, 0, 1), sx), l(h(0, 1, 1), h(1, 1, 1), sx), sy),
    sz,
  )
}

/** A crumpled wad of paper: an icosphere pushed through a random convex
    polytope (facets and ridges) plus ridged noise, flattened where it
    rests on the desk, with creases darkened in vertex colour. The mesh is
    left non-indexed so every triangle is a flat facet, which is exactly
    what crumpled paper looks like. Deterministic in `seed`. */
export function crumple(
  seed: number,
  radius: number,
  detail = 2,
): BufferGeometry {
  const g = new IcosahedronGeometry(1, detail)
  const rand = mulberry(seed * 977 + 13)
  const planes: { n: Vector3; h: number }[] = []
  for (let i = 0; i < 26; i++) {
    const nn = new Vector3(
      rand() * 2 - 1,
      rand() * 2 - 1,
      rand() * 2 - 1,
    ).normalize()
    planes.push({ n: nn, h: 0.7 + rand() * 0.28 })
  }
  const pos = g.getAttribute('position')
  const v = new Vector3()
  const d = new Vector3()
  const col = new Float32Array(pos.count * 3)
  const c = new Color()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    d.copy(v).normalize()
    // convex-polytope radius: nearest plane along this direction
    let r = 1.05
    for (const p of planes) {
      const dn = d.dot(p.n)
      if (dn > 0.05) r = Math.min(r, p.h / dn)
    }
    const ridge =
      1 - Math.abs(noise3(d.x * 3.1 + seed, d.y * 3.1, d.z * 3.1, seed) * 2 - 1)
    const fine = noise3(d.x * 7.3, d.y * 7.3 + seed, d.z * 7.3, seed + 5)
    r = r * (0.9 + 0.08 * ridge + 0.05 * fine)
    // rest flat on the desk instead of balancing on a point
    const y = Math.max(-0.68, d.y * r)
    pos.setXYZ(i, d.x * r * radius, y * radius, d.z * r * radius)
    const shade =
      0.74 +
      0.26 * Math.min(1, Math.max(0, (r - 0.62) / 0.4)) -
      0.1 * (1 - ridge)
    c.setRGB(shade, shade * 0.985, shade * 0.95)
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new BufferAttribute(col, 3))
  g.computeVertexNormals() // non-indexed: one normal per facet
  g.computeBoundingSphere()
  return g
}

/* ---------------------------------------------------------------------
   Texture helpers
   --------------------------------------------------------------------- */

function configure(
  t: CanvasTexture,
  colour: boolean,
  repeatX: number,
  repeatY: number,
): CanvasTexture {
  t.colorSpace = colour ? SRGBColorSpace : NoColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.anisotropy = 8
  t.repeat.set(repeatX, repeatY)
  t.needsUpdate = true
  return t
}

export interface ColoredMaps {
  map: CanvasTexture
  normalMap: CanvasTexture
  roughnessMap: CanvasTexture
  normalScale: [number, number]
  dispose: () => void
}

/** Woven upholstery: colour (weave-shaded, mottled), normal, roughness.
    One texture tile covers `tile` metres; `repeat` is the texture repeat
    (leave 1 when the geometry's UVs are already tile-relative, as slab()
    produces with the same `tile`). */
export function fabricSet(
  hex: string,
  seed = 5,
  tile = 0.07,
  size = 256,
  repeat = 1,
): ColoredMaps {
  const maps = fabricMaps(seed, size, repeat, 28)
  const src = (maps.heightMap.image as HTMLCanvasElement).getContext('2d')!
  const h = src.getImageData(0, 0, size, size).data
  const ctx = makeCanvas(size, size)
  const img = ctx.createImageData(size, size)
  const base = new Color(hex).convertLinearToSRGB()
  const mott = fbmField(size, seed + 21, {
    octaves: 4,
    freq: 6,
    persistence: 0.55,
  })
  for (let i = 0; i < size * size; i++) {
    const wv = h[i * 4] / 255
    const k = (0.7 + 0.42 * wv) * (0.9 + 0.2 * mott[i])
    img.data[i * 4] = Math.min(255, Math.round(base.r * 255 * k))
    img.data[i * 4 + 1] = Math.min(255, Math.round(base.g * 255 * k))
    img.data[i * 4 + 2] = Math.min(255, Math.round(base.b * 255 * k))
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const map = configure(new CanvasTexture(ctx.canvas), true, repeat, repeat)
  void tile
  maps.heightMap.dispose()
  return {
    map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    normalScale: [0.9, 0.9],
    dispose: () => {
      map.dispose()
      maps.normalMap.dispose()
      maps.roughnessMap.dispose()
    },
  }
}

/** Repeat helper for PbrMaps used with metric UVs. */
export function tilePbr(m: PbrMaps, tile: number): PbrMaps {
  const r = 1 / tile
  m.normalMap.repeat.set(r, r)
  m.roughnessMap.repeat.set(r, r)
  m.heightMap.repeat.set(r, r)
  return m
}

/** Fine-grained scuffed rubber/nylon: dense stipple, no scratches. */
export function nylonMaps(seed = 3, size = 256, tile = 0.05): PbrMaps {
  const fine = fbmField(size, seed, { octaves: 3, freq: 64, persistence: 0.6 })
  const soft = fbmField(size, seed + 2, {
    octaves: 3,
    freq: 5,
    persistence: 0.5,
  })
  for (let i = 0; i < fine.length; i++) fine[i] = fine[i] * 0.8 + soft[i] * 0.2
  normalizeField(fine)
  const rough = fbmField(size, seed + 3, {
    octaves: 4,
    freq: 7,
    persistence: 0.6,
  })
  return tilePbr(
    pbrFromFields(fine, rough, size, {
      strength: 1.1,
      repeat: 1,
      roughLo: 0.62,
      roughHi: 0.95,
    }),
    tile,
  )
}

export { Vector2 }
