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

/** One octave of tileable value noise, sampled at (u,v) in 0..1. */
function sampleLattice(g: Float32Array, n: number, u: number, v: number): number {
  const x = u * n
  const y = v * n
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = smooth(x - xi)
  const fy = smooth(y - yi)
  const x0 = ((xi % n) + n) % n
  const y0 = ((yi % n) + n) % n
  const x1 = (x0 + 1) % n
  const y1 = (y0 + 1) % n
  const a = g[y0 * n + x0]
  const b = g[y0 * n + x1]
  const c = g[y1 * n + x0]
  const d = g[y1 * n + x1]
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** Fractal (fbm) noise field, `size`² floats in 0..1, tileable.
    `freqX/freqY` let you stretch it (brushed metal: freqX low, freqY high). */
export function fbmField(
  size: number,
  seed: number,
  opts: { octaves?: number; freq?: number; freqX?: number; freqY?: number; persistence?: number } = {},
): Float32Array {
  const { octaves = 4, persistence = 0.5 } = opts
  const fx = opts.freqX ?? opts.freq ?? 4
  const fy = opts.freqY ?? opts.freq ?? 4
  const rand = mulberry(seed)
  const out = new Float32Array(size * size)
  let amp = 1
  let total = 0
  for (let o = 0; o < octaves; o++) {
    const nx = Math.max(1, Math.round(fx * 2 ** o))
    const ny = Math.max(1, Math.round(fy * 2 ** o))
    // separate anisotropic lattices are awkward with one n; use the larger
    // lattice and sample it with a scaled coordinate so the stretch survives
    const n = Math.max(nx, ny)
    const g = new Float32Array(n * n)
    for (let i = 0; i < g.length; i++) g[i] = rand()
    const sx = nx / n
    const sy = ny / n
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        out[y * size + x] += amp * sampleLattice(g, n, ((x / size) * sx) % 1, ((y / size) * sy) % 1)
      }
    }
    total += amp
    amp *= persistence
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
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
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round((lo + f[i] * (hi - lo)) * 255)))
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return ctx.canvas
}

/** Tangent-space normal canvas (OpenGL, +Y up) from a height field.
    `strength` ≈ how steep the surface is: 1 subtle, 4 pronounced. Wraps. */
export function normalCanvas(h: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const ctx = makeCanvas(size, size)
  const img = ctx.createImageData(size, size)
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)]
  const s = strength * size * 0.05
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // canvas rows run downward, texture V runs upward: flip Y
      const nx = -(at(x + 1, y) - at(x - 1, y)) * s
      const ny = (at(x, y + 1) - at(x, y - 1)) * s
      const inv = 1 / Math.hypot(nx, ny, 1)
      const i = (y * size + x) * 4
      img.data[i] = Math.round((nx * inv * 0.5 + 0.5) * 255)
      img.data[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255)
      img.data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
      img.data[i + 3] = 255
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
