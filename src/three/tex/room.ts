import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  ClampToEdgeWrapping,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Euler,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WINDOW } from '../layout'
import {
  drawPixelText,
  finishSurface,
  makeCanvas,
  mulberry,
  pixelTextWidth,
  type SurfaceMaps,
} from '../textures'
import {
  fabricMaps,
  fbmField,
  fieldCanvas,
  mix,
  normalCanvas,
  normalizeField,
  pbrFromFields,
  type PbrMaps,
} from './noise'

/* =====================================================================
   Room-shell toolkit — the geometry and texture helpers behind the
   walls, skirting, cornice, floor, rug, framed prints, the wall shelf
   and the set dressing.

   Geometry: a profile SWEEP with real mitres (skirting, cornice, picture
   frames), bevelled plates (sockets, switches), merged parts so a dozen
   little pieces are one draw call.

   Textures: every surface here is generated once (seeded, so StrictMode
   and HMR redraw the same pixels) and disposed by its owner:
     plasterSurface()   tiled painted plaster (colour + normal + rough)
     bakeSideWall()     a UNIQUE per-wall colour map: dirt line, corner
                        occlusion, scuffs, faint stains
     makeWallGrime()    the same, as a transparent decal for the back wall
                        (BackWall.tsx owns that mesh and its UVs)
     makeFloorMaps()    varnished planks with bevelled gaps, per-board
                        colour and gloss, grain, knots, scratches
     makeFloorWear()    a worn path + caster scuffs, as a floor decal
     makeRugMaps()      a woven kilim: border, medallion, weave normal
   All units are metres.
   ===================================================================== */

type V3 = [number, number, number]

/* ---------------------------------------------------------------------
   Small utilities
   --------------------------------------------------------------------- */

function hexRGB(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** A data texture (normal / roughness / height): linear, tiled, mipped. */
export function dataTexture(canvas: HTMLCanvasElement, anisotropy = 8): CanvasTexture {
  const t = new CanvasTexture(canvas)
  t.colorSpace = NoColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.anisotropy = anisotropy
  t.needsUpdate = true
  return t
}

/** A colour texture: sRGB, mipped, optionally clamped (decals). */
export function colorTexture(
  canvas: HTMLCanvasElement,
  anisotropy = 4,
  tiled = true,
): CanvasTexture {
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  if (tiled) t.wrapS = t.wrapT = RepeatWrapping
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.anisotropy = anisotropy
  t.needsUpdate = true
  return t
}

/** Halve/quarter a canvas (cheap roughness maps). */
function shrink(src: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const ctx = makeCanvas(size, size)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(src, 0, 0, size, size)
  return ctx.canvas
}

/* ---------------------------------------------------------------------
   Geometry helpers
   --------------------------------------------------------------------- */

const _m = new Matrix4()
const _q = new Quaternion()
const _e = new Euler()
const _p = new Vector3()
const _s = new Vector3()

/** Transform a geometry in place (position, XYZ euler, scale). Returns it. */
export function place(
  geo: BufferGeometry,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  scale: number | V3 = 1,
): BufferGeometry {
  _e.set(rx, ry, rz)
  _q.setFromEuler(_e)
  if (typeof scale === 'number') _s.set(scale, scale, scale)
  else _s.set(scale[0], scale[1], scale[2])
  _m.compose(_p.set(x, y, z), _q, _s)
  geo.applyMatrix4(_m)
  return geo
}

/** Bake a flat vertex colour into a geometry (linear, via Color). */
export function tint(geo: BufferGeometry, color: string | number | Color): BufferGeometry {
  const c = new Color(color)
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new Float32BufferAttribute(arr, 3))
  return geo
}

/** Weld same-material parts into ONE geometry (one draw call). Every part
    is made non-indexed and stripped to position/normal/uv(/color). */
export function weld(parts: BufferGeometry[]): BufferGeometry {
  const wantColor = parts.some((g) => g.attributes.color)
  const clean = parts.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g.clone()
    for (const name of Object.keys(ng.attributes)) {
      if (name === 'position' || name === 'normal' || name === 'uv') continue
      if (name === 'color' && wantColor) continue
      ng.deleteAttribute(name)
    }
    if (!ng.attributes.uv) {
      ng.setAttribute(
        'uv',
        new Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2),
      )
    }
    if (wantColor && !ng.attributes.color) tint(ng, '#ffffff')
    return ng
  })
  const merged = mergeGeometries(clean, false)
  clean.forEach((g) => g.dispose())
  parts.forEach((g) => g.dispose())
  return merged
}

/** Rounded rectangle outline (centred), corner radius r. */
export function roundedRectShape(w: number, h: number, r: number, cx = 0, cy = 0): Shape {
  const s = new Shape()
  const x = cx - w / 2
  const y = cy - h / 2
  const rr = Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5)
  s.moveTo(x + rr, y)
  s.lineTo(x + w - rr, y)
  s.absarc(x + w - rr, y + rr, rr, -Math.PI / 2, 0, false)
  s.lineTo(x + w, y + h - rr)
  s.absarc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2, false)
  s.lineTo(x + rr, y + h)
  s.absarc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI, false)
  s.lineTo(x, y + rr + 1e-5)
  s.absarc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5, false)
  return s
}

/** A bevelled plate facing +z, back face on z=0: sockets, switch plates,
    rug slabs. `t` is the total thickness, `bevel` the edge round-over. */
export function plateGeo(
  w: number,
  h: number,
  t: number,
  radius = 0.006,
  bevel = 0.0015,
  segs = 2,
): BufferGeometry {
  const shape = roundedRectShape(w - 2 * bevel, h - 2 * bevel, Math.max(radius - bevel, 0.0005))
  const geo = new ExtrudeGeometry(shape, {
    depth: Math.max(t - 2 * bevel, 0.0002),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segs,
    curveSegments: 5,
  })
  // extrusion runs -bevel .. depth+bevel: seat the back on z = 0
  geo.translate(0, 0, bevel)
  return geo
}

/** Rounded box as a plain geometry (for merging). */
export function rbox(
  w: number,
  h: number,
  d: number,
  radius = 0.002,
  segs = 2,
): BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, segs, Math.min(radius, Math.min(w, h, d) * 0.45))
}

/* ---------------------------------------------------------------------
   Profile sweep — the moulding maker.

   A profile is a list of [a, b] points (optionally a 3rd value 1 = smooth
   shading through this point). `a` runs away from the path line toward
   the room, `b` runs out of the path plane (height for skirting, depth
   from the wall for frames). Travel the profile with the SOLID on your
   left: the visible face is on the right, and that is the normal.

   The path is a 2D polyline; every interior vertex gets a true mitre, so
   the three walls (or four sides of a frame) meet in clean 45° joints.
   mode 'floor': path (u,v) = (x,z), b = y      (skirting, cornice)
   mode 'wall' : path (u,v) = (x,y), b = z      (picture frames)
   --------------------------------------------------------------------- */

export type ProfilePt = [number, number] | [number, number, number]

export function sweep(
  rawProfile: ProfilePt[],
  path: [number, number][],
  opts: { mode: 'floor' | 'wall'; closed?: boolean; side?: 1 | -1; flip?: boolean },
): BufferGeometry {
  const { mode, closed = false, side = 1, flip = false } = opts
  // drop zero-length edges (arcs that start where a straight run ended)
  const profile = rawProfile.filter(
    (p, i) => i === 0 || Math.hypot(p[0] - rawProfile[i - 1][0], p[1] - rawProfile[i - 1][1]) > 1e-7,
  )
  const n = path.length
  const segCount = closed ? n : n - 1
  const norms: [number, number][] = []
  const lens: number[] = []
  for (let k = 0; k < segCount; k++) {
    const p = path[k]
    const q = path[(k + 1) % n]
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const len = Math.hypot(dx, dy) || 1
    norms.push([(-dy / len) * side, (dx / len) * side])
    lens.push(len)
  }
  const mitre = (i: number): [number, number] => {
    const prev = closed ? (i - 1 + n) % n : i - 1
    const hasPrev = closed || i > 0
    const hasNext = closed || i < segCount
    if (hasPrev && hasNext) {
      const a = norms[prev]
      const b = norms[i]
      const k = 1 / (1 + a[0] * b[0] + a[1] * b[1])
      return [(a[0] + b[0]) * k, (a[1] + b[1]) * k]
    }
    return hasPrev ? norms[prev] : norms[i]
  }
  const toWorld = (u: number, v: number, b: number): V3 =>
    mode === 'floor' ? [u, b, v] : [u, v, b]

  // 2D profile normals per edge: right of travel = (db, -da)
  const pc = profile.length
  const edgeN: [number, number][] = []
  const cum: number[] = [0]
  for (let j = 0; j < pc - 1; j++) {
    const da = profile[j + 1][0] - profile[j][0]
    const db = profile[j + 1][1] - profile[j][1]
    const l = Math.hypot(da, db) || 1
    const s = flip ? -1 : 1
    edgeN.push([(db / l) * s, (-da / l) * s])
    cum.push(cum[j] + l)
  }
  /** normal at profile point j, as seen from the edge that starts there
      (atStart) or ends there; smooth points average both neighbours */
  const blend = (j: number, atStart: boolean): [number, number] => {
    const own = edgeN[atStart ? j : j - 1]
    const point = profile[j]
    if (!(point.length > 2 && point[2] === 1)) return own
    const other = edgeN[atStart ? j - 1 : j]
    if (!other) return own
    const x = own[0] + other[0]
    const y = own[1] + other[1]
    const l = Math.hypot(x, y) || 1
    return [x / l, y / l]
  }

  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const emit = (
    i: number,
    k: number,
    m: [number, number],
    a: number,
    b: number,
    nn: [number, number],
    uu: number,
    vv: number,
  ) => {
    const [x, y, z] = toWorld(path[i][0] + a * m[0], path[i][1] + a * m[1], b)
    const nk = norms[k]
    const [nx, ny, nz] = toWorld(nk[0] * nn[0], nk[1] * nn[0], nn[1])
    pos.push(x, y, z)
    nor.push(nx, ny, nz)
    uv.push(uu, vv)
  }
  let along = 0
  for (let k = 0; k < segCount; k++) {
    const s = k
    const e = (k + 1) % n
    const ms = mitre(s)
    const me = mitre(e)
    for (let j = 0; j < pc - 1; j++) {
      const [a0, b0] = profile[j]
      const [a1, b1] = profile[j + 1]
      const n0 = blend(j, true)
      const n1 = blend(j + 1, false)
      const A = toWorld(path[s][0] + a0 * ms[0], path[s][1] + a0 * ms[1], b0)
      const B = toWorld(path[s][0] + a1 * ms[0], path[s][1] + a1 * ms[1], b1)
      const C = toWorld(path[e][0] + a0 * me[0], path[e][1] + a0 * me[1], b0)
      const nk = norms[k]
      const nx = nk[0] * (n0[0] + n1[0])
      const ny = nk[1] * (n0[0] + n1[0])
      const nMid = toWorld(nx, ny, n0[1] + n1[1])
      const ux = B[0] - A[0]
      const uy = B[1] - A[1]
      const uz = B[2] - A[2]
      const vx = C[0] - A[0]
      const vy = C[1] - A[1]
      const vz = C[2] - A[2]
      const cx = uy * vz - uz * vy
      const cy = uz * vx - ux * vz
      const cz = ux * vy - uy * vx
      const ok = cx * nMid[0] + cy * nMid[1] + cz * nMid[2] >= 0
      const u0 = along
      const u1 = along + lens[k]
      const v0 = cum[j]
      const v1 = cum[j + 1]
      if (ok) {
        emit(s, k, ms, a0, b0, n0, u0, v0)
        emit(s, k, ms, a1, b1, n1, u0, v1)
        emit(e, k, me, a0, b0, n0, u1, v0)
        emit(s, k, ms, a1, b1, n1, u0, v1)
        emit(e, k, me, a1, b1, n1, u1, v1)
        emit(e, k, me, a0, b0, n0, u1, v0)
      } else {
        emit(s, k, ms, a0, b0, n0, u0, v0)
        emit(e, k, me, a0, b0, n0, u1, v0)
        emit(s, k, ms, a1, b1, n1, u0, v1)
        emit(s, k, ms, a1, b1, n1, u0, v1)
        emit(e, k, me, a0, b0, n0, u1, v0)
        emit(e, k, me, a1, b1, n1, u1, v1)
      }
    }
    along += lens[k]
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  return geo
}

/** Points on an elliptical arc in (a,b): angles about (ca, cb), interior
    points smooth-shaded, ends left hard so they meet flat runs cleanly. */
export function arcPts(
  ca: number,
  cb: number,
  rx: number,
  from: number,
  to: number,
  steps = 6,
  ry = rx,
): ProfilePt[] {
  const out: ProfilePt[] = []
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps
    const x = ca + rx * Math.cos(t)
    const y = cb + ry * Math.sin(t)
    out.push(i === 0 || i === steps ? [x, y] : [x, y, 1])
  }
  return out
}

/* ---------------------------------------------------------------------
   Skirting board and cornice
   --------------------------------------------------------------------- */

/** The three walls as one open path, front-left to front-right. Inset a
    millimetre into the plaster so nothing z-fights. */
export const ROOM_PATH: [number, number][] = [
  [-2.05 - 0.001, 2.3],
  [-2.05 - 0.001, -1.08 - 0.001],
  [2.25 + 0.001, -1.08 - 0.001],
  [2.25 + 0.001, 2.3],
]

/** 9 cm skirting: a square plinth, a torus bead, a cove and a chamfered
    top lip. Profile (a = out from the wall, b = height). */
export function skirtingGeo(): BufferGeometry {
  const profile: ProfilePt[] = [
    [0.0175, 0.0],
    [0.0182, 0.0008],
    [0.0182, 0.052],
    // torus bead
    ...arcPts(0.0182, 0.0575, 0.0055, -Math.PI / 2, Math.PI / 2, 7),
    // cove up to the top lip
    [0.0115, 0.0665, 1],
    [0.0092, 0.0735, 1],
    [0.0092, 0.0825],
    // chamfered top
    [0.0068, 0.0885],
    [0.0, 0.0905],
  ]
  return sweep(profile, ROOM_PATH, { mode: 'floor' })
}

/** Cove cornice where the walls meet the ceiling. */
export function corniceGeo(): BufferGeometry {
  const drop = 0.085
  const reach = 0.078
  const y0 = 2.6
  const profile: ProfilePt[] = [
    // the little quirk under the cove
    [0.0, y0 - drop - 0.013],
    [0.011, y0 - drop - 0.013],
    [0.011, y0 - drop - 0.004],
    [0.0085, y0 - drop],
    // the cove: a concave quarter ellipse up to the ceiling
    ...arcPts(reach, y0 - drop, reach - 0.0085, Math.PI, Math.PI / 2, 10, drop),
  ]
  return sweep(profile, ROOM_PATH, { mode: 'floor' })
}

/* ---------------------------------------------------------------------
   Plaster walls
   --------------------------------------------------------------------- */

/** Where the light switch plate sits on the back wall (right of the shelf). */
export const SWITCH = { x: 1.9, y: 1.2 } as const

/** Tileable painted-plaster colour: broad trowel mottling, roller streaks
    and fine tooth over `base`. */
export function plasterColor(base: string, seed: number, size = 512): HTMLCanvasElement {
  const [r0, g0, b0] = hexRGB(base)
  const mott = fbmField(size, seed, { octaves: 4, freq: 3, persistence: 0.55 })
  const roll = fbmField(size, seed + 4, { octaves: 2, freqX: 2, freqY: 22, persistence: 0.6 })
  const fine = fbmField(size, seed + 7, { octaves: 1, freq: 80 })
  const ctx = makeCanvas(size, size)
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const k = 1 + (mott[i] - 0.5) * 0.5 + (roll[i] - 0.5) * 0.12 + (fine[i] - 0.5) * 0.1
    // lighter patches run a touch warmer, like a real skim coat
    const warm = (mott[i] - 0.5) * 6
    img.data[i * 4] = Math.max(0, Math.min(255, r0 * k + warm))
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, g0 * k))
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, b0 * k - warm * 0.6))
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return ctx.canvas
}

/** One plaster look for every wall: tiled colour plus the toolkit's
    plasterMaps normal / roughness / height (all at repeat 1 — the caller
    sets the repeat). `normalMap` is the one to use; bumpMap stays filled
    for older consumers. */
export function plasterSurface(
  base: string,
  seed = 11,
  size = 512,
  anisotropy = 8,
): SurfaceMaps {
  // Skim-coated wall, not stucco: broad trowel undulation with only a
  // whisper of fine tooth (a 512 px tile spans ~0.55 m, ~1 mm a texel), and
  // a normal strength low enough that a lamp rakes it without gravel.
  const soft = fbmField(size, seed, { octaves: 4, freq: 3, persistence: 0.42 })
  const tooth = fbmField(size, seed + 1, { octaves: 2, freq: 56, persistence: 0.5 })
  const h = mix(soft, tooth, 0.1)
  normalizeField(h)
  const rough = fbmField(size, seed + 2, { octaves: 3, freq: 5 })
  const pm = pbrFromFields(h, rough, size, { strength: 0.42, repeat: 1, roughLo: 0.72, roughHi: 1.0 })
  return {
    map: colorTexture(plasterColor(base, seed + 3, size), anisotropy),
    bumpMap: pm.heightMap,
    roughnessMap: pm.roughnessMap,
    normalMap: pm.normalMap,
  }
}

/** A soft, jittered smear: layered low-alpha strokes so it has no edge. */
function smear(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  x: number,
  y: number,
  len: number,
  angle: number,
  width: number,
  rgb: string,
  alpha: number,
): void {
  ctx.lineCap = 'round'
  for (let pass = 0; pass < 4; pass++) {
    const w = width * (1 - pass * 0.18)
    ctx.strokeStyle = `rgba(${rgb},${(alpha / 3).toFixed(4)})`
    ctx.lineWidth = Math.max(1, w)
    ctx.beginPath()
    let px = x + (rand() - 0.5) * width * 0.4
    let py = y + (rand() - 0.5) * width * 0.4
    ctx.moveTo(px, py)
    const steps = 6
    for (let s = 1; s <= steps; s++) {
      px += (Math.cos(angle) * len) / steps + (rand() - 0.5) * width * 0.3
      py += (Math.sin(angle) * len) / steps + (rand() - 0.5) * width * 0.3
      ctx.lineTo(px, py)
    }
    ctx.stroke()
  }
}

/** A soft round smudge (dirt halo, water stain, fingerprint cloud). */
function smudge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rgb: string,
  alpha: number,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1, ry / rx)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
  g.addColorStop(0, `rgba(${rgb},${alpha})`)
  g.addColorStop(0.55, `rgba(${rgb},${alpha * 0.45})`)
  g.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.fillRect(-rx, -rx, rx * 2, rx * 2)
  ctx.restore()
}

/** Bake a UNIQUE colour map for a side wall (plane 3.9 × 2.6 m, u along
    the room's depth). Plaster mottling, the dirt line above the skirting,
    darker ceiling edge, soft occlusion in the back corner, scuffs and a
    faint water stain. Not tiled: the plaster grain comes from the shared
    normal map. */
export function bakeSideWall(
  base: string,
  seed: number,
  side: 'left' | 'right',
  anisotropy = 4,
  W = 768,
  H = 512,
): CanvasTexture {
  const [r0, g0, b0] = hexRGB(base)
  const F = 256
  const mott = fbmField(F, seed, { octaves: 5, freq: 2, persistence: 0.55 })
  const roll = fbmField(F, seed + 3, { octaves: 3, freqX: 2, freqY: 14, persistence: 0.6 })
  const ctx = makeCanvas(W, H, true)
  const img = ctx.createImageData(W, H)
  const zOf = (px: number) => (side === 'left' ? 2.3 - (px / W) * 3.9 : -1.6 + (px / W) * 3.9)
  for (let py = 0; py < H; py++) {
    const y = 2.6 * (1 - (py + 0.5) / H)
    const dirt = 1 - 0.3 * (1 - smoothstep(0.09, 0.55, y))
    const ceil = 1 - 0.22 * smoothstep(1.85, 2.6, y)
    for (let px = 0; px < W; px++) {
      const z = zOf(px + 0.5)
      const fi = ((py * F) / H | 0) * F + ((px * F) / W | 0)
      const dz = z + 1.08
      const corner = dz >= 0 ? 1 - 0.36 * Math.exp(-dz / 0.2) : 0.6
      const k =
        (1 + (mott[fi] - 0.5) * 0.5 + (roll[fi] - 0.5) * 0.1) * dirt * ceil * corner
      const o = (py * W + px) * 4
      img.data[o] = Math.min(255, r0 * k)
      img.data[o + 1] = Math.min(255, g0 * k)
      img.data[o + 2] = Math.min(255, b0 * k)
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  const rand = mulberry(seed + 21)
  const X = (z: number) => (side === 'left' ? ((2.3 - z) / 3.9) * W : ((z + 1.6) / 3.9) * W)
  const Y = (y: number) => (1 - y / 2.6) * H
  const mpp = W / 3.9 // pixels per metre along the wall
  // scuffs at hip height and near the floor: a chair arm, a bag, a vacuum
  for (let i = 0; i < 9; i++) {
    const z = -0.9 + rand() * 2.6
    const y = 0.16 + rand() * 0.75
    smear(ctx, rand, X(z), Y(y), (0.05 + rand() * 0.12) * mpp, -0.6 + rand() * 1.2, 0.012 * mpp * (0.6 + rand()), '14,11,10', 0.13 + rand() * 0.08)
  }
  // a soft dirty shadow where the bookcase / bin crowd the wall
  smudge(ctx, X(side === 'left' ? -0.45 : 0.4), Y(0.8), 0.5 * mpp, 0.8 * mpp, '6,5,7', 0.22)
  // a faint water stain creeping down from the ceiling
  const sx = X(side === 'left' ? -0.7 : -0.55)
  smudge(ctx, sx, Y(2.25), 0.07 * mpp, 0.32 * mpp, '84,62,32', 0.09)
  smudge(ctx, sx, Y(1.98), 0.05 * mpp, 0.02 * mpp, '70,50,24', 0.10)
  // scattered nicks and pinholes
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = rand() < 0.6 ? 'rgba(10,8,8,0.28)' : 'rgba(210,205,195,0.14)'
    ctx.fillRect(rand() * W, rand() * H, 1 + (rand() < 0.2 ? 1 : 0), 1)
  }
  return colorTexture(ctx.canvas, anisotropy, false)
}

/** The back wall's dirt / occlusion layer as a transparent decal (dark
    RGBA over the plaster). Covers x −2.2…2.4, y 0…2.6. The window's
    opening stays clear so nothing dims the glass. */
export function makeWallGrime(seed = 5, W = 1024, H = 576, anisotropy = 4): CanvasTexture {
  const ctx = makeCanvas(W, H, true)
  const img = ctx.createImageData(W, H)
  const F = 256
  const mott = fbmField(F, seed, { octaves: 4, freq: 3, persistence: 0.55 })
  const X0 = -2.2
  const SPAN = 4.6
  for (let py = 0; py < H; py++) {
    const y = 2.6 * (1 - (py + 0.5) / H)
    const dirt = 0.3 * (1 - smoothstep(0.09, 0.55, y))
    const ceil = 0.2 * smoothstep(1.85, 2.6, y)
    // the desk throws a little occlusion on the wall just above it
    const aboveDesk = y > 0.742 ? 0.2 * (1 - smoothstep(0.742, 1.05, y)) : 0
    for (let px = 0; px < W; px++) {
      const x = X0 + ((px + 0.5) / W) * SPAN
      const dl = x + 2.05
      const dr = 2.25 - x
      const cl = dl >= 0 ? 0.36 * Math.exp(-dl / 0.2) : 0.6
      const cr = dr >= 0 ? 0.36 * Math.exp(-dr / 0.2) : 0.6
      const band = smoothstep(-0.9, -0.72, x) * (1 - smoothstep(0.88, 1.08, x))
      const m = mott[((py * F) / H | 0) * F + ((px * F) / W | 0)]
      const a = Math.min(0.85, dirt + ceil + cl + cr + aboveDesk * band + (m - 0.5) * 0.05)
      const o = (py * W + px) * 4
      img.data[o] = 7
      img.data[o + 1] = 6
      img.data[o + 2] = 8
      img.data[o + 3] = Math.round(Math.max(0, a) * 255)
    }
  }
  ctx.putImageData(img, 0, 0)

  const rand = mulberry(seed + 9)
  const X = (x: number) => ((x - X0) / SPAN) * W
  const Y = (y: number) => (1 - y / 2.6) * H
  const mpp = W / SPAN
  // sooty halo above the wall socket, greasy thumb-cloud round the switch
  smudge(ctx, X(0.72), Y(0.34), 0.11 * mpp, 0.15 * mpp, '10,8,7', 0.24)
  smudge(ctx, X(SWITCH.x), Y(SWITCH.y), 0.07 * mpp, 0.09 * mpp, '60,50,40', 0.12)
  smudge(ctx, X(SWITCH.x + 0.03), Y(SWITCH.y - 0.02), 0.03 * mpp, 0.045 * mpp, '40,32,26', 0.12)
  // scuffs along the bottom of the wall, and a couple at desk height
  for (let i = 0; i < 16; i++) {
    const x = -1.9 + rand() * 4
    const y = 0.11 + rand() * 0.42
    smear(ctx, rand, X(x), Y(y), (0.04 + rand() * 0.1) * mpp, -0.5 + rand(), 0.011 * mpp * (0.6 + rand()), '12,10,9', 0.12 + rand() * 0.08)
  }
  for (let i = 0; i < 5; i++) {
    const x = -0.85 + rand() * 1.8
    smear(ctx, rand, X(x), Y(0.78 + rand() * 0.16), (0.03 + rand() * 0.05) * mpp, -0.3 + rand() * 0.6, 0.008 * mpp, '10,8,8', 0.13)
  }
  // water stain in the top-right corner, tide-marked
  smudge(ctx, X(2.06), Y(2.42), 0.16 * mpp, 0.12 * mpp, '84,62,32', 0.1)
  smudge(ctx, X(2.09), Y(2.26), 0.05 * mpp, 0.04 * mpp, '70,50,24', 0.09)
  // pinholes and nicks
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = 'rgba(8,6,6,0.3)'
    ctx.fillRect(rand() * W, rand() * H, 1, 1)
  }
  // keep the window clear of the decal
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = '#000'
  // the casing stands casingW beyond the opening; the sill horns and apron hang below
  const mx = WINDOW.casingW + WINDOW.sillHorn + 0.03
  const wx0 = X(WINDOW.x - WINDOW.frameW / 2 - mx)
  const wx1 = X(WINDOW.x + WINDOW.frameW / 2 + mx)
  const wy0 = Y(WINDOW.y + WINDOW.frameH / 2 + WINDOW.casingW + 0.04)
  const wy1 = Y(WINDOW.y - WINDOW.frameH / 2 - 0.16)
  ctx.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0)
  ctx.globalCompositeOperation = 'source-over'
  return colorTexture(ctx.canvas, anisotropy, false)
}

/* ---------------------------------------------------------------------
   Floor: varnished planks
   --------------------------------------------------------------------- */

/** World size of one floor tile (both axes), metres. */
export const FLOOR_TILE = 1.8

/** Varnished floorboards. One 1024² tile covers 1.8 m: twelve boards
    15 cm wide running along the canvas' y axis (world z), each with its
    own tint, grain phase and gloss, butt joints staggered, a hairline
    dark gap and a 2 mm bevel on every edge, knots and micro-scratches.
    Height drives a tangent-space normal (the bevels catch the lamp);
    roughness is a satin varnish 0.42–0.6, duller in gaps and scratches. */
export function makeFloorMaps(base: string, seed = 5, anisotropy = 8): SurfaceMaps {
  const gen = makeFloorMapsSteps(base, seed, anisotropy)
  for (;;) {
    const r = gen.next()
    if (r.done) return r.value
  }
}

/** makeFloorMaps in steps: each `yield` is a point where a staged first
    load (stage.ts) may hand the main thread back — the 1024² floor is
    the single biggest canvas in the room. Same output. */
export function* makeFloorMapsSteps(
  base: string,
  seed = 5,
  anisotropy = 8,
): Generator<void, SurfaceMaps, void> {
  const S = 1024
  const COLS = 12
  const rand = mulberry(seed)
  const [r0, g0, b0] = hexRGB(base)
  const grain = fbmField(S, seed + 1, { octaves: 2, freqX: 96, freqY: 3, persistence: 0.55 })
  const figure = fbmField(S, seed + 2, { octaves: 2, freqX: 9, freqY: 2, persistence: 0.5 })
  yield

  interface Board {
    tint: number
    hue: number
    ox: number
    oy: number
    rough: number
  }
  const colX: number[] = []
  for (let c = 0; c <= COLS; c++) colX.push(Math.round((c * S) / COLS))

  // per column: 1–2 butt joints, each segment a board of its own
  const colOf = new Uint8Array(S)
  for (let c = 0; c < COLS; c++) for (let x = colX[c]; x < colX[c + 1]; x++) colOf[x] = c
  const segAt: Uint8Array[] = []
  const jointDist: Float32Array[] = []
  const boards: Board[][] = []
  for (let c = 0; c < COLS; c++) {
    const j1 = Math.floor(rand() * S)
    const joints = [j1]
    if (rand() < 0.4) joints.push((j1 + Math.floor((0.3 + rand() * 0.35) * S)) % S)
    joints.sort((a, b) => a - b)
    const list: Board[] = joints.map(() => ({
      tint: 0.84 + rand() * 0.3,
      hue: (rand() - 0.5) * 0.09,
      ox: Math.floor(rand() * S),
      oy: Math.floor(rand() * S),
      rough: 0.44 + rand() * 0.14,
    }))
    boards.push(list)
    const seg = new Uint8Array(S)
    const dj = new Float32Array(S)
    for (let y = 0; y < S; y++) {
      // segment index: number of joints at or before y, wrapping to the last
      let idx = joints.length - 1
      for (let q = 0; q < joints.length; q++) if (joints[q] <= y) idx = q
      seg[y] = idx
      let d = S
      for (const j of joints) {
        const raw = Math.abs(y - j)
        d = Math.min(d, raw, S - raw)
      }
      dj[y] = d
    }
    segAt.push(seg)
    jointDist.push(dj)
  }

  const colour = new Uint8ClampedArray(S * S * 4)
  const height = new Float32Array(S * S)
  const rough = new Float32Array(S * S)
  const GAP = 1.0
  const BEVEL = 3.0
  for (let y = 0; y < S; y++) {
    if (y === S / 2) yield
    for (let x = 0; x < S; x++) {
      const c = colOf[x]
      const w = colX[c + 1] - colX[c]
      const lx = x - colX[c]
      const edgeX = Math.min(lx, w - 1 - lx)
      const b = boards[c][segAt[c][y]]
      const gi = ((y + b.oy) % S) * S + ((x + b.ox) % S)
      const g = grain[gi]
      const f = figure[gi]
      let lum = b.tint * (1 + (g - 0.5) * 0.34 + (f - 0.5) * 0.24)
      const d = Math.min(edgeX, jointDist[c][y])
      let h = 0.0035 * (1 - Math.pow((2 * lx) / w - 1, 2)) + (g - 0.5) * 0.0035 // gentle cupping + grain
      let r = b.rough + (g - 0.5) * 0.1
      if (d < GAP) {
        lum *= 0.1
        h = -0.06
        r = 0.95
      } else if (d < BEVEL) {
        const t = (d - GAP) / (BEVEL - GAP)
        lum *= 0.36 + 0.64 * t
        h = -0.05 * (1 - t) * (1 - t)
        r = 0.62 + 0.2 * (1 - t)
      }
      const o = (y * S + x) * 4
      colour[o] = Math.min(255, r0 * lum * (1 + b.hue))
      colour[o + 1] = Math.min(255, g0 * lum)
      colour[o + 2] = Math.min(255, b0 * lum * (1 - b.hue))
      colour[o + 3] = 255
      height[y * S + x] = h
      rough[y * S + x] = r
    }
  }

  // knots: a dark whorl with rings, dimpled and duller
  for (let i = 0; i < 9; i++) {
    const kx = Math.floor(rand() * S)
    const ky = Math.floor(rand() * S)
    const c = colOf[kx]
    const w = colX[c + 1] - colX[c]
    const lx = kx - colX[c]
    if (lx < 12 || lx > w - 12) continue
    const kr = 4 + rand() * 4
    const R = kr * 2.6
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R * 1.5; dx <= R * 1.5; dx++) {
        const px = kx + Math.round(dx)
        const py = ky + Math.round(dy)
        if (px < 0 || px >= S || py < 0 || py >= S) continue
        const q = Math.hypot(dx / 1.5, dy) / kr
        if (q > 2.6) continue
        const ring = 0.5 + 0.5 * Math.cos(q * 5.5)
        const dark = q < 1 ? 0.5 : 0.85 + 0.15 * (1 - ring) * 0.6
        const i4 = (py * S + px) * 4
        colour[i4] *= dark
        colour[i4 + 1] *= dark
        colour[i4 + 2] *= dark
        height[py * S + px] -= q < 1 ? 0.006 : 0.0015 * ring
        rough[py * S + px] = Math.min(1, rough[py * S + px] + (q < 1 ? 0.18 : 0.04))
      }
    }
  }
  // micro-scratches: mostly along the grain, duller and a touch lighter
  for (let i = 0; i < 260; i++) {
    let x = rand() * S
    let y = rand() * S
    const a = Math.PI / 2 + (rand() - 0.5) * 0.7
    const len = 10 + rand() * 46
    const lighten = 1.05 + rand() * 0.1
    for (let s = 0; s < len; s++) {
      const px = Math.floor(x + S) % S
      const py = Math.floor(y + S) % S
      const i4 = (py * S + px) * 4
      colour[i4] = Math.min(255, colour[i4] * lighten)
      colour[i4 + 1] = Math.min(255, colour[i4 + 1] * lighten)
      colour[i4 + 2] = Math.min(255, colour[i4 + 2] * lighten)
      rough[py * S + px] = Math.min(1, rough[py * S + px] + 0.22)
      height[py * S + px] -= 0.004
      x += Math.cos(a)
      y += Math.sin(a)
    }
  }

  yield
  const cctx = makeCanvas(S, S)
  cctx.putImageData(new ImageData(colour, S, S), 0, 0)
  const map = finishSurface(cctx, anisotropy)
  const normalMap = dataTexture(normalCanvas(height, S, 0.55), anisotropy)
  yield
  // the normal map does the work; SurfaceMaps still wants a bumpMap for older
  // consumers, so hand it a cheap 128² sampling of the same height
  const bumpMap = dataTexture(coarseHeight(height, S, 128), anisotropy)
  const roughnessMap = dataTexture(shrink(fieldCanvas(rough, S, 0, 1), 512), anisotropy)
  return { map, bumpMap, roughnessMap, normalMap }
}

/** A `size`² sampling of a signed S² height field, remapped to 0..1. */
function coarseHeight(h: Float32Array, S: number, size: number): HTMLCanvasElement {
  const step = S / size
  const out = new Float32Array(size * size)
  let lo = Infinity
  let hi = -Infinity
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = h[Math.floor(y * step) * S + Math.floor(x * step)]
      out[y * size + x] = v
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  const k = hi > lo ? 1 / (hi - lo) : 1
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) * k
  return fieldCanvas(out, size)
}

/** Floor wear as a decal over the 4.6 × 3.9 m plane (centred 0.1, 0.35):
    a dulled, lightened path where the chair rolls and where feet cross
    the boards, radial caster scuffs, a few spilled-dust smudges. */
export function makeFloorWear(seed = 8, W = 768, H = 652, anisotropy = 4): CanvasTexture {
  const ctx = makeCanvas(W, H)
  const rand = mulberry(seed)
  const mpp = W / 4.6
  // world (x,z) → canvas. The plane spans x −2.2…2.4, z −1.6…2.3.
  const X = (x: number) => (x + 2.2) * mpp
  const Y = (z: number) => (z + 1.6) * mpp
  // the path from the chair, out toward the door side of the room
  const path: [number, number, number][] = [
    [-0.58, 0.05, 0.55],
    [-0.35, 0.5, 0.36],
    [0.1, 0.95, 0.3],
    [0.55, 1.4, 0.3],
    [0.9, 1.95, 0.28],
  ]
  for (const [x, z, r] of path) smudge(ctx, X(x), Y(z), r * mpp, r * mpp * 0.8, '176,146,112', 0.24)
  // the strip in front of the desk where feet shuffle
  smudge(ctx, X(0.0), Y(-0.2), 0.75 * mpp, 0.16 * mpp, '176,146,112', 0.2)
  // caster arcs: thin pale scratches sweeping round the chair
  ctx.strokeStyle = 'rgba(214,190,160,0.07)'
  ctx.lineWidth = 1
  for (let i = 0; i < 46; i++) {
    const r = 0.18 + rand() * 0.5
    const a0 = rand() * Math.PI * 2
    ctx.beginPath()
    ctx.arc(X(-0.58) + (rand() - 0.5) * 8, Y(0.05) + (rand() - 0.5) * 8, r * mpp, a0, a0 + 0.2 + rand() * 0.7)
    ctx.stroke()
  }
  // dust bunnies drifting along the wall
  for (let i = 0; i < 24; i++) {
    smudge(ctx, X(-1.9 + rand() * 4), Y(-1.0 + rand() * 0.05), (0.03 + rand() * 0.05) * mpp, 0.02 * mpp, '150,140,130', 0.1)
  }
  return colorTexture(ctx.canvas, anisotropy, false)
}

/* ---------------------------------------------------------------------
   The rug: a woven wool kilim
   --------------------------------------------------------------------- */

/** Rug placement + size. Long axis along z, tucked under the chair. */
export const RUG = { w: 1.05, d: 1.24, x: -0.375, z: 0.2, yaw: 0.05, thick: 0.007 } as const

const RUG_PAL = {
  wine: '#5a1a28',
  wine2: '#702636',
  indigo: '#1d2b57',
  teal: '#1b5757',
  teal2: '#144242',
  gold: '#c7953a',
  rust: '#a4432a',
  cream: '#e3d8ba',
} as const
type RugKey = keyof typeof RUG_PAL

/** The kilim's design: which colour is the cell (i, j) of a 128 × 152 grid. */
function rugCell(i: number, j: number, GW: number, GH: number): RugKey {
  const dEdgeX = Math.min(i, GW - 1 - i)
  const dEdgeY = Math.min(j, GH - 1 - j)
  const d = Math.min(dEdgeX, dEdgeY)
  if (d < 2) return 'rust'
  if (d === 2) return 'cream'
  if (d < 5) return 'indigo'
  if (d === 5) return 'gold'
  if (d < 20) {
    // main border: a mitred zigzag with dots
    const alongX = dEdgeY <= dEdgeX
    const s = alongX ? i : j
    const r = d - 6 // 0..13
    const p = s % 14
    const tri = p < 7 ? p : 14 - p
    const rz = 3 + tri * 0.85
    if (Math.abs(r - rz) < 1.05) return 'gold'
    if (r > rz + 1) {
      if (p === 0 && r >= 10 && r <= 11) return 'cream'
      return 'teal2'
    }
    if (p === 7 && r <= 1) return 'rust'
    if (r === 12 && (p === 3 || p === 11)) return 'cream'
    return 'teal'
  }
  if (d === 20) return 'gold'
  if (d < 23) return 'indigo'
  if (d === 23) return 'cream'
  // the field
  const dx = i - (GW - 1) / 2
  const dy = j - (GH - 1) / 2
  const m = Math.abs(dx) + Math.abs(dy) * 0.78
  if (m >= 62) return 'indigo'
  if (m >= 60) return 'gold'
  const rings: [number, RugKey][] = [
    [3, 'gold'],
    [6, 'indigo'],
    [8, 'cream'],
    [12, 'wine2'],
    [14, 'gold'],
    [17, 'teal'],
    [19, 'cream'],
    [23, 'indigo'],
    [25, 'gold'],
  ]
  for (const [lim, key] of rings) if (m < lim) return key
  if (m < 30) return 'wine'
  // a lattice of small stars across the open field
  const li = (i + (Math.floor(j / 12) % 2 === 0 ? 0 : 6)) % 12
  const lj = j % 12
  if (li === 6 && lj === 6) return 'cream'
  if ((li === 6 && (lj === 5 || lj === 7)) || (lj === 6 && (li === 5 || li === 7))) return 'gold'
  return m > 40 && i % 12 === 3 && j % 12 === 9 ? 'rust' : 'wine'
}

/** Colour + weave for the rug. `map` is the 768 × 912 design (LINEAR,
    mip-mapped); the tiled weave normal/roughness come from the toolkit's
    fabricMaps and are repeated per thread pitch by the caller. */
export function makeRugMaps(seed = 3, anisotropy = 8): {
  map: CanvasTexture
  weave: PbrMaps
} {
  const GW = 128
  const GH = 152
  const CELL = 6
  const W = GW * CELL
  const H = GH * CELL
  const rand = mulberry(seed)
  const pal = Object.fromEntries(
    (Object.keys(RUG_PAL) as RugKey[]).map((k) => [k, hexRGB(RUG_PAL[k])]),
  ) as Record<RugKey, [number, number, number]>
  // abrash: each weft row is dyed a hair differently
  const rowK = new Float32Array(GH)
  for (let j = 0; j < GH; j++) rowK[j] = 1 + (rand() - 0.5) * 0.07
  const colK = new Float32Array(GW)
  for (let i = 0; i < GW; i++) colK[i] = 1 + (rand() - 0.5) * 0.03
  const cloud = fbmField(128, seed + 2, { octaves: 4, freq: 3, persistence: 0.55 })
  // the design, resolved once per cell — not once per pixel
  const cells = new Uint8Array(GW * GH * 3)
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const c = pal[rugCell(i, j, GW, GH)]
      const o = (j * GW + i) * 3
      cells[o] = c[0]
      cells[o + 1] = c[1]
      cells[o + 2] = c[2]
    }
  }
  const ctx = makeCanvas(W, H)
  const img = ctx.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    const j = (y / CELL) | 0
    const fy = (y / H - 0.42) * 2
    for (let x = 0; x < W; x++) {
      const i = (x / CELL) | 0
      const co = (j * GW + i) * 3
      // thread structure: warp every 3 px, weft every 3 px, plus noise
      const thread = (x % 3 === 0 ? 0.96 : 1) * (y % 3 === 0 ? 0.97 : 1) * (0.97 + rand() * 0.06)
      const cl = cloud[(((y * 128) / H) | 0) * 128 + (((x * 128) / W) | 0)]
      let k = rowK[j] * colK[i] * thread * (0.94 + cl * 0.12)
      // the middle is where feet and casters live: faded and dusty
      const fx = (x / W - 0.5) * 2
      const wear = 0.14 * Math.exp(-(fx * fx * 1.6 + fy * fy * 1.1) * 1.4)
      k *= 1 - wear * 0.2
      const o = (y * W + x) * 4
      img.data[o] = Math.min(255, cells[co] * k + wear * 46)
      img.data[o + 1] = Math.min(255, cells[co + 1] * k + wear * 38)
      img.data[o + 2] = Math.min(255, cells[co + 2] * k + wear * 30)
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const map = colorTexture(ctx.canvas, anisotropy)
  map.wrapS = map.wrapT = RepeatWrapping
  const weave = fabricMaps(seed + 5, 256, 1, 12)
  // one 256 px tile ≈ 4 cm of wool: 12 threads at ~3.3 mm
  weave.normalMap.repeat.set(RUG.w / 0.04, RUG.d / 0.04)
  weave.roughnessMap.repeat.set(RUG.w / 0.04, RUG.d / 0.04)
  return { map, weave }
}

/** The rug slab: a rounded rectangle, 7 mm thick, lying flat with its top
    at y = thick. UVs run 0..1 across the top so the design maps 1:1. */
export function rugGeo(): BufferGeometry {
  const geo = plateGeo(RUG.w, RUG.d, RUG.thick, 0.02, 0.0016, 2)
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / RUG.w + 0.5, pos.getY(i) / RUG.d + 0.5)
  }
  uv.needsUpdate = true
  geo.rotateX(-Math.PI / 2)
  return geo
}

/** Fringe: thin strands at both short ends, three per tassel, each with
    its own splay, length and a touch of colour. Lies flat on the floor. */
export function buildFringe(seed = 4): InstancedMesh {
  const strand = new PlaneGeometry(0.0036, 0.052)
  strand.rotateX(-Math.PI / 2)
  strand.translate(0, 0, 0.026) // origin at the rug edge, runs outward (+z)
  const tassels = 86
  const count = tassels * 3 * 2
  const mat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, side: DoubleSide })
  const mesh = new InstancedMesh(strand, mat, count)
  const rand = mulberry(seed)
  const dummy = new Object3D()
  const col = new Color()
  let n = 0
  for (const end of [1, -1]) {
    for (let t = 0; t < tassels; t++) {
      const cx = -RUG.w / 2 + 0.012 + (t / (tassels - 1)) * (RUG.w - 0.024)
      const bunchAngle = (rand() - 0.5) * 0.14
      for (let s = 0; s < 3; s++) {
        dummy.position.set(
          cx + (s - 1) * 0.0022 + (rand() - 0.5) * 0.0012,
          0.0013 + rand() * 0.0006,
          end * (RUG.d / 2 - 0.006),
        )
        dummy.rotation.set(0, (end === 1 ? 0 : Math.PI) + bunchAngle + (s - 1) * 0.05 + (rand() - 0.5) * 0.06, 0)
        dummy.scale.set(1, 1, 0.82 + rand() * 0.34)
        dummy.updateMatrix()
        mesh.setMatrixAt(n, dummy.matrix)
        const v = 0.86 + rand() * 0.14
        mesh.setColorAt(n, col.set('#b7ad92').multiplyScalar(v))
        n++
      }
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  return mesh
}

/* ---------------------------------------------------------------------
   Wood grain (frames, shelf boards): long grain along the texture's u
   --------------------------------------------------------------------- */

export interface GrainMaps {
  map: CanvasTexture
  normalMap: CanvasTexture
  roughnessMap: CanvasTexture
  dispose: () => void
}

/** Varnished long-grain wood: fine streaks along u, broad figure, a few
    pores. Colour, normal and roughness at 256²; the caller sets repeat. */
export function makeGrainMaps(base: string, seed = 2, size = 256, anisotropy = 8): GrainMaps {
  const [r0, g0, b0] = hexRGB(base)
  const streak = fbmField(size, seed, { octaves: 4, freqX: 2, freqY: 44, persistence: 0.62 })
  const figure = fbmField(size, seed + 1, { octaves: 3, freqX: 3, freqY: 7, persistence: 0.55 })
  const pores = fbmField(size, seed + 2, { octaves: 2, freqX: 30, freqY: 120, persistence: 0.6 })
  const ctx = makeCanvas(size, size)
  const img = ctx.createImageData(size, size)
  const height = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  for (let i = 0; i < size * size; i++) {
    const k = 0.78 + streak[i] * 0.4 + (figure[i] - 0.5) * 0.28 - pores[i] * 0.06
    img.data[i * 4] = Math.min(255, r0 * k)
    img.data[i * 4 + 1] = Math.min(255, g0 * k)
    img.data[i * 4 + 2] = Math.min(255, b0 * k)
    img.data[i * 4 + 3] = 255
    height[i] = streak[i] * 0.6 + pores[i] * 0.4
    rough[i] = 0.4 + pores[i] * 0.35 + (1 - streak[i]) * 0.1
  }
  ctx.putImageData(img, 0, 0)
  const map = colorTexture(ctx.canvas, anisotropy)
  const normalMap = dataTexture(normalCanvas(height, size, 0.7), anisotropy)
  const roughnessMap = dataTexture(fieldCanvas(rough, size, 0, 1), anisotropy)
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

/* ---------------------------------------------------------------------
   Framed prints
   --------------------------------------------------------------------- */

export interface PosterGeo {
  /** the moulded frame (mitred sweep) */
  frame: BufferGeometry
  /** mat face + its 45° bevel cut */
  mat: BufferGeometry
  /** the frame's inner opening = mat outer = glass size */
  openW: number
  openH: number
  outerW: number
  outerH: number
  /** z layers, from the wall */
  z: { print: number; mat: number; glass: number; depth: number }
}

const METAL_FRAME: ProfilePt[] = [
  [0.0124, 0.004],
  [0.0124, 0.0185],
  [0.01, 0.0215],
  [0.0015, 0.0215],
  [0.0, 0.0195],
  [0.0, 0.0],
]
const WOOD_FRAME: ProfilePt[] = [
  [0.022, 0.006],
  [0.022, 0.0165],
  [0.0205, 0.0195],
  [0.0158, 0.0195],
  [0.0136, 0.0172, 1],
  [0.0112, 0.0164, 1],
  [0.0092, 0.0178, 1],
  [0.0078, 0.0212],
  [0.0056, 0.0236, 1],
  [0.003, 0.0226, 1],
  [0.0, 0.0195],
  [0.0, 0.0],
]

/** A framed print: `w × h` is the visible art. Matted with a 3 mm 45°
    bevel; the frame is a real mitred moulding. Group origin = the wall
    plane, centre of the frame. */
export function posterGeo(
  w: number,
  h: number,
  kind: 'metal' | 'wood',
  matBorder: number,
): PosterGeo {
  const bevel = 0.003
  const faceW = w + bevel * 2
  const faceH = h + bevel * 2
  const openW = faceW + matBorder * 2
  const openH = faceH + matBorder * 2
  const fw = kind === 'metal' ? 0.0124 : 0.022
  const outerW = openW + fw * 2
  const outerH = openH + fw * 2
  const rect = (rw: number, rh: number): [number, number][] => [
    [-rw / 2, -rh / 2],
    [rw / 2, -rh / 2],
    [rw / 2, rh / 2],
    [-rw / 2, rh / 2],
  ]
  const frame = sweep(kind === 'metal' ? METAL_FRAME : WOOD_FRAME, rect(outerW, outerH), {
    mode: 'wall',
    closed: true,
  })
  const matZ = 0.0125
  const shape = new Shape()
  shape.moveTo(-openW / 2, -openH / 2)
  shape.lineTo(openW / 2, -openH / 2)
  shape.lineTo(openW / 2, openH / 2)
  shape.lineTo(-openW / 2, openH / 2)
  shape.closePath()
  const hole = new Shape()
  hole.moveTo(-faceW / 2, -faceH / 2)
  hole.lineTo(-faceW / 2, faceH / 2)
  hole.lineTo(faceW / 2, faceH / 2)
  hole.lineTo(faceW / 2, -faceH / 2)
  hole.closePath()
  shape.holes.push(hole)
  const face = new ShapeGeometry(shape)
  face.translate(0, 0, matZ)
  const cut = sweep(
    [
      [bevel, matZ - bevel],
      [0, matZ],
    ],
    rect(faceW, faceH),
    { mode: 'wall', closed: true },
  )
  return {
    frame,
    mat: weld([face, cut]),
    openW,
    openH,
    outerW,
    outerH,
    z: { print: 0.0075, mat: matZ, glass: 0.0165, depth: kind === 'metal' ? 0.0215 : 0.0236 },
  }
}

/* ---------------------------------------------------------------------
   Wall socket and light switch
   --------------------------------------------------------------------- */

const PLATE = '#b7b1a2'
const INSERT = '#9d9888'
const HOLE = '#0d0c0b'

/** Double socket, 90 × 130 mm: a bevelled plate with two real cut-outs,
    an insert sunk behind each, three pin holes, two screws. Back on z=0,
    front on z=0.012. `plate` / `dark` are two materials. */
export function socketGeo(): { plate: BufferGeometry; dark: BufferGeometry } {
  const w = 0.09
  const h = 0.13
  const t = 0.012
  const bevel = 0.0016
  const outer = roundedRectShape(w - 2 * bevel, h - 2 * bevel, 0.006)
  for (const y of [0.028, -0.028]) {
    outer.holes.push(roundedRectShape(0.05 + 2 * bevel, 0.045 + 2 * bevel, 0.007, 0, y))
  }
  const plate = new ExtrudeGeometry(outer, {
    depth: t - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  })
  plate.translate(0, 0, bevel)
  const parts: BufferGeometry[] = []
  const inserts: BufferGeometry[] = []
  for (const y of [0.028, -0.028]) {
    inserts.push(tint(place(rbox(0.05, 0.045, 0.004, 0.002, 1), 0, y, 0.0045), INSERT))
    // earth (top) and two pins (bottom), sunk into the insert
    for (const [hx, hy, hr] of [
      [0, 0.011, 0.0031],
      [-0.0115, -0.009, 0.0024],
      [0.0115, -0.009, 0.0024],
    ] as const) {
      const c = new CylinderGeometry(hr, hr, 0.001, 10)
      c.rotateX(Math.PI / 2)
      inserts.push(tint(place(c, hx, y + hy, 0.0067), HOLE))
    }
  }
  for (const y of [0.0578, -0.0578]) {
    const s = new CylinderGeometry(0.0034, 0.0034, 0.0016, 12)
    s.rotateX(Math.PI / 2)
    parts.push(tint(place(s, 0, y, t + 0.0002), '#8d8b85'))
    // slot
    parts.push(tint(place(rbox(0.006, 0.0007, 0.0004, 0.0002, 1), 0, y, t + 0.001, 0, 0, 0.5), HOLE))
  }
  return { plate, dark: weld([...inserts, ...parts]) }
}

/** Single light switch plate, 86 × 86 mm, with a rocker and two screws.
    Back on z=0. `plate` is beige plastic; `dark` the screws and slots. */
export function switchGeo(): { plate: BufferGeometry; dark: BufferGeometry } {
  const t = 0.01
  const plate = weld([
    tint(plateGeo(0.086, 0.086, t, 0.006, 0.0016, 2), PLATE),
    // the rocker: a tilted bevelled paddle in a shallow surround
    tint(place(rbox(0.038, 0.056, 0.004, 0.0025, 2), 0, 0, t + 0.0005), '#a8a293'),
    tint(place(rbox(0.026, 0.044, 0.007, 0.003, 2), 0, 0.001, t + 0.0035, -0.09), PLATE),
  ])
  const dark: BufferGeometry[] = []
  for (const y of [0.0345, -0.0345]) {
    const s = new CylinderGeometry(0.0032, 0.0032, 0.0016, 12)
    s.rotateX(Math.PI / 2)
    dark.push(tint(place(s, 0, y, t + 0.0002), '#8d8b85'))
    dark.push(tint(place(rbox(0.0055, 0.0006, 0.0004, 0.0002, 1), 0, y, t + 0.001, 0, 0, -0.4), HOLE))
  }
  return { plate, dark: weld(dark) }
}

/* ---------------------------------------------------------------------
   The wall shelf: board, brackets, books, trophy, floppies
   --------------------------------------------------------------------- */

/** Box-project UVs in metres (top → x/z, front/back → x/y, ends → z/y). */
export function boxUV(geo: BufferGeometry, scale = 1): BufferGeometry {
  const p = geo.attributes.position
  const n = geo.attributes.normal
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i))
    const ay = Math.abs(n.getY(i))
    const az = Math.abs(n.getZ(i))
    let u: number
    let v: number
    if (ay >= ax && ay >= az) {
      u = p.getX(i)
      v = p.getZ(i)
    } else if (az >= ax) {
      u = p.getX(i)
      v = p.getY(i)
    } else {
      u = p.getZ(i)
      v = p.getY(i)
    }
    uv[i * 2] = u * scale
    uv[i * 2 + 1] = v * scale
  }
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  return geo
}

/** A 0.68 m board with a bullnose front and softly bevelled ends. Centred
    on the origin (x along its length), like the box it replaces. */
export function shelfBoardGeo(len = 0.68, depth = 0.21, thick = 0.026): BufferGeometry {
  const bs = 0.0025
  const zb = -depth / 2 + bs
  const zf = depth / 2 - bs
  const yt = thick / 2 - bs
  const yb = -thick / 2 + bs
  const s = new Shape()
  s.moveTo(zb, yb)
  s.lineTo(zf - 0.005, yb)
  s.absarc(zf - 0.005, yb + 0.005, 0.005, -Math.PI / 2, 0, false)
  s.lineTo(zf, yt - 0.007)
  s.absarc(zf - 0.007, yt - 0.007, 0.007, 0, Math.PI / 2, false)
  s.lineTo(zb, yt)
  s.closePath()
  const geo = new ExtrudeGeometry(s, {
    depth: len - 0.006,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: bs,
    bevelSegments: 2,
    curveSegments: 6,
  })
  geo.translate(0, 0, -(len - 0.006) / 2)
  geo.rotateY(-Math.PI / 2)
  return boxUV(geo, 1)
}

/** Pairs of gallows brackets with wall plates and screws, one geometry.
    Group coordinates: the wall face is at local z = −0.11. */
export function bracketsGeo(xs: number[]): BufferGeometry {
  const parts: BufferGeometry[] = []
  const iron = '#26272c'
  const steel = '#93959b'
  for (const bx of xs) {
    const tri = new Shape()
    tri.moveTo(-0.1065, -0.013)
    tri.lineTo(0.088, -0.013)
    tri.lineTo(-0.1065, -0.108)
    tri.closePath()
    const cut = new Shape()
    cut.moveTo(-0.099, -0.0205)
    cut.lineTo(0.0551, -0.0205)
    cut.lineTo(-0.099, -0.0955)
    cut.closePath()
    tri.holes.push(cut)
    const brace = new ExtrudeGeometry(tri, {
      depth: 0.009,
      bevelEnabled: true,
      bevelThickness: 0.0012,
      bevelSize: 0.0007,
      bevelSegments: 1,
      curveSegments: 4,
    })
    brace.translate(0, 0, -0.0045)
    brace.rotateY(-Math.PI / 2)
    parts.push(tint(place(brace, bx, 0, 0), iron))
    // wall plate + two screws
    const plate = plateGeo(0.026, 0.1, 0.0035, 0.004, 0.0008, 1)
    parts.push(tint(place(plate, bx, -0.066, -0.11), iron))
    for (const y of [-0.03, -0.102]) {
      const sc = new CylinderGeometry(0.0034, 0.0034, 0.0022, 12)
      sc.rotateX(Math.PI / 2)
      parts.push(tint(place(sc, bx, y, -0.1066), steel))
    }
  }
  return weld(parts)
}

/** Decorative spines: a book is [colour, title?]. Titles are generic. */
export interface BookSpec {
  color: string
  title?: string
  foil?: string
}

export const SHELF_BOOKS: BookSpec[] = [
  { color: '#7a3b2e', title: 'NOTES', foil: '#c9a24a' },
  { color: '#31504a', foil: '#b9b28f' },
  { color: '#8a6d3b', title: 'ATLAS', foil: '#2d2416' },
  { color: '#26364a', title: 'VOL 2', foil: '#c9a24a' },
  { color: '#5b3a56', foil: '#d3c08a' },
  { color: '#3d5a2e', title: 'STATS', foil: '#d9c58a' },
  { color: '#a0522d', foil: '#f0dfb0' },
  { color: '#264a44', title: 'LOGS', foil: '#c9a24a' },
  { color: '#413a5e', title: 'PROOFS', foil: '#d0b56a' },
]

const ATLAS_W = 1024
const ATLAS_H = 512
const CELL_H = 448

/** One atlas holds every spine (cloth weave, foil bands, a title) plus a
    strip of page-paper. Books map their spine and covers into it. */
function makeBookAtlas(specs: BookSpec[], seed = 7): CanvasTexture {
  const ctx = makeCanvas(ATLAS_W, ATLAS_H)
  const rand = mulberry(seed)
  const cw = Math.floor(ATLAS_W / specs.length)
  const img = ctx.createImageData(ATLAS_W, ATLAS_H)
  const d = img.data
  specs.forEach((sp, i) => {
    const x0 = i * cw
    const [r, g, b] = hexRGB(sp.color)
    // cloth: fine thread dither, shaded toward the hinges like a rounded spine
    for (let y = 0; y < CELL_H; y++) {
      const row = y % 2 === 0 ? 0.02 : -0.02
      for (let x = 0; x < cw; x++) {
        const k = 0.93 + rand() * 0.1 + row
        const e = Math.min(x, cw - 1 - x) / (cw * 0.22)
        const edge = e >= 1 ? 1 : 0.7 + 0.3 * e
        const o = (y * ATLAS_W + x0 + x) * 4
        d[o] = Math.min(255, r * k * edge)
        d[o + 1] = Math.min(255, g * k * edge)
        d[o + 2] = Math.min(255, b * k * edge)
        d[o + 3] = 255
      }
    }
  })
  // paper strip for the page blocks (and the ground for unused pixels)
  for (let y = CELL_H; y < ATLAS_H; y++) {
    for (let x = 0; x < ATLAS_W; x++) {
      const k = 0.92 + rand() * 0.06 + (y % 3 === 0 ? -0.05 : 0)
      const o = (y * ATLAS_W + x) * 4
      d[o] = 226 * k
      d[o + 1] = 218 * k
      d[o + 2] = 196 * k
      d[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  specs.forEach((sp, i) => {
    const x0 = i * cw
    const foil = sp.foil ?? '#c9a24a'
    ctx.fillStyle = foil
    for (const y of [24, 32, CELL_H - 62, CELL_H - 54]) ctx.fillRect(x0 + 12, y, cw - 24, 3)
    if (sp.title) {
      // a paper label with the title running top to bottom
      ctx.fillStyle = 'rgba(232,224,200,0.94)'
      ctx.fillRect(x0 + 12, 60, cw - 24, 158)
      ctx.strokeStyle = 'rgba(40,30,20,0.55)'
      ctx.lineWidth = 2
      ctx.strokeRect(x0 + 15, 63, cw - 30, 152)
      ctx.save()
      ctx.translate(x0 + cw / 2 + 8, 72 + (140 - pixelTextWidth(sp.title) * 3) / 2)
      ctx.rotate(Math.PI / 2)
      drawPixelText(ctx, sp.title, 0, 0, 3, '#231a12')
      ctx.restore()
    } else {
      // a small foil ornament
      ctx.fillStyle = foil
      ctx.fillRect(x0 + cw / 2 - 2, 108, 4, 24)
      ctx.fillRect(x0 + cw / 2 - 12, 118, 24, 4)
    }
  })
  return colorTexture(ctx.canvas, 8, false)
}

/** Map a part's UVs into the book atlas: `front` vertices (normal +z on
    the spine board) get the spine cell, everything else the plain cloth. */
function bookUV(
  geo: BufferGeometry,
  cell: number,
  cells: number,
  w: number,
  h: number,
  mode: 'spine' | 'cloth' | 'paper',
): BufferGeometry {
  const p = geo.attributes.position
  const n = geo.attributes.normal
  const uv = new Float32Array(p.count * 2)
  const cw = Math.floor(ATLAS_W / cells)
  for (let i = 0; i < p.count; i++) {
    let px: number
    let py: number
    if (mode === 'paper') {
      px = 10 + (p.getX(i) * 4000) % 150
      py = CELL_H + 12 + ((p.getY(i) * 4000) % 40)
    } else if (mode === 'spine' && n.getZ(i) > 0.55) {
      px = cell * cw + 1 + ((p.getX(i) + w / 2) / w) * (cw - 2)
      py = CELL_H - 1 - ((p.getY(i) + h / 2) / h) * (CELL_H - 2)
    } else {
      // plain cloth: the bottom margin of the spine cell
      px = cell * cw + cw / 2 + ((p.getZ(i) * 900) % (cw * 0.3))
      py = CELL_H - 30 + ((p.getY(i) * 900) % 12)
    }
    uv[i * 2] = px / ATLAS_W
    uv[i * 2 + 1] = 1 - py / ATLAS_H
  }
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  return geo
}

/** Ten hardbacks on the wall shelf: real covers overhanging the page
    block, a rounded spine board, and the last one leaning on the binders.
    Local space: x from 0 along the shelf, y from the board's top. One
    geometry, one material, one atlas. */
export function buildShelfBooks(): { geometry: BufferGeometry; atlas: CanvasTexture } {
  const specs = SHELF_BOOKS
  const atlas = makeBookAtlas(specs)
  const rand = mulberry(31)
  const parts: BufferGeometry[] = []
  const N = specs.length
  let x = 0
  const bookDims = (i: number) => ({
    w: 0.024 + ((i * 7) % 5) * 0.004,
    h: 0.13 + ((i * 5) % 7) * 0.009,
    d: 0.14 + ((i * 3) % 4) * 0.008,
  })
  const makeBook = (i: number): BufferGeometry => {
    const { w, h, d } = bookDims(i)
    const ps: BufferGeometry[] = []
    const spine = bookUV(rbox(w, h, 0.0034, 0.0016, 1), i, N, w, h, 'spine')
    place(spine, 0, 0, d / 2 - 0.0017)
    ps.push(spine)
    for (const s of [-1, 1]) {
      const cover = bookUV(new BoxGeometry(0.0028, h, d), i, N, w, h, 'cloth')
      place(cover, s * (w / 2 - 0.0014), 0, 0)
      ps.push(cover)
    }
    const block = bookUV(new BoxGeometry(w - 0.0056, h - 0.0074, d - 0.0056), i, N, w, h, 'paper')
    place(block, 0, 0, -0.0006)
    ps.push(block)
    return weld(ps)
  }
  for (let i = 0; i < N - 1; i++) {
    const { w, h } = bookDims(i)
    const g = makeBook(i)
    // a little pulled-forward / pushed-back, the way books actually sit
    place(g, x + w / 2, h / 2, -0.012 + (rand() - 0.5) * 0.014)
    parts.push(g)
    x += w + 0.003
  }
  // the last one leans right against the first binder
  {
    const i = N - 1
    const { w, h } = bookDims(i)
    const g = makeBook(i)
    const lean = 0.28
    place(g, -w / 2, h / 2, 0) // pivot: bottom-right corner at the origin
    g.rotateZ(-lean)
    // the top-right corner rests on the first binder's face (shelf x 0.064)
    place(g, 0.31 + 0.064 - 0.001 - h * Math.sin(lean), 0, -0.012)
    parts.push(g)
  }
  return { geometry: weld(parts), atlas }
}

/** The trophy: a stepped plinth (with a plate the caller textures) and a
    gold loving cup with handles, turned on a lathe. */
export const TROPHY = { plateW: 0.038, plateH: 0.0075, plateY: 0.005, plateZ: 0.0242 } as const

export function trophyGeo(): { plinth: BufferGeometry; gold: BufferGeometry } {
  const plinth = weld([
    place(rbox(0.048, 0.01, 0.048, 0.0015, 2), 0, 0.005, 0),
    place(rbox(0.036, 0.006, 0.036, 0.001, 2), 0, 0.013, 0),
  ])
  const prof: [number, number][] = [
    [0.0, 0.016],
    [0.0125, 0.016],
    [0.0125, 0.0175],
    [0.01, 0.019],
    [0.0045, 0.0215],
    [0.0032, 0.024],
    [0.0032, 0.027],
    [0.0058, 0.0295],
    [0.0058, 0.0315],
    [0.0032, 0.034],
    [0.0034, 0.037],
    [0.0075, 0.0395],
    [0.0125, 0.046],
    [0.0158, 0.0535],
    [0.0172, 0.059],
    [0.0165, 0.0592],
    [0.0155, 0.0578],
    [0.0122, 0.0505],
    [0.0072, 0.0435],
    [0.0, 0.0415],
  ]
  const cup = new LatheGeometry(prof.map(([r, y]) => new Vector2(r, y)), 24)
  const parts: BufferGeometry[] = [cup]
  for (const s of [-1, 1]) {
    const curve = new CatmullRomCurve3([
      new Vector3(s * 0.0152, 0.0525, 0),
      new Vector3(s * 0.0225, 0.0535, 0),
      new Vector3(s * 0.0262, 0.0465, 0),
      new Vector3(s * 0.0218, 0.0405, 0),
      new Vector3(s * 0.0098, 0.0398, 0),
    ])
    parts.push(new TubeGeometry(curve, 14, 0.0012, 6))
  }
  return { plinth, gold: weld(parts) }
}

/** Three 3.5" floppies lying in a slightly skewed stack: navy, slate and
    oxblood shells, a steel shutter on the front edge, a paper label.
    One geometry with vertex colours. Origin: centre of the bottom disk's
    underside. */
export function floppyStackGeo(): BufferGeometry {
  const shells = ['#2a3a86', '#3a3d44', '#8a2f2b']
  const rot = [0, 0.24, -0.17]
  const off: [number, number][] = [
    [0, 0],
    [0.004, -0.003],
    [-0.003, 0.004],
  ]
  const parts: BufferGeometry[] = []
  shells.forEach((c, k) => {
    const g: BufferGeometry[] = [
      tint(rbox(0.0902, 0.0034, 0.094, 0.0013, 2), c),
      tint(place(rbox(0.0262, 0.0038, 0.0195, 0.0007, 1), 0.0102, 0, 0.0372), '#b6b9c2'),
      tint(place(rbox(0.006, 0.0039, 0.013, 0.0003, 1), 0.0135, 0, 0.0372), '#1c1d22'),
      tint(place(rbox(0.0625, 0.0009, 0.0415, 0.0004, 1), 0, 0.0018, -0.0198), '#d8d2bd'),
      tint(place(rbox(0.0625, 0.001, 0.0012, 0.0004, 1), 0, 0.0021, -0.0298), '#5b6fb5'),
    ]
    const merged = weld(g)
    merged.rotateY(rot[k])
    place(merged, off[k][0], 0.0017 + k * 0.0035, off[k][1])
    parts.push(merged)
  })
  return weld(parts)
}


/* ---------------------------------------------------------------------
   Glass sheen — two soft diagonal streaks of window light on a print's
   pane. Used as an emissive map on a black, additive glass material, so
   it only ever ADDS light: a hint of reflection at any camera angle.
   --------------------------------------------------------------------- */
export function makeGlassSheen(): CanvasTexture {
  const ctx = makeCanvas(128, 128)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 128, 128)
  const g = ctx.createLinearGradient(0, 0, 128, 128)
  g.addColorStop(0.0, 'rgb(0,0,0)')
  g.addColorStop(0.24, 'rgb(0,0,0)')
  g.addColorStop(0.32, 'rgb(150,160,180)')
  g.addColorStop(0.4, 'rgb(0,0,0)')
  g.addColorStop(0.5, 'rgb(0,0,0)')
  g.addColorStop(0.55, 'rgb(70,78,92)')
  g.addColorStop(0.6, 'rgb(0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  // brighter toward the top, like the ceiling and window it mirrors
  const v = ctx.createLinearGradient(0, 0, 0, 128)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.6)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, 128, 128)
  return colorTexture(ctx.canvas, 4, false)
}

/* =====================================================================
   SET DRESSING — the things a person who lives here would own
   ===================================================================== */

/* ---------------------------------------------------------------------
   A rubber plant: glossy oval leaves, turned terracotta pot
   --------------------------------------------------------------------- */

/** One leaf, base at the origin, pointing +z, upper face +y: an acuminate
    oval with a folded midrib and a drooping tip. 6 × 10 quads. */
export function leafGeometry(len = 0.26, wid = 0.12, rows = 8, cols = 4): BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  for (let r = 0; r <= rows; r++) {
    const t = r / rows
    const hw = (wid / 2) * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.9) * (1 - 0.1 * t)
    for (let c = 0; c <= cols; c++) {
      const s = (c / cols) * 2 - 1
      const x = s * hw
      const y = 0.3 * Math.abs(x) - 0.2 * len * t * t + 0.02 * len * Math.sin(Math.PI * t)
      pos.push(x, y, t * len)
      uv.push(c / cols, t)
    }
  }
  const idx: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c
      const b = a + 1
      const d = a + cols + 1
      idx.push(a, d, b, b, d, d + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Leaf skin: deep green, a pale midrib, fine parallel side veins. */
export function makeLeafTexture(seed = 3): CanvasTexture {
  const W = 128
  const H = 256
  const ctx = makeCanvas(W, H)
  const rand = mulberry(seed)
  const g = ctx.createLinearGradient(0, H, 0, 0)
  g.addColorStop(0, '#2a5a30')
  g.addColorStop(0.6, '#1d4a29')
  g.addColorStop(1, '#173d24')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // canvas y is flipped relative to v: the base is at the bottom
  ctx.strokeStyle = 'rgba(150,190,120,0.34)'
  ctx.lineWidth = 1
  for (let y = 10; y < H - 6; y += 7) {
    for (const s of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(W / 2, y + 6)
      ctx.quadraticCurveTo(W / 2 + s * W * 0.22, y + 2, W / 2 + s * W * 0.46, y - 12)
      ctx.stroke()
    }
  }
  ctx.strokeStyle = 'rgba(190,215,150,0.75)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(W / 2, H)
  ctx.lineTo(W / 2, 0)
  ctx.stroke()
  // mottling and a few blemishes
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? '10,30,14' : '90,130,70'},${0.05 + rand() * 0.07})`
    ctx.fillRect(rand() * W, rand() * H, 2 + rand() * 6, 2 + rand() * 6)
  }
  return colorTexture(ctx.canvas, 4, false)
}

/** Leaf placements for the plant: golden-angle spiral up a slightly bent
    stem; lower leaves droop, upper ones reach. Returns the stem points and
    the per-leaf matrices/colours, ready for an InstancedMesh. */
export function plantLayout(seed = 12, count = 24): {
  stem: Vector3[]
  leaves: { matrix: Matrix4; shade: number }[]
} {
  const rand = mulberry(seed)
  const stem: Vector3[] = []
  const H = 0.78
  const at = (t: number) => new Vector3(0.028 * Math.sin(t * 3.1), t * H, 0.018 * Math.sin(t * 2.3 + 1))
  for (let i = 0; i <= 12; i++) stem.push(at(i / 12))
  const leaves: { matrix: Matrix4; shade: number }[] = []
  const e = new Euler(0, 0, 0, 'YXZ')
  const q = new Quaternion()
  const s = new Vector3()
  const m = new Matrix4()
  for (let k = 0; k < count; k++) {
    const t = 0.32 + (k / (count - 1)) * 0.68
    const yaw = k * 2.399963 + rand() * 0.3
    const up = -0.35 + Math.pow(k / (count - 1), 0.8) * 1.35 // droop → reach
    const p = at(t)
    // petiole: a short reach out along the leaf's heading
    p.x += Math.sin(yaw) * 0.02
    p.z += Math.cos(yaw) * 0.02
    e.set(-up + (rand() - 0.5) * 0.2, yaw, (rand() - 0.5) * 0.3, 'YXZ')
    q.setFromEuler(e)
    const sc = (1.05 - 0.4 * (k / (count - 1))) * (0.88 + rand() * 0.24)
    s.set(sc, sc, sc)
    m.compose(p, q, s)
    leaves.push({ matrix: m.clone(), shade: 0.8 + rand() * 0.35 })
  }
  return { stem, leaves }
}

/** Terracotta pot (lathe) with a fat rim, over its saucer — both neither
    map nor differ by anything but flat colour, so they weld into ONE
    vertex-coloured mesh (was two draw calls / two materials). The pot's
    +0.012 lift (it used to sit in its own offset group) is baked into
    its geometry so the merge stays a single static transform. */
export function potGeo(): BufferGeometry {
  const outer: [number, number][] = [
    [0.0, 0.0],
    [0.068, 0.0],
    [0.072, 0.005],
    [0.088, 0.06],
    [0.102, 0.15],
    [0.108, 0.176],
    [0.118, 0.181],
    [0.121, 0.194],
    [0.118, 0.203],
    [0.11, 0.205],
    [0.106, 0.198],
    [0.1, 0.188],
    [0.0, 0.186],
  ]
  const pot = new LatheGeometry(outer.map(([r, y]) => new Vector2(r, y)), 40)
  tint(pot, '#b4643b')
  place(pot, 0, 0.012, 0)
  const dish: [number, number][] = [
    [0.0, 0.0],
    [0.1, 0.0],
    [0.116, 0.004],
    [0.132, 0.02],
    [0.135, 0.023],
    [0.128, 0.024],
    [0.112, 0.01],
    [0.0, 0.008],
  ]
  const saucer = new LatheGeometry(dish.map(([r, y]) => new Vector2(r, y)), 40)
  tint(saucer, '#8f4c2c')
  return weld([pot, saucer])
}

/* ---------------------------------------------------------------------
   Cork board and its pinned cards
   --------------------------------------------------------------------- */

export interface CorkMaps {
  map: CanvasTexture
  normalMap: CanvasTexture
  dispose: () => void
}

/** Natural cork: tan granules of every size, dark flecks, pits. 0.44 × 0.30 m. */
export function makeCorkMaps(seed = 6): CorkMaps {
  const W = 512
  const H = 352
  const ctx = makeCanvas(W, H, true)
  const rand = mulberry(seed)
  ctx.fillStyle = '#9c7145'
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 7000; i++) {
    const r = 0.8 + rand() * rand() * 3.4
    const light = rand()
    ctx.fillStyle =
      light < 0.4
        ? `rgba(196,152,100,${0.3 + rand() * 0.25})`
        : light < 0.8
          ? `rgba(122,82,46,${0.25 + rand() * 0.25})`
          : `rgba(70,42,22,${0.2 + rand() * 0.25})`
    ctx.beginPath()
    ctx.ellipse(rand() * W, rand() * H, r * (0.8 + rand() * 0.6), r, rand() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(36,22,12,${0.3 + rand() * 0.4})`
    ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 2, 1 + rand() * 2)
  }
  const map = colorTexture(ctx.canvas, 8, false)
  // height from luminance, then a normal map from it
  const img = ctx.getImageData(0, 0, W, H).data
  const hgt = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) hgt[i] = (img[i * 4] + img[i * 4 + 1]) / 510
  const n = normalCanvasRect(hgt, W, H, 0.7)
  const normalMap = dataTexture(n, 8)
  normalMap.wrapS = normalMap.wrapT = ClampToEdgeWrapping
  return { map, normalMap, dispose: () => { map.dispose(); normalMap.dispose() } }
}

/** normalCanvas for a non-square height field (wraps). */
function normalCanvasRect(h: Float32Array, W: number, H: number, strength: number): HTMLCanvasElement {
  const ctx = makeCanvas(W, H)
  const img = ctx.createImageData(W, H)
  const at = (x: number, y: number) => h[((y + H) % H) * W + ((x + W) % W)]
  const s = strength * W * 0.05
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * s
      const ny = (at(x, y + 1) - at(x, y - 1)) * s
      const inv = 1 / Math.hypot(nx, ny, 1)
      const i = (y * W + x) * 4
      img.data[i] = Math.round((nx * inv * 0.5 + 0.5) * 255)
      img.data[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255)
      img.data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return ctx.canvas
}

/** One pinned thing: physical size (m), position on the board (m, from its
    centre), tilt, its rect in the atlas (px) and which pin colour holds it. */
export interface CardSpec {
  id: string
  w: number
  h: number
  x: number
  y: number
  rot: number
  pin: string
  /** atlas rect */
  ax: number
  ay: number
  aw: number
  ah: number
  /** pin position offset from the card's top-centre, in the card's own axes (m) */
  pinAt?: [number, number]
}

const ATLAS = 512

/* The four photographs (pinState.ts PRINTS) own the top and the left of
   the board; these little paper cards are what is left of the old clutter,
   pinned in the corner that remains. Board metres from the cork's centre. */
export const CARDS: CardSpec[] = [
  { id: 'todo', w: 0.108, h: 0.0645, x: 0.02, y: -0.058, rot: 0.05, pin: '#8a5cc2', ax: 0, ay: 0, aw: 256, ah: 152 },
  { id: 'net', w: 0.108, h: 0.0645, x: 0.148, y: -0.055, rot: -0.04, pin: '#2f8f9d', ax: 256, ay: 0, aw: 256, ah: 152 },
  { id: 'ticket', w: 0.082, h: 0.0365, x: 0.05, y: -0.128, rot: 0.12, pin: '#e6b83a', ax: 0, ay: 152, aw: 256, ah: 116, pinAt: [-0.03, -0.004] },
  { id: 'yellow', w: 0.046, h: 0.046, x: 0.137, y: -0.126, rot: 0.08, pin: '#d94a3d', ax: 256, ay: 152, aw: 128, ah: 128 },
  { id: 'pink', w: 0.038, h: 0.038, x: 0.195, y: -0.128, rot: -0.16, pin: '#3aa76d', ax: 384, ay: 152, aw: 100, ah: 100 },
]

function wobble(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  amp = 1.2,
): void {
  ctx.beginPath()
  ctx.moveTo(x0 + (rand() - 0.5) * amp, y0 + (rand() - 0.5) * amp)
  const mx = (x0 + x1) / 2 + (rand() - 0.5) * amp * 2
  const my = (y0 + y1) / 2 + (rand() - 0.5) * amp * 2
  ctx.quadraticCurveTo(mx, my, x1 + (rand() - 0.5) * amp, y1 + (rand() - 0.5) * amp)
  ctx.stroke()
}

/** A line of "handwriting": loops and dashes, never a real word. */
function scribble(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  x: number,
  y: number,
  len: number,
  size: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x, y)
  let cx = x
  while (cx < x + len) {
    const w = size * (0.6 + rand() * 1.6)
    const up = rand() < 0.5
    ctx.quadraticCurveTo(cx + w * 0.5, y + (up ? -size : size * 0.4), cx + w, y + (rand() - 0.5) * size * 0.3)
    cx += w
    if (rand() < 0.16) cx += size * 1.4 // a gap between "words"
    if (rand() < 0.16) ctx.moveTo(cx, y)
  }
  ctx.stroke()
}

/** The atlas that every pinned card samples. Hand-made, generic, no claims. */
export function makeCardAtlas(seed = 9): CanvasTexture {
  const ctx = makeCanvas(ATLAS, ATLAS)
  const rand = mulberry(seed)
  ctx.fillStyle = '#e8e2d0'
  ctx.fillRect(0, 0, ATLAS, ATLAS)
  const ink = '#233a78'
  const at = (id: string) => CARDS.find((c) => c.id === id)!

  {
    // index card: ruled, red margin, a title and a checklist of scribbles
    const c = at('todo')
    ctx.save()
    ctx.translate(c.ax, c.ay)
    ctx.fillStyle = '#f4f0e0'
    ctx.fillRect(0, 0, c.aw, c.ah)
    ctx.strokeStyle = 'rgba(96,140,200,0.55)'
    ctx.lineWidth = 1
    for (let y = 30; y < c.ah - 4; y += 15) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(c.aw, y)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(200,70,70,0.6)'
    ctx.beginPath()
    ctx.moveTo(0, 20)
    ctx.lineTo(c.aw, 20)
    ctx.stroke()
    drawPixelText(ctx, 'IDEAS', 12, 6, 2, '#b8322a')
    ctx.strokeStyle = ink
    ctx.lineWidth = 1.4
    for (let i = 0; i < 6; i++) {
      const y = 44 + i * 15
      ctx.strokeRect(10, y - 7, 7, 7)
      if (i < 3) {
        wobble(ctx, rand, 11, y - 3, 14, y - 9, 0.4)
      }
      scribble(ctx, rand, 26, y - 1, 60 + rand() * 120, 4.4)
    }
    ctx.restore()
  }
  {
    // a neural network, sketched: 3-4-4-2 nodes and wobbly edges
    const c = at('net')
    ctx.save()
    ctx.translate(c.ax, c.ay)
    ctx.fillStyle = '#f2eedd'
    ctx.fillRect(0, 0, c.aw, c.ah)
    ctx.strokeStyle = 'rgba(96,140,200,0.32)'
    ctx.lineWidth = 1
    for (let x = 0; x < c.aw; x += 16) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, c.ah)
      ctx.stroke()
    }
    for (let y = 0; y < c.ah; y += 16) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(c.aw, y)
      ctx.stroke()
    }
    const layers = [3, 4, 4, 2]
    const nodes: [number, number][][] = layers.map((n, li) =>
      Array.from({ length: n }, (_, i) => [
        34 + li * 62,
        c.ah / 2 + (i - (n - 1) / 2) * 26,
      ]),
    )
    ctx.strokeStyle = 'rgba(35,58,120,0.65)'
    ctx.lineWidth = 1
    for (let li = 0; li < nodes.length - 1; li++)
      for (const a of nodes[li])
        for (const b of nodes[li + 1]) wobble(ctx, rand, a[0] + 5, a[1], b[0] - 5, b[1], 1.2)
    ctx.strokeStyle = ink
    ctx.lineWidth = 1.8
    for (const layer of nodes)
      for (const [x, y] of layer) {
        ctx.fillStyle = '#f2eedd'
        ctx.beginPath()
        ctx.ellipse(x, y, 6, 6.4, rand(), 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
    ctx.fillStyle = ink
    drawPixelText(ctx, 'X', 6, 6, 2, ink)
    drawPixelText(ctx, 'Y', c.aw - 14, 6, 2, ink)
    ctx.restore()
  }
  {
    // a paper ticket stub, notched, perforated
    const c = at('ticket')
    ctx.save()
    ctx.translate(c.ax, c.ay)
    ctx.fillStyle = '#e9d9a3'
    ctx.fillRect(0, 0, c.aw, c.ah)
    ctx.fillStyle = '#dcc98a'
    ctx.fillRect(c.aw * 0.72, 0, 2, c.ah)
    ctx.fillStyle = '#b8322a'
    ctx.fillRect(6, 6, c.aw * 0.72 - 12, 3)
    ctx.fillRect(6, c.ah - 9, c.aw * 0.72 - 12, 3)
    drawPixelText(ctx, 'ADMIT ONE', 14, 24, 3, '#a02d26')
    drawPixelText(ctx, 'NO 0042', 14, 60, 2, '#7a5a30')
    drawPixelText(ctx, 'STUB', c.aw * 0.72 + 12, 18, 2, '#a02d26')
    ctx.fillStyle = 'rgba(120,90,40,0.5)'
    for (let y = 6; y < c.ah - 4; y += 9) ctx.fillRect(c.aw * 0.72 - 1, y, 2, 4)
    // scalloped notches (cut out to the atlas ground colour)
    ctx.fillStyle = '#e8e2d0'
    for (const y of [0, c.ah]) {
      ctx.beginPath()
      ctx.arc(c.aw * 0.72, y, 8, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
  {
    // yellow sticky
    const c = at('yellow')
    ctx.save()
    ctx.translate(c.ax, c.ay)
    ctx.fillStyle = '#f2d34a'
    ctx.fillRect(0, 0, c.aw, c.ah)
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.fillRect(0, 0, c.aw, 16)
    ctx.strokeStyle = '#2a3f7e'
    ctx.lineWidth = 1.8
    for (let i = 0; i < 4; i++) scribble(ctx, rand, 12, 34 + i * 20, 60 + rand() * 40, 5)
    drawPixelText(ctx, '>_', 12, 108, 2, '#2a3f7e')
    ctx.restore()
  }
  {
    // pink sticky
    const c = at('pink')
    ctx.save()
    ctx.translate(c.ax, c.ay)
    ctx.fillStyle = '#ee87a8'
    ctx.fillRect(0, 0, c.aw, c.ah)
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.fillRect(0, 0, c.aw, 12)
    ctx.strokeStyle = '#4a1e3a'
    ctx.lineWidth = 1.6
    scribble(ctx, rand, 10, 40, 60, 5)
    scribble(ctx, rand, 10, 62, 40, 5)
    ctx.restore()
  }
  return colorTexture(ctx.canvas, 8, false)
}

/** All cards as ONE geometry: each a lightly curled 3×3 sheet with its own
    atlas UVs, layered a fraction of a millimetre apart. Their soft drop
    shadows are drawn with the photographs' (PinUps.tsx). Board-local, z = 0
    is the cork. */
export function cardsGeo(): { cards: BufferGeometry; pins: { id: string; x: number; y: number; z: number; color: string }[] } {
  const parts: BufferGeometry[] = []
  const pins: { id: string; x: number; y: number; z: number; color: string }[] = []
  const q = new Quaternion()
  CARDS.forEach((c, i) => {
    const g = new PlaneGeometry(c.w, c.h, 3, 3)
    const p = g.attributes.position
    const uv = g.attributes.uv
    for (let v = 0; v < p.count; v++) {
      const nx = p.getX(v) / (c.w / 2)
      const ny = p.getY(v) / (c.h / 2)
      // paper lifts at the corners and away from its pin
      p.setZ(v, 0.0011 * (nx * nx * 0.6 + ny * ny * 0.6 - ny * 0.4))
      uv.setXY(
        v,
        (c.ax + uv.getX(v) * c.aw) / ATLAS,
        1 - (c.ay + (1 - uv.getY(v)) * c.ah) / ATLAS,
      )
    }
    g.computeVertexNormals()
    const z = 0.0022 + i * 0.0004
    q.setFromAxisAngle(new Vector3(0, 0, 1), c.rot)
    g.applyMatrix4(new Matrix4().compose(new Vector3(c.x, c.y, z), q, new Vector3(1, 1, 1)))
    parts.push(g)
    // the pin sits a little below the top edge, along the tilted card
    const top = new Vector3(c.pinAt ? c.pinAt[0] : 0, c.h / 2 - 0.011 + (c.pinAt ? c.pinAt[1] : 0), 0).applyQuaternion(q)
    pins.push({ id: c.id, x: c.x + top.x, y: c.y + top.y, z: z + 0.0012, color: c.pin })
  })
  return { cards: weld(parts), pins }
}

/* ---------------------------------------------------------------------
   Headphones on a wall hook
   --------------------------------------------------------------------- */

/** Over-ear headphones, hanging: a padded headband, two cups with pads
    and yokes. One geometry (vertex colours). Origin: the apex of the band's
    top, centred. The band's plane is x–y (parallel to the wall). */
export function headphonesGeo(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const R = 0.078
  const pts: Vector3[] = []
  pts.push(new Vector3(-R, -0.098, 0))
  pts.push(new Vector3(-R, -0.04, 0))
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI - (i / 14) * Math.PI
    pts.push(new Vector3(R * Math.cos(a), R * Math.sin(a) - R, 0))
  }
  pts.push(new Vector3(R, -0.04 - R + R, 0))
  pts.push(new Vector3(R, -0.098, 0))
  // the arc's apex is at y = 0 (R*sin(pi/2) - R)
  const band = new TubeGeometry(new CatmullRomCurve3(pts), 40, 0.0058, 6)
  band.scale(1, 1, 2.6)
  parts.push(tint(band, '#1b1c21'))
  // a leather pad on the crown
  const crown = new CatmullRomCurve3(
    Array.from({ length: 9 }, (_, i) => {
      const a = Math.PI * (0.32 + (i / 8) * 0.36)
      return new Vector3(R * Math.cos(a), R * Math.sin(a) - R + 0.0035, 0)
    }),
  )
  const pad = new TubeGeometry(crown, 12, 0.0068, 6)
  pad.scale(1, 1, 3.2)
  parts.push(tint(pad, '#3a2a24'))
  for (const s of [-1, 1]) {
    // yoke: a small fork from the band end into the cup
    parts.push(tint(place(rbox(0.008, 0.03, 0.012, 0.003, 2), s * R, -0.108, 0), '#2a2b31'))
    // cup shell, axis along x
    const shell = new LatheGeometry(
      [
        [0.0, 0.014],
        [0.034, 0.014],
        [0.043, 0.008],
        [0.045, -0.002],
        [0.042, -0.012],
        [0.03, -0.016],
        [0.0, -0.016],
      ].map(([r, y]) => new Vector2(r, y)),
      28,
    )
    shell.rotateZ(-s * Math.PI / 2)
    parts.push(tint(place(shell, s * (R + 0.012), -0.14, 0), '#202126'))
    // brushed ring on the outer face
    const ring = new TorusGeometry(0.03, 0.0018, 6, 28)
    ring.rotateY(Math.PI / 2)
    parts.push(tint(place(ring, s * (R + 0.012 + 0.0148), -0.14, 0), '#a7a9b0'))
    // ear pad, facing in
    const padT = new TorusGeometry(0.03, 0.0125, 8, 28)
    padT.rotateY(Math.PI / 2)
    parts.push(tint(place(padT, s * (R - 0.012), -0.14, 0), '#2b211f'))
  }
  return weld(parts)
}

/** A wall hook: a round plate with a peg that reaches 4.5 cm out. */
export function hookGeo(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const plate = new CylinderGeometry(0.013, 0.014, 0.004, 20)
  plate.rotateX(Math.PI / 2)
  parts.push(plate)
  const peg = new CylinderGeometry(0.0055, 0.0065, 0.044, 12)
  peg.rotateX(Math.PI / 2)
  parts.push(place(peg, 0, 0, 0.024))
  const ball = new SphereGeometry(0.0085, 12, 8)
  parts.push(place(ball, 0, 0, 0.047))
  return weld(parts)
}

/* ---------------------------------------------------------------------
   Radiator under the window
   --------------------------------------------------------------------- */

/** A convector panel radiator, 0.9 × 0.5 m, with copper feed pipes and a
    thermostatic valve. Origin: floor, centred on the wall face (z = 0),
    +z into the room. `paint` uses vertex colours; `copper` likewise. */
export function radiatorGeo(): { paint: BufferGeometry; copper: BufferGeometry } {
  const enamel = '#a3a098'
  const paint: BufferGeometry[] = []
  const y0 = 0.13
  const H = 0.5
  // back plate and the rippled convector front
  paint.push(tint(place(rbox(0.9, H, 0.008, 0.002, 1), 0, y0 + H / 2, 0.028), enamel))
  const s = new Shape()
  const W = 0.88
  s.moveTo(-W / 2, 0)
  for (let x = -W / 2; x <= W / 2 + 1e-6; x += 0.004) {
    s.lineTo(x, 0.013 * (0.5 - 0.5 * Math.cos((2 * Math.PI * (x + W / 2)) / 0.044)))
  }
  s.lineTo(W / 2, 0)
  s.closePath()
  const ripple = new ExtrudeGeometry(s, { depth: H - 0.02, bevelEnabled: false, curveSegments: 1 })
  ripple.rotateX(Math.PI / 2) // shape y → +z, extrusion → down
  paint.push(tint(place(ripple, 0, y0 + H - 0.01, 0.034), enamel))
  // top grille with its slots, end caps and the bottom rail
  paint.push(tint(place(rbox(0.9, 0.014, 0.08, 0.005, 2), 0, y0 + H + 0.005, 0.04), enamel))
  for (let i = 0; i < 16; i++) {
    paint.push(tint(place(new BoxGeometry(0.038, 0.001, 0.008), -0.36 + i * 0.048, y0 + H + 0.0125, 0.045), '#2b2b2d'))
  }
  for (const sx of [-1, 1]) {
    paint.push(tint(place(rbox(0.014, H + 0.014, 0.08, 0.005, 2), sx * 0.457, y0 + H / 2 + 0.005, 0.04), enamel))
  }
  paint.push(tint(place(rbox(0.9, 0.012, 0.05, 0.004, 2), 0, y0 - 0.004, 0.04), enamel))
  // wall brackets
  for (const sx of [-0.33, 0.33]) {
    paint.push(tint(place(rbox(0.03, 0.4, 0.02, 0.003, 1), sx, y0 + H / 2, 0.012), '#9c9990'))
  }
  // thermostatic head on the lower right, bleed key at the top left
  const head = new CylinderGeometry(0.02, 0.02, 0.05, 16)
  head.rotateZ(Math.PI / 2)
  paint.push(tint(place(head, 0.5, y0 + 0.02, 0.04), '#ece9e2'))
  paint.push(tint(place(new CylinderGeometry(0.0085, 0.0085, 0.02, 10), -0.45, y0 + H + 0.014, 0.075, Math.PI / 2, 0, 0), '#b88a48'))

  const copper: BufferGeometry[] = []
  const cu = '#b8703f'
  const brass = '#c49a52'
  for (const sx of [-0.36, 0.36]) {
    copper.push(tint(place(new CylinderGeometry(0.0095, 0.0095, 0.13, 12), sx, 0.065, 0.045), cu))
    copper.push(tint(place(new CylinderGeometry(0.0135, 0.0135, 0.006, 16), sx, 0.003, 0.045), '#c9c7c0'))
    copper.push(tint(place(new CylinderGeometry(0.0125, 0.0125, 0.014, 6), sx, 0.128, 0.045), brass))
  }
  return { paint: weld(paint), copper: weld(copper) }
}

/* ---------------------------------------------------------------------
   A pair of flip-flops
   --------------------------------------------------------------------- */

const FOOT: [number, number][] = [
  [0.0, 0.0],
  [0.03, 0.036],
  [0.12, 0.046],
  [0.35, 0.039],
  [0.62, 0.049],
  [0.85, 0.052],
  [0.96, 0.04],
  [1.0, 0.0],
]

function footWidth(t: number): number {
  for (let i = 1; i < FOOT.length; i++) {
    if (t <= FOOT[i][0]) {
      const [t0, w0] = FOOT[i - 1]
      const [t1, w1] = FOOT[i]
      const k = (t - t0) / (t1 - t0)
      return w0 + (w1 - w0) * (k * k * (3 - 2 * k))
    }
  }
  return 0
}

/** Two rubber "hawai chappals": a white sole, a blue footbed, blue Y-straps.
    Vertex colours; lying kicked off, one crossed over the other's toe. */
export function chappalsGeo(): BufferGeometry {
  const L = 0.27
  const outline = (inset: number): Shape => {
    const sh = new Shape()
    const N = 30
    for (let i = 0; i <= N; i++) {
      const t = i / N
      const w = Math.max(0, footWidth(t) - inset)
      const p: [number, number] = [w, (t - 0.5) * L]
      if (i === 0) sh.moveTo(p[0], p[1])
      else sh.lineTo(p[0], p[1])
    }
    for (let i = N; i >= 0; i--) {
      const t = i / N
      sh.lineTo(-Math.max(0, footWidth(t) - inset), (t - 0.5) * L)
    }
    sh.closePath()
    return sh
  }
  const one = (mirror: boolean): BufferGeometry => {
    const parts: BufferGeometry[] = []
    const sole = new ExtrudeGeometry(outline(0.004), {
      depth: 0.013,
      bevelEnabled: true,
      bevelThickness: 0.0035,
      bevelSize: 0.0035,
      bevelSegments: 2,
      curveSegments: 4,
    })
    parts.push(tint(sole, '#e6e2d8'))
    const bed = new ExtrudeGeometry(outline(0.007), { depth: 0.0018, bevelEnabled: false, curveSegments: 4 })
    parts.push(tint(place(bed, 0, 0, 0.0165), '#2b63c2'))
    const top = 0.0185
    const post = new Vector3(0, 0.07, top)
    const strap = (sx: number) =>
      new TubeGeometry(
        new CatmullRomCurve3([
          post,
          new Vector3(sx * 0.014, 0.05, top + 0.03),
          new Vector3(sx * 0.036, 0.008, top + 0.02),
          new Vector3(sx * 0.047, -0.008, top - 0.004),
        ]),
        16,
        0.0068,
        8,
      )
    for (const sx of [-1, 1]) {
      const st = strap(sx)
      parts.push(tint(st, '#2b63c2'))
    }
    parts.push(tint(place(new CylinderGeometry(0.0072, 0.0072, 0.012, 10), 0, 0.07, top + 0.006, Math.PI / 2, 0, 0), '#2b63c2'))
    const g = weld(parts)
    g.scale(mirror ? -1 : 1, 1, 1)
    g.rotateX(-Math.PI / 2)
    // sole's underside on y = 0 (extrusion started at z = -bevel)
    g.translate(0, 0.0035, 0)
    return g
  }
  const a = one(false)
  place(a, 0, 0, 0, 0, 0.55, 0)
  const b = one(true)
  place(b, 0.15, 0, 0.075, 0, -0.32, 0)
  return weld([a, b])
}

/* ---------------------------------------------------------------------
   Cardboard boxes in a corner
   --------------------------------------------------------------------- */

/** A small stack of shipping boxes: taped seams, a label, a slightly
    crushed corner. `boxes` is cardboard (box-mapped UVs in metres, for a
    grain texture); `trim` carries the tape, seams and labels (vertex
    colours). Origin: on the floor, centred. */
export function boxesGeo(): { boxes: BufferGeometry; trim: BufferGeometry } {
  const boxes: BufferGeometry[] = []
  const trim: BufferGeometry[] = []
  const spec: { w: number; h: number; d: number; x: number; z: number; yaw: number; y: number }[] = [
    { w: 0.54, h: 0.34, d: 0.42, x: 0, z: 0, yaw: 0.06, y: 0 },
    { w: 0.42, h: 0.26, d: 0.34, x: -0.03, z: 0.01, yaw: -0.14, y: 0.34 },
    { w: 0.3, h: 0.17, d: 0.24, x: 0.02, z: 0.0, yaw: 0.3, y: 0.6 },
  ]
  spec.forEach((b, i) => {
    const body = place(boxUV(rbox(b.w, b.h, b.d, 0.006, 2), 8), 0, b.h / 2, 0)
    const t: BufferGeometry[] = []
    // the top seam: a slit and a strip of tape running over the front
    t.push(tint(place(rbox(b.w * 0.98, 0.0012, 0.003, 0.0004, 1), 0, b.h + 0.0004, 0), '#6a4a2c'))
    t.push(tint(place(rbox(0.05, 0.0016, b.d * 0.5, 0.0006, 1), 0, b.h + 0.0008, b.d * 0.25), '#d4bf8f'))
    t.push(tint(place(rbox(0.05, b.h * 0.42, 0.0016, 0.0006, 1), 0, b.h - b.h * 0.21, b.d / 2 + 0.0004), '#d4bf8f'))
    if (i === 0) {
      // a shipping label with a red band and dark lines standing in for text
      t.push(tint(place(rbox(0.13, 0.085, 0.0012, 0.0005, 1), 0.14, b.h * 0.55, b.d / 2 + 0.0005), '#e8e3d4'))
      t.push(tint(place(rbox(0.13, 0.014, 0.0014, 0.0005, 1), 0.14, b.h * 0.55 + 0.036, b.d / 2 + 0.0008), '#b8322a'))
      for (const dy of [0.008, -0.008, -0.022]) {
        t.push(tint(place(rbox(0.1, 0.004, 0.0014, 0.0005, 1), 0.14, b.h * 0.55 + dy, b.d / 2 + 0.0008), '#3a342c'))
      }
    }
    const xf = new Matrix4().compose(
      new Vector3(b.x, b.y, b.z),
      new Quaternion().setFromEuler(new Euler(0, b.yaw, 0)),
      new Vector3(1, 1, 1),
    )
    body.applyMatrix4(xf)
    for (const part of t) part.applyMatrix4(xf)
    boxes.push(body)
    trim.push(...t)
  })
  return { boxes: weld(boxes), trim: weld(trim) }
}

/* ---------------------------------------------------------------------
   Cardboard
   --------------------------------------------------------------------- */

/** Shipping-carton board: pressed fibre, faint stains, scuffed edges.
    UVs from boxUV(geo, 4): one tile ≈ 25 cm. */
export function makeCardboardMaps(seed = 13, size = 256): GrainMaps {
  const [r0, g0, b0] = hexRGB('#a98358')
  const broad = fbmField(size, seed, { octaves: 4, freq: 3, persistence: 0.5 })
  const fibre = fbmField(size, seed + 1, { octaves: 3, freq: 64, persistence: 0.55 })
  const long = fbmField(size, seed + 2, { octaves: 3, freqX: 4, freqY: 90, persistence: 0.6 })
  const ctx = makeCanvas(size, size)
  const img = ctx.createImageData(size, size)
  const height = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  for (let i = 0; i < size * size; i++) {
    const k = 0.86 + (broad[i] - 0.5) * 0.12 + (fibre[i] - 0.5) * 0.14 + (long[i] - 0.5) * 0.08
    img.data[i * 4] = Math.min(255, r0 * k)
    img.data[i * 4 + 1] = Math.min(255, g0 * k)
    img.data[i * 4 + 2] = Math.min(255, b0 * k)
    img.data[i * 4 + 3] = 255
    height[i] = fibre[i] * 0.6 + long[i] * 0.4
    rough[i] = 0.82 + fibre[i] * 0.16
  }
  ctx.putImageData(img, 0, 0)
  const map = colorTexture(ctx.canvas, 8)
  const normalMap = dataTexture(normalCanvas(height, size, 0.45), 8)
  const roughnessMap = dataTexture(fieldCanvas(rough, size, 0, 1), 8)
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

/* ---------------------------------------------------------------------
   Trailing pothos in a hand-painted blue pot (on the window sill)
   --------------------------------------------------------------------- */

/** Heart-ish pothos leaf, base at the origin, tip on +z, upper face +y. */
export function heartLeafGeometry(len = 0.056, wid = 0.05, rows = 8, cols = 4): BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  for (let r = 0; r <= rows; r++) {
    const t = r / rows
    const hw = (wid / 2) * Math.sin(Math.PI * Math.pow(t, 0.55)) * (1 - 0.2 * t * t)
    for (let c = 0; c <= cols; c++) {
      const s = (c / cols) * 2 - 1
      const x = s * hw
      pos.push(x, 0.32 * Math.abs(x) - 0.16 * len * t * t, t * len)
      uv.push(c / cols, t)
    }
  }
  const idx: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c
      const d = a + cols + 1
      idx.push(a, d, a + 1, a + 1, d, d + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Golden-pothos skin: bright green with cream-yellow marbling. */
export function makePothosTexture(seed = 5): CanvasTexture {
  const W = 128
  const H = 128
  const ctx = makeCanvas(W, H)
  const rand = mulberry(seed)
  ctx.fillStyle = '#4c8a34'
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 34; i++) {
    const x = rand() * W
    const y = rand() * H
    const g = ctx.createRadialGradient(x, y, 0, x, y, 8 + rand() * 22)
    g.addColorStop(0, `rgba(226,214,110,${0.35 + rand() * 0.3})`)
    g.addColorStop(1, 'rgba(226,214,110,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }
  ctx.strokeStyle = 'rgba(200,225,140,0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(W / 2, 0)
  ctx.lineTo(W / 2, H)
  ctx.stroke()
  ctx.lineWidth = 1
  for (let y = 8; y < H; y += 12) {
    for (const s of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(W / 2, y)
      ctx.quadraticCurveTo(W / 2 + s * 24, y + 3, W / 2 + s * 50, y + 14)
      ctx.stroke()
    }
  }
  return colorTexture(ctx.canvas, 4, false)
}

/** A small pothos: a bushy crown of upright leaves on short stalks, and
    three vines that trail over the pot's rim, along the sill and down over
    its nose. Local space: origin at the pot's base centre on the sill top,
    +z toward the room; the nose of the sill is at z = `nose`. */
export function pothosLayout(
  nose = 0.045,
  seed = 8,
): { vines: BufferGeometry; leaves: { matrix: Matrix4; shade: number }[] } {
  const rand = mulberry(seed)
  const tubes: BufferGeometry[] = []
  const leaves: { matrix: Matrix4; shade: number }[] = []
  const x = new Vector3()
  const y = new Vector3()
  const z = new Vector3()
  const hintV = new Vector3()
  const m = new Matrix4()
  const put = (p: Vector3, dir: Vector3, hint: Vector3, sc: number) => {
    z.copy(dir).normalize()
    x.crossVectors(hintV.copy(hint), z)
    if (x.lengthSq() < 1e-5) x.set(1, 0, 0)
    x.normalize()
    y.crossVectors(z, x)
    m.makeBasis(x, y, z).scale(new Vector3(sc, sc, sc)).setPosition(p)
    leaves.push({ matrix: m.clone(), shade: 0.8 + rand() * 0.3 })
  }
  const potH = 0.05
  // the crown: leaves on stalks fanning up and out of the soil
  for (let i = 0; i < 13; i++) {
    const az = i * 2.399963 + rand() * 0.4
    const elev = 0.35 + rand() * 0.95
    const pet = 0.018 + rand() * 0.03
    const base = new Vector3(Math.sin(az) * 0.01 * rand(), potH + 0.002, Math.cos(az) * 0.01 * rand())
    const dir = new Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev))
    const tip = base.clone().addScaledVector(dir, pet)
    tip.y -= pet * 0.12
    tubes.push(
      new TubeGeometry(new CatmullRomCurve3([base, base.clone().lerp(tip, 0.55).add(new Vector3(0, 0.004, 0)), tip]), 6, 0.0009, 4),
    )
    const leafDir = dir.clone().add(new Vector3(0, -0.28, 0))
    put(tip, leafDir, new Vector3(0, 1, 0), 0.8 + rand() * 0.45)
  }
  // the trailers
  const specs = [
    { a: -0.9, dx: -0.058, len: 0.15 },
    { a: 0.2, dx: 0.018, len: 0.23 },
    { a: 0.85, dx: 0.072, len: 0.1 },
  ]
  for (const sp of specs) {
    const rimX = 0.032 * Math.sin(sp.a)
    const rimZ = 0.032 * Math.cos(sp.a)
    const pts = [
      new Vector3(rimX * 0.6, potH + 0.004, rimZ * 0.6),
      new Vector3(rimX * 1.1, potH + 0.006, rimZ * 1.1),
      new Vector3(rimX * 1.45, 0.005, rimZ * 1.45),
      new Vector3(sp.dx * 0.7 + rimX * 0.5, 0.0025, Math.max(rimZ * 1.5, 0.03) + 0.006),
      new Vector3(sp.dx, 0.0022, nose - 0.006),
      new Vector3(sp.dx + 0.002, -0.004, nose + 0.005),
    ]
    let d = -0.035
    while (-d < sp.len) {
      pts.push(new Vector3(sp.dx + Math.sin(d * 33 + sp.a) * 0.006, d, nose + 0.006 + Math.sin(d * 19) * 0.004))
      d -= 0.04
    }
    const curve = new CatmullRomCurve3(pts)
    tubes.push(new TubeGeometry(curve, 70, 0.0011, 5))
    const n = Math.max(3, Math.floor(sp.len / 0.05) + 2)
    for (let i = 0; i < n; i++) {
      const t = 0.3 + (i / n) * 0.7
      const p = curve.getPoint(t)
      const tan = curve.getTangent(t)
      const side = i % 2 === 0 ? -1 : 1
      const dir = new Vector3(side * 0.85, -0.1 + tan.y * 0.5, 0.55 + rand() * 0.4).add(tan.clone().multiplyScalar(0.35))
      put(p, dir, new Vector3(0, 0.5, 1), 0.85 + rand() * 0.4)
    }
  }
  return { vines: weld(tubes), leaves }
}

/** The blue-and-white hand-painted pot's glaze: cobalt bands and a row of
    petals on white. UV: u round the pot, v up its profile. */
export function makeBluePotTexture(): CanvasTexture {
  const W = 256
  const H = 128
  const ctx = makeCanvas(W, H)
  ctx.fillStyle = '#f0eee4'
  ctx.fillRect(0, 0, W, H)
  const blue = '#20408f'
  // flip: v = 0 is the pot's base, canvas y grows downward
  const y = (v: number) => H * (1 - v)
  ctx.fillStyle = blue
  for (const v of [0.06, 0.1, 0.9, 0.94]) ctx.fillRect(0, y(v), W, 3)
  // a chain of petals round the belly
  for (let i = 0; i < 16; i++) {
    const cx = (i + 0.5) * (W / 16)
    ctx.beginPath()
    ctx.ellipse(cx, y(0.5), 6.5, 17, 0, 0, Math.PI * 2)
    ctx.fillStyle = blue
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(cx, y(0.5), 3, 10, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#f0eee4'
    ctx.fill()
    ctx.fillStyle = blue
    ctx.beginPath()
    ctx.arc(cx + W / 32, y(0.5), 2.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(cx - 1, y(0.74), 2, 6)
  }
  const rand = mulberry(4)
  ctx.fillStyle = 'rgba(120,150,210,0.22)'
  for (let i = 0; i < 60; i++) ctx.fillRect(rand() * W, rand() * H, 1, 1)
  return colorTexture(ctx.canvas, 8)
}

/** The blue pot: a glazed lathe, 6 cm tall. */
export function bluePotGeo(): { pot: BufferGeometry; soil: BufferGeometry } {
  const prof: [number, number][] = [
    [0.0, 0.0],
    [0.024, 0.0],
    [0.028, 0.004],
    [0.034, 0.02],
    [0.0375, 0.044],
    [0.0385, 0.058],
    [0.0405, 0.0605],
    [0.0395, 0.0625],
    [0.036, 0.0625],
    [0.0335, 0.059],
    [0.0, 0.0575],
  ]
  const pot = new LatheGeometry(prof.map(([r, yy]) => new Vector2(r, yy)), 30)
  pot.scale(0.8, 0.8, 0.8)
  const soil = new CircleGeometry(0.0272, 20)
  soil.rotateX(-Math.PI / 2)
  soil.translate(0, 0.0444, 0)
  return { pot, soil }
}

/* ---------------------------------------------------------------------
   A print for the right wall, and a cloth bag on a hook
   --------------------------------------------------------------------- */

/** A folk-inspired mandala print: petal rings in oxblood, saffron, teal
    and indigo on cream, hand-painted feel. Purely decorative. */
export function makeMandalaArt(): CanvasTexture {
  const W = 240
  const H = 300
  const ctx = makeCanvas(W, H)
  ctx.fillStyle = '#efe6cf'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2
  const cy = H * 0.47
  const rand = mulberry(77)
  const ring = (n: number, r: number, pw: number, ph: number, color: string, inner?: string) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.015
      ctx.save()
      ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      ctx.rotate(a + Math.PI / 2)
      ctx.beginPath()
      ctx.moveTo(0, -ph)
      ctx.quadraticCurveTo(pw, -ph * 0.2, 0, ph * 0.6)
      ctx.quadraticCurveTo(-pw, -ph * 0.2, 0, -ph)
      ctx.fillStyle = color
      ctx.fill()
      if (inner) {
        ctx.beginPath()
        ctx.moveTo(0, -ph * 0.6)
        ctx.quadraticCurveTo(pw * 0.45, -ph * 0.15, 0, ph * 0.25)
        ctx.quadraticCurveTo(-pw * 0.45, -ph * 0.15, 0, -ph * 0.6)
        ctx.fillStyle = inner
        ctx.fill()
      }
      ctx.restore()
    }
  }
  ring(24, 104, 9, 15, '#1d2b57', '#efe6cf')
  ring(16, 84, 11, 19, '#a93226', '#e2a63c')
  ring(16, 62, 9, 16, '#1c6b66', '#efe6cf')
  ring(12, 42, 9, 15, '#d18b2a', '#a93226')
  ring(8, 24, 6, 11, '#1d2b57', '#e2a63c')
  ctx.fillStyle = '#a93226'
  ctx.beginPath()
  ctx.arc(cx, cy, 9, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#e2a63c'
  ctx.beginPath()
  ctx.arc(cx, cy, 4, 0, Math.PI * 2)
  ctx.fill()
  // dotted outer ring and corner marks
  ctx.fillStyle = '#a93226'
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(cx + Math.cos(a) * 124, cy + Math.sin(a) * 124, 1.8, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = '#1d2b57'
  ctx.lineWidth = 2
  ctx.strokeRect(6, 6, W - 12, H - 12)
  ctx.lineWidth = 1
  ctx.strokeRect(11, 11, W - 22, H - 22)
  for (const [mx, my] of [[24, 24], [W - 24, 24], [24, H - 24], [W - 24, H - 24]]) {
    ctx.fillStyle = '#d18b2a'
    ctx.beginPath()
    ctx.arc(mx, my, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#a93226'
    ctx.beginPath()
    ctx.arc(mx, my, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
  return finishPixel(ctx)
}

function finishPixel(ctx: CanvasRenderingContext2D): CanvasTexture {
  // soft (linear) filtering: this print is hand-painted, not pixel art
  return colorTexture(ctx.canvas, 8, false)
}

/** Block-printed indigo cloth: rows of little white flower stamps. */
export function makeBlockPrint(): CanvasTexture {
  const S = 256
  const ctx = makeCanvas(S, S)
  const rand = mulberry(19)
  ctx.fillStyle = '#243a78'
  ctx.fillRect(0, 0, S, S)
  for (let i = 0; i < 6000; i++) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? '12,24,70' : '70,96,170'},${0.05 + rand() * 0.08})`
    ctx.fillRect(rand() * S, rand() * S, 1, 1 + rand() * 2)
  }
  ctx.fillStyle = 'rgba(236,230,212,0.92)'
  const stamp = (x: number, y: number, r: number) => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      ctx.beginPath()
      ctx.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.55, r * 0.3, a, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.arc(x, y, r * 0.28, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const x = 22 + col * 42 + (row % 2) * 21 + (rand() - 0.5) * 2
      const y = 22 + row * 42 + (rand() - 0.5) * 2
      stamp(x, y, 8.5)
      ctx.fillRect(x - 1, y + 16, 2, 8)
    }
  }
  return colorTexture(ctx.canvas, 8)
}

/** A cotton shoulder bag hanging by its straps: a pillowy body, a stitched
    hem strip, one strap looped over the peg. `body` is UV-mapped for the
    block print; `strap` is plain cotton. Origin: the peg (top centre). */
export function bagGeo(): { body: BufferGeometry; strap: BufferGeometry } {
  const body = new RoundedBoxGeometry(0.3, 0.34, 0.052, 5, 0.022)
  body.translate(0, -0.14 - 0.022, 0)
  // a slight belly: the body swells toward its middle
  const p = body.attributes.position
  for (let i = 0; i < p.count; i++) {
    const yy = (p.getY(i) + 0.162) / 0.17
    p.setZ(i, p.getZ(i) * (1 + 0.16 * (1 - yy * yy)))
  }
  body.computeVertexNormals()
  const curve = new CatmullRomCurve3([
    new Vector3(-0.098, -0.03, 0),
    new Vector3(-0.092, 0.05, 0),
    new Vector3(-0.04, 0.108, 0),
    new Vector3(0, 0.116, 0),
    new Vector3(0.04, 0.108, 0),
    new Vector3(0.092, 0.05, 0),
    new Vector3(0.098, -0.03, 0),
  ])
  // the straps run from the body's top up over the peg; the peg sits under
  // the crest, so lift the whole loop by its tube radius
  const strap = new TubeGeometry(curve, 48, 0.0075, 6)
  strap.scale(1, 1, 0.42)
  return { body, strap }
}


/* ---------------------------------------------------------------------
   The employer binders: three ring binders as ONE geometry
   --------------------------------------------------------------------- */

/** Three ring binders side by side (x = 0.09, 0.148, 0.206 on the shelf):
    a rounded cloth body, metal end caps, a clear label sleeve. Vertex
    colours carry each binder's cloth; the caller gives them one material. */
export function bindersGeo(colors: string[]): BufferGeometry {
  const parts: BufferGeometry[] = []
  colors.forEach((c, i) => {
    const b: BufferGeometry[] = [
      tint(rbox(0.052, 0.17, 0.15, 0.006, 2), c),
      tint(place(rbox(0.0535, 0.006, 0.1515, 0.002, 1), 0, 0.0815, 0), '#25262a'),
      tint(place(rbox(0.0535, 0.006, 0.1515, 0.002, 1), 0, -0.0815, 0), '#25262a'),
      tint(place(rbox(0.04, 0.1, 0.0016, 0.0006, 1), 0, 0.02, 0.0752), '#cfd3d6'),
    ]
    const g = weld(b)
    if (i === 0) g.rotateY(0.04)
    place(g, 0.09 + i * 0.058, 0.098, -0.005)
    parts.push(g)
  })
  return weld(parts)
}

/** Pixel-font spine labels for the binders, packed in one atlas (NEAREST). */
export function makeBinderLabels(texts: string[]): CanvasTexture {
  const cell = 4
  const pad = 3
  const cw = Math.max(...texts.map((t) => pixelTextWidth(t))) * cell + pad * 2
  const ch = 5 * cell + pad * 2
  const ctx = makeCanvas(cw * texts.length, ch)
  texts.forEach((t, i) => {
    ctx.fillStyle = '#eceadf'
    ctx.fillRect(i * cw, 0, cw, ch)
    drawPixelText(ctx, t, i * cw + pad, pad, cell, '#1a1812')
  })
  const tex = new CanvasTexture(ctx.canvas)
  tex.colorSpace = SRGBColorSpace
  tex.magFilter = NearestFilter
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

/** The labels themselves: one quad per binder, each mapped to its cell,
    text running top to bottom on the spine. */
export function binderLabelsGeo(count: number): BufferGeometry {
  const parts: BufferGeometry[] = []
  for (let i = 0; i < count; i++) {
    const g = new PlaneGeometry(0.096, 0.036)
    const uv = g.attributes.uv
    for (let v = 0; v < uv.count; v++) uv.setX(v, (i + uv.getX(v)) / count)
    g.rotateZ(-Math.PI / 2)
    place(g, 0, 0.02, 0.0762)
    if (i === 0) g.rotateY(0.04)
    place(g, 0.09 + i * 0.058, 0.098, -0.005)
    parts.push(g)
  }
  return weld(parts)
}
