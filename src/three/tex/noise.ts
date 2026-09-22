import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'
import { makeCanvas, mulberry } from '../textures'

/* =====================================================================
   Procedural PBR maps — the shared toolkit for making surfaces feel real.

   Flat colour is what makes a 3D scene read as "3D". Real materials have
   micro-structure: orange-peel on injection-moulded plastic, weave in
   fabric, brushed streaks on steel, tooth in plaster. A tiny normal map
   plus a roughness map gives the lamp something to break up on, and that
   is most of the difference between a render and a photograph.

   Everything here is TILEABLE (wraps at the edges), deterministic (seeded)
   and cheap (256–512 px, generated once). Data maps (normal, roughness,
   height) are NoColorSpace; colour maps are sRGB. Usage:

     const m = useMemo(() => plasticMaps(7), [])
     <meshStandardMaterial color="#cdc8bc" roughness={0.6}
        normalMap={m.normalMap} normalScale={m.normalScale}
        roughnessMap={m.roughnessMap} />

   Tiles repeat in world space through `texture.repeat` — set repeat so a
   tile spans a sensible physical size (plastic grain: ~2 cm; fabric weave:
   ~1 cm; plaster: ~30 cm).
   ===================================================================== */

export interface PbrMaps {
  /** tangent-space normal (OpenGL convention), data */
  normalMap: CanvasTexture
  /** G channel drives roughness (multiplies material.roughness), data */
  roughnessMap: CanvasTexture
  /** the raw height, 0..1, if the caller wants it as a bumpMap */
  heightMap: CanvasTexture
  /** suggested material.normalScale for a "normal strength" of 1 */
  normalScale: [number, number]
  dispose: () => void
}

/* ---------- tileable value noise ---------- */

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** The k-th value (1-based) of mulberry(seed) without drawing the k-1
    before it: mulberry's state only ever adds a constant, so any draw
    can be computed directly. Lets a stretched lattice skip the columns
    it never samples while keeping the exact same field. */
function mulberryAt(seed: number, k: number): number {
  const a = ((seed >>> 0) + Math.imul(k, 0x6d2b79f5)) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Fractal (fbm) noise field, `size`² floats in 0..1, tileable.
    `freqX/freqY` let you stretch it (brushed metal: freqX low, freqY high).

    Speed: this runs for ~100 maps on first load, so the lattice lookup is
    table-driven — the cell index and smoothstep weight of every column
    and row are computed once per octave (they depend on one axis only),
    and each row first blends its two lattice rows, leaving a single lerp
    per texel. A stretched lattice (brushed metal: 720 rows, 9 columns
    sampled) only draws the lattice values it reads. Same field, bit for
    bit, as the naive per-texel sampler, ~5x faster (~50x stretched). */
export function fbmField(
  size: number,
  seed: number,
  opts: { octaves?: number; freq?: number; freqX?: number; freqY?: number; persistence?: number } = {},
): Float32Array {
  const { octaves = 4, persistence = 0.5 } = opts
  const fx = opts.freqX ?? opts.freq ?? 4
  const fy = opts.freqY ?? opts.freq ?? 4
  const out = new Float32Array(size * size)
  const X0 = new Int32Array(size)
  const X1 = new Int32Array(size)
  const FX = new Float64Array(size)
  let amp = 1
  let total = 0
  /** draws consumed by the octaves before this one */
  let drawn = 0
  for (let o = 0; o < octaves; o++) {
    const nx = Math.max(1, Math.round(fx * 2 ** o))
    const ny = Math.max(1, Math.round(fy * 2 ** o))
    // separate anisotropic lattices are awkward with one n; use the larger
    // lattice and sample it with a scaled coordinate so the stretch survives
    const n = Math.max(nx, ny)
    const sx = nx / n
    const sy = ny / n
    for (let x = 0; x < size; x++) {
      const t = (((x / size) * sx) % 1) * n
      const xi = Math.floor(t)
      FX[x] = smooth(t - xi)
      const x0 = ((xi % n) + n) % n
      X0[x] = x0
      X1[x] = (x0 + 1) % n
    }
    // which lattice columns are ever read?
    const used = new Uint8Array(n)
    for (let x = 0; x < size; x++) used[X0[x]] = used[X1[x]] = 1
    const cols: number[] = []
    for (let j = 0; j < n; j++) if (used[j]) cols.push(j)
    let g: Float32Array | null = null
    if (cols.length * 4 >= n) {
      // dense: draw the whole lattice, in order (exactly the old stream)
      g = new Float32Array(n * n)
      for (let i = 0; i < g.length; i++) g[i] = mulberryAt(seed, drawn + i + 1)
    }
    const row = new Float64Array(n)
    for (let y = 0; y < size; y++) {
      const t = (((y / size) * sy) % 1) * n
      const yi = Math.floor(t)
      const wy = smooth(t - yi)
      const y0 = ((yi % n) + n) % n
      const r0 = y0 * n
      const r1 = ((y0 + 1) % n) * n
      if (g) {
        for (let j = 0; j < n; j++) {
          const a = g[r0 + j]
          row[j] = a + (g[r1 + j] - a) * wy
        }
      } else {
        for (const j of cols) {
          const a = Math.fround(mulberryAt(seed, drawn + r0 + j + 1))
          row[j] = a + (Math.fround(mulberryAt(seed, drawn + r1 + j + 1)) - a) * wy
        }
      }
      const base = y * size
      for (let x = 0; x < size; x++) {
        const a = row[X0[x]]
        out[base + x] += amp * (a + (row[X1[x]] - a) * FX[x])
      }
    }
    drawn += n * n
    total += amp
    amp *= persistence
  }
  const k = 1 / total
  for (let i = 0; i < out.length; i++) out[i] *= k
  return out
}

/** Add `b` into `a` (in place) with a weight; returns `a`. */
export function mix(a: Float32Array, b: Float32Array, w: number): Float32Array {
  for (let i = 0; i < a.length; i++) a[i] += b[i] * w
  return a
}

/** Remap to 0..1 using the field's own min/max. */
export function normalizeField(f: Float32Array): Float32Array {
  let lo = Infinity
  let hi = -Infinity
  for (const v of f) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const k = hi > lo ? 1 / (hi - lo) : 1
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) * k
  return f
}

/* ---------- field → textures ---------- */

function data(canvas: HTMLCanvasElement, repeat: number): CanvasTexture {
  const t = new CanvasTexture(canvas)
  t.colorSpace = NoColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.anisotropy = 8
  t.repeat.set(repeat, repeat)
  t.needsUpdate = true
  return t
}

/** Grayscale canvas from a 0..1 field (optionally remapped lo..hi → 0..255). */
export function fieldCanvas(f: Float32Array, size: number, lo = 0, hi = 1): HTMLCanvasElement {
  const ctx = makeCanvas(size, size)
  const img = ctx.createImageData(size, size)
  // one 32-bit write per texel (little-endian RGBA: A in the top byte)
  const px = new Uint32Array(img.data.buffer)
  const span = (hi - lo) * 255
  const off = lo * 255
  for (let i = 0; i < f.length; i++) {
    const r = off + f[i] * span
    const v = r <= 0 ? 0 : r >= 255 ? 255 : Math.round(r)
    px[i] = 0xff000000 | (v << 16) | (v << 8) | v
  }
  ctx.putImageData(img, 0, 0)
  return ctx.canvas
}

/** Tangent-space normal canvas (OpenGL, +Y up) from a height field.
    `strength` ≈ how steep the surface is: 1 subtle, 4 pronounced. Wraps. */
export function normalCanvas(h: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const ctx = makeCanvas(size, size)
  const img = ctx.createImageData(size, size)
  const px = new Uint32Array(img.data.buffer)
  const s = strength * size * 0.05
  for (let y = 0; y < size; y++) {
    const row = y * size
    const up = ((y + 1) % size) * size
    const dn = ((y - 1 + size) % size) * size
    for (let x = 0; x < size; x++) {
      const xl = x === 0 ? size - 1 : x - 1
      const xr = x === size - 1 ? 0 : x + 1
      // canvas rows run downward, texture V runs upward: flip Y
      const nx = -(h[row + xr] - h[row + xl]) * s
      const ny = (h[up + x] - h[dn + x]) * s
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1)
      const r = Math.round((nx * inv * 0.5 + 0.5) * 255)
      const g = Math.round((ny * inv * 0.5 + 0.5) * 255)
      const b = Math.round((inv * 0.5 + 0.5) * 255)
      px[row + x] = 0xff000000 | (b << 16) | (g << 8) | r
    }
  }
  ctx.putImageData(img, 0, 0)
  return ctx.canvas
}

/** Assemble normal + roughness + height textures from height/roughness fields. */
export function pbrFromFields(
  height: Float32Array,
  rough: Float32Array,
  size: number,
  opts: { strength?: number; repeat?: number; roughLo?: number; roughHi?: number } = {},
): PbrMaps {
  const { strength = 1.5, repeat = 1, roughLo = 0.6, roughHi = 1 } = opts
  const normalMap = data(normalCanvas(height, size, strength), repeat)
  const roughnessMap = data(fieldCanvas(rough, size, roughLo, roughHi), repeat)
  const heightMap = data(fieldCanvas(height, size), repeat)
  return {
    normalMap,
    roughnessMap,
    heightMap,
    normalScale: [1, 1],
    dispose: () => {
      normalMap.dispose()
      roughnessMap.dispose()
      heightMap.dispose()
    },
  }
}

/* ---------- ready-made surfaces ---------- */

/** Injection-moulded ABS: fine orange-peel grain, faint tooling swirl,
    a few hairline scratches. The default for every beige case. */
export function plasticMaps(seed = 1, size = 256, repeat = 3): PbrMaps {
  const fine = fbmField(size, seed, { octaves: 3, freq: 48, persistence: 0.55 })
  const swirl = fbmField(size, seed + 1, { octaves: 2, freq: 4, persistence: 0.5 })
  const h = mix(fine, swirl, 0.25)
  // scratches: short bright-or-dark hairlines, mostly one direction
  const rand = mulberry(seed + 9)
  for (let i = 0; i < size * 0.35; i++) {
    let x = rand() * size
    let y = rand() * size
    const a = 0.3 + (rand() - 0.5) * 0.5
    const len = 8 + rand() * 30
    const depth = rand() * 0.25
    for (let s = 0; s < len; s++) {
      const px = Math.floor(x + size) % size
      const py = Math.floor(y + size) % size
      h[py * size + px] -= depth
      x += Math.cos(a)
      y += Math.sin(a)
    }
  }
  normalizeField(h)
  const rough = fbmField(size, seed + 2, { octaves: 4, freq: 6, persistence: 0.6 })
  return pbrFromFields(h, rough, size, { strength: 1.2, repeat, roughLo: 0.72, roughHi: 1.0 })
}

/** Woven upholstery: a plain weave over slow fbm mottling. */
export function fabricMaps(seed = 1, size = 256, repeat = 6, threads = 24): PbrMaps {
  const h = new Float32Array(size * size)
  const cell = size / threads
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / cell) % 2
      const v = (y / cell) % 2
      const over = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0
      // over/under: a rounded ridge along one axis or the other
      const wu = Math.sin(Math.PI * (u % 1))
      const wv = Math.sin(Math.PI * (v % 1))
      h[y * size + x] = over ? 0.5 + 0.5 * wu : 0.5 + 0.5 * wv
    }
  }
  const mottle = fbmField(size, seed, { octaves: 4, freq: 5, persistence: 0.5 })
  mix(h, mottle, 0.35)
  normalizeField(h)
  const rough = fbmField(size, seed + 3, { octaves: 3, freq: 10 })
  return pbrFromFields(h, rough, size, { strength: 2.4, repeat, roughLo: 0.8, roughHi: 1.0 })
}

/** Brushed metal: streaks along X (freqX low, freqY high). */
export function brushedMetalMaps(seed = 1, size = 256, repeat = 2): PbrMaps {
  const h = fbmField(size, seed, { octaves: 4, freqX: 1, freqY: 90, persistence: 0.65 })
  const rough = fbmField(size, seed + 1, { octaves: 3, freqX: 1, freqY: 40, persistence: 0.6 })
  return pbrFromFields(h, rough, size, { strength: 1.0, repeat, roughLo: 0.35, roughHi: 0.75 })
}

/** Painted plaster / drywall: soft trowel mottling + fine tooth. */
export function plasterMaps(seed = 1, size = 512, repeat = 3): PbrMaps {
  const soft = fbmField(size, seed, { octaves: 5, freq: 3, persistence: 0.55 })
  const tooth = fbmField(size, seed + 1, { octaves: 2, freq: 90, persistence: 0.5 })
  const h = mix(soft, tooth, 0.35)
  normalizeField(h)
  const rough = fbmField(size, seed + 2, { octaves: 3, freq: 5 })
  return pbrFromFields(h, rough, size, { strength: 1.6, repeat, roughLo: 0.85, roughHi: 1.0 })
}

/** Rubber / soft-touch (mouse pad, feet, grips): dense fine stipple. */
export function rubberMaps(seed = 1, size = 256, repeat = 4): PbrMaps {
  const h = fbmField(size, seed, { octaves: 2, freq: 96, persistence: 0.7 })
  const rough = fbmField(size, seed + 1, { octaves: 2, freq: 12 })
  return pbrFromFields(h, rough, size, { strength: 1.8, repeat, roughLo: 0.85, roughHi: 1.0 })
}

/* ---------- colour overlays ---------- */

/** A soft, transparent "lived-in" layer: dust, smudges, fingerprints.
    Use as an alpha-blended map (or an emissive-free decal plane) on glass,
    glossy plastic and lacquer. `amount` 0..1. sRGB. */
export function grimeTexture(seed = 1, size = 512, amount = 0.5): CanvasTexture {
  const ctx = makeCanvas(size, size)
  const rand = mulberry(seed)
  // broad smudges
  for (let i = 0; i < 26; i++) {
    const x = rand() * size
    const y = rand() * size
    const r = 20 + rand() * 90
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(210,215,225,${0.05 + rand() * 0.09 * amount})`)
    g.addColorStop(1, 'rgba(210,215,225,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // fingerprint whorls: concentric arcs
  for (let i = 0; i < 5; i++) {
    const x = 60 + rand() * (size - 120)
    const y = 60 + rand() * (size - 120)
    ctx.strokeStyle = `rgba(230,232,240,${0.05 + 0.08 * amount})`
    ctx.lineWidth = 1
    for (let r = 3; r < 22; r += 2.4) {
      ctx.beginPath()
      ctx.ellipse(x, y, r * 0.8, r, 0.6, 0.4, Math.PI * 1.7)
      ctx.stroke()
    }
  }
  // dust specks
  for (let i = 0; i < 420 * amount; i++) {
    ctx.fillStyle = `rgba(235,235,225,${0.1 + rand() * 0.25})`
    ctx.fillRect(rand() * size, rand() * size, 1, 1)
  }
  const t = new CanvasTexture(ctx.canvas)
  t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.needsUpdate = true
  return t
}
