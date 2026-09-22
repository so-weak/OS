import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'
import { ROOM_CAM_POS, WINDOW } from './layout'
import { makeCanvas, mulberry } from './textures'
import { fbmField, normalCanvas } from './tex/noise'

/* =====================================================================
   Everything painted on the far side of the glass — and the one thing
   painted THROUGH it (the blind gobo the sun projects onto the desk).

   The outside is not a picture on the glass. It is a stack of painted
   layers hung at real depths BEHIND the wall's opening (z = -1.3 … -6.4),
   so when the camera moves the layers slide against each other and
   against the frame — that parallax is what reads as "a window".

   Each layer is painted in "patch units": (0,0)…(1,1) is the glass as
   seen from the default camera (ROOM_CAM_POS). `placeLayer` scales and
   centres the plane so a layer at ANY depth lines up with that patch from
   the default view, and everything a painter draws in patch units lands
   where it should. Areas outside 0…1 exist for the other angles the
   camera can take (mouse sway, library view, photo mode).

   Night: sky gradient, stars, the real-phase moon, cloud bands, three
   skylines (far, mid, near) with atmospheric perspective and thousands of
   lit windows, and a bokeh sheet of out-of-focus street lights. Day: the
   same city, awake, under a luminous sky with a sun that follows the
   Bengaluru hour.
   ===================================================================== */

/* ---------- the moon ---------- */

/** Mean synodic month in days. */
export const SYNODIC = 29.530588853
/* JD of a reference new moon (6 Jan 2000, 18:14 UTC). */
const NEW_MOON_JD = 2451550.1

/** Days since the last new moon (0 = new, ~14.77 = full). */
export function moonAge(d = new Date()): number {
  const jd = d.getTime() / 86_400_000 + 2440587.5
  const age = (jd - NEW_MOON_JD) % SYNODIC
  return age < 0 ? age + SYNODIC : age
}

/* ---------- colour helpers ---------- */

type RGB = [number, number, number]

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
function css(c: RGB, a = 1): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${+a.toFixed(3)})`
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/* ---------- where each layer hangs ---------- */

const GLASS_Z = WINDOW.wallZ - WINDOW.glassDepth
const ASPECT = WINDOW.glassH / WINDOW.glassW

/** World (x,y) where the design camera's ray through patch point (u,v)
    meets a plane at depth `z`. */
export function patchToWorld(u: number, v: number, z: number): [number, number] {
  const c = ROOM_CAM_POS
  const t = (z - c.z) / (GLASS_Z - c.z)
  const gx = WINDOW.x - WINDOW.glassW / 2 + u * WINDOW.glassW
  const gy = WINDOW.y - WINDOW.glassH / 2 + v * WINDOW.glassH
  return [c.x + t * (gx - c.x), c.y + t * (gy - c.y)]
}

export interface LayerFrame {
  u0: number
  u1: number
  v0: number
  v1: number
}

export interface Placement {
  x: number
  y: number
  z: number
  w: number
  h: number
}

/** Centre and size of a plane at depth `z` covering `f` in patch units. */
export function placeLayer(z: number, f: LayerFrame): Placement {
  const [xa, ya] = patchToWorld(f.u0, f.v0, z)
  const [xb, yb] = patchToWorld(f.u1, f.v1, z)
  return { x: (xa + xb) / 2, y: (ya + yb) / 2, z, w: xb - xa, h: yb - ya }
}

/** Depths (world z) and coverage of every layer. Names are shared by the
    night and day sets, so the same city stands in the same place. */
export const LAYER = {
  sky: { z: -6.4, f: { u0: -2.8, u1: 5.4, v0: -2.4, v1: 3.6 } },
  stars: { z: -6.35 },
  moon: { z: -6.3 },
  clouds: { z: -6.2, f: { u0: -2.8, u1: 5.4, v0: 0.3, v1: 2.0 } },
  cloudsNear: { z: -4.6, f: { u0: -2.2, u1: 3.4, v0: 0.3, v1: 1.7 } },
  far: { z: -3.1, f: { u0: -0.7, u1: 2.6, v0: -0.35, v1: 0.62 } },
  mid: { z: -1.95, f: { u0: -0.5, u1: 1.95, v0: -0.4, v1: 0.6 } },
  bokeh: { z: -1.62, f: { u0: -0.4, u1: 1.5, v0: -0.4, v1: 0.55 } },
  near: { z: -1.34, f: { u0: -0.4, u1: 1.5, v0: -0.5, v1: 0.55 } },
} as const

/** Patch-unit centre of the moon in the design view. */
const MOON_AT = { u: 0.72, v: 0.7 }
/** Moon radius in patch widths. */
const MOON_R = 0.095

/** Frame of the moon's square canvas (halo included). */
export function moonFrame(): LayerFrame {
  const half = (MOON_R * 256) / 88 // canvas is 512 px, the moon 88 px in radius
  return {
    u0: MOON_AT.u - half,
    u1: MOON_AT.u + half,
    v0: MOON_AT.v - half / ASPECT,
    v1: MOON_AT.v + half / ASPECT,
  }
}

/* ---------- canvas plumbing ---------- */

class Fr {
  f: LayerFrame
  pxU: number
  pxV: number
  w: number
  h: number
  constructor(f: LayerFrame, pxU: number) {
    this.f = f
    this.pxU = pxU
    this.pxV = pxU * ASPECT
    this.w = Math.round((f.u1 - f.u0) * pxU)
    this.h = Math.round((f.v1 - f.v0) * this.pxV)
  }
  X(u: number): number {
    return (u - this.f.u0) * this.pxU
  }
  Y(v: number): number {
    return (this.f.v1 - v) * this.pxV
  }
}

function layerTexture(canvas: HTMLCanvasElement, repeatS = false): CanvasTexture {
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.wrapS = repeatS ? RepeatWrapping : ClampToEdgeWrapping
  t.wrapT = ClampToEdgeWrapping
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  // seen only through the small window opening at oblique-ish angles, never
  // filling the screen — 4x keeps the streets/gradient readable for a lot
  // less sampling cost per lit fragment than the 8x every sky layer used
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

function scaledCopy(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, w)
  c.height = Math.max(1, h)
  const x = c.getContext('2d')
  if (!x) throw new Error('2d context unavailable')
  x.imageSmoothingEnabled = true
  x.imageSmoothingQuality = 'high'
  x.drawImage(src, 0, 0, c.width, c.height)
  return c
}

/** Cheap gaussian-ish blur: halve `levels` times, then double back up. */
function blur(src: HTMLCanvasElement, levels: number): HTMLCanvasElement {
  let cur = src
  for (let i = 0; i < levels; i++) cur = scaledCopy(cur, cur.width >> 1, cur.height >> 1)
  for (let i = levels - 1; i >= 0; i--) cur = scaledCopy(cur, src.width >> i, src.height >> i)
  return cur
}

/** Add a bloom of `glow` onto `ctx` (additive). */
function addGlow(
  ctx: CanvasRenderingContext2D,
  glow: HTMLCanvasElement,
  passes: [number, number][],
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const [levels, a] of passes) {
    ctx.globalAlpha = a
    ctx.drawImage(blur(glow, levels), 0, 0)
  }
  ctx.restore()
}

/* =====================================================================
   The sky
   ===================================================================== */

const SKY = LAYER.sky.f

/** Vertical gradient tile (RepeatWrapping in U), dithered so a dark sky
    never bands. `stops` are [v in patch units, colour]. */
// 1024px of vertical gradient was overkill for a smooth sky wash (the
// dithering already breaks up banding); 640 halves the pixel count and is
// still far finer than the eye can resolve a colour ramp at.
function gradientTile(stops: [number, RGB][], seed: number, w = 128, h = 640): CanvasTexture {
  const ctx = makeCanvas(w, h, true)
  const img = ctx.createImageData(w, h)
  const rand = mulberry(seed)
  const sorted = [...stops].sort((a, b) => b[0] - a[0]) // top (high v) first
  for (let y = 0; y < h; y++) {
    const v = SKY.v1 - (y / (h - 1)) * (SKY.v1 - SKY.v0)
    let i = 1
    while (i < sorted.length - 1 && v < sorted[i][0]) i++
    const [v0, c0] = sorted[i - 1]
    const [v1, c1] = sorted[i]
    const k = clamp01((v0 - v) / (v0 - v1))
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const n = (rand() + rand() - 1) * 1.15
      img.data[o] = c0[0] + (c1[0] - c0[0]) * k + n
      img.data[o + 1] = c0[1] + (c1[1] - c0[1]) * k + n
      img.data[o + 2] = c0[2] + (c1[2] - c0[2]) * k + n
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = layerTexture(ctx.canvas, true)
  tex.repeat.set(skyRepeat(), 1)
  return tex
}

const NIGHT_SKY: [number, RGB][] = [
  [3.6, hex('#03050d')],
  [1.9, hex('#050a1c')],
  [1.25, hex('#0a1531')],
  [0.85, hex('#101f45')],
  [0.55, hex('#1a2c5a')],
  [0.36, hex('#2c3a6e')],
  [0.24, hex('#4a4577')],
  [0.14, hex('#7a5670')],
  [0.05, hex('#94625a')],
  [-0.35, hex('#4d3646')],
  [-2.4, hex('#1a1419')],
]

/** Repeat count for a gradient tile so its texels stay roughly square. */
export function skyRepeat(): number {
  return ((SKY.u1 - SKY.u0) * 150) / 128
}

/* ---------- stars & beacons (world-space point positions) ---------- */

export interface PointCloud {
  pos: Float32Array
  col: Float32Array
}

export function starField(): PointCloud {
  const rand = mulberry(4242)
  const n = 300
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const tints: RGB[] = [hex('#ffffff'), hex('#cfe0ff'), hex('#ffe9c8'), hex('#b8cfff')]
  for (let i = 0; i < n; i++) {
    const u = SKY.u0 + 0.4 + rand() * (SKY.u1 - SKY.u0 - 0.8)
    // fewer stars near the light-polluted horizon
    const v = 0.34 + Math.pow(rand(), 0.7) * 2.6
    const [x, y] = patchToWorld(u, v, LAYER.stars.z)
    pos.set([x, y, LAYER.stars.z], i * 3)
    const b = 0.22 + 0.78 * Math.pow(rand(), 2.6)
    const t = tints[Math.floor(rand() * tints.length)]
    col.set([(t[0] / 255) * b, (t[1] / 255) * b, (t[2] / 255) * b], i * 3)
  }
  return { pos, col }
}

/* ---------- the moon ---------- */

/** Draw a moon of the given age into a 512² canvas: halo, dark limb, the
    textured lit region as one clipped path (the half-disc facing the sun
    plus — gibbous — or minus — crescent — a half-ellipse whose horizontal
    axis is cos of the phase angle), a soft terminator. Seen from the
    northern hemisphere, so a waxing moon is lit on the right. */
function makeMoonTexture(age: number): CanvasTexture {
  const S = 512
  const ctx = makeCanvas(S, S, true)
  const cx = S / 2
  const cy = S / 2
  const r = 88
  const phase = age / SYNODIC // 0 new, 0.5 full
  const waxing = phase < 0.5
  const p = waxing ? phase : 1 - phase
  const lit = (1 - Math.cos(2 * Math.PI * p)) / 2 // illuminated fraction
  const a = Math.cos(2 * Math.PI * p) * r // signed terminator half-axis
  const crescent = a > 0

  // halo, brighter when fuller
  const halo = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, S / 2)
  halo.addColorStop(0, `rgba(172,192,240,${0.16 + 0.34 * lit})`)
  halo.addColorStop(0.3, `rgba(130,156,226,${0.06 + 0.16 * lit})`)
  halo.addColorStop(1, 'rgba(96,124,214,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, S, S)

  // the lit moon, painted whole on its own canvas
  const M = makeCanvas(2 * r, 2 * r, true)
  const mc = r
  const base = M.createRadialGradient(mc - r * 0.15, mc - r * 0.1, r * 0.1, mc, mc, r)
  base.addColorStop(0, '#f6f1e2')
  base.addColorStop(0.8, '#e2dfd6')
  base.addColorStop(1, '#bdbbb6')
  M.fillStyle = base
  M.fillRect(0, 0, 2 * r, 2 * r)
  // maria: soft grey seas
  const maria: [number, number, number, number][] = [
    [-0.28, -0.36, 0.3, 0.5],
    [0.2, -0.36, 0.17, 0.46],
    [0.32, -0.08, 0.21, 0.5],
    [0.55, 0.1, 0.14, 0.4],
    [-0.55, -0.02, 0.3, 0.42],
    [-0.2, 0.42, 0.21, 0.4],
    [-0.5, 0.32, 0.11, 0.4],
    [0.7, -0.2, 0.09, 0.5],
    [0.0, 0.0, 0.16, 0.25],
  ]
  for (const [mx, my, mr, ma] of maria) {
    const g = M.createRadialGradient(mc + mx * r, mc + my * r, 0, mc + mx * r, mc + my * r, mr * r)
    g.addColorStop(0, `rgba(122,128,146,${ma})`)
    g.addColorStop(0.7, `rgba(132,138,154,${ma * 0.6})`)
    g.addColorStop(1, 'rgba(140,146,160,0)')
    M.fillStyle = g
    M.fillRect(0, 0, 2 * r, 2 * r)
  }
  // mottling from noise
  const nf = fbmField(128, 33, { octaves: 5, freq: 5, persistence: 0.6 })
  const nc = makeCanvas(128, 128, true)
  const nimg = nc.createImageData(128, 128)
  for (let i = 0; i < nf.length; i++) {
    const v = 226 + nf[i] * 60
    nimg.data[i * 4] = nimg.data[i * 4 + 1] = nimg.data[i * 4 + 2] = v
    nimg.data[i * 4 + 3] = 255
  }
  nc.putImageData(nimg, 0, 0)
  M.save()
  M.globalCompositeOperation = 'multiply'
  M.globalAlpha = 0.85
  M.imageSmoothingEnabled = true
  M.drawImage(nc.canvas, 0, 0, 2 * r, 2 * r)
  M.restore()
  // craters and ray systems
  const crat = mulberry(9)
  for (let i = 0; i < 46; i++) {
    const ang = crat() * Math.PI * 2
    const d = Math.sqrt(crat()) * 0.92
    const x = mc + Math.cos(ang) * d * r
    const y = mc + Math.sin(ang) * d * r
    const cr = 1.2 + crat() * crat() * 5.5
    M.strokeStyle = `rgba(90,94,108,${0.12 + crat() * 0.16})`
    M.lineWidth = 1
    M.beginPath()
    M.arc(x, y, cr, 0, Math.PI * 2)
    M.stroke()
    M.strokeStyle = `rgba(255,255,250,${0.1 + crat() * 0.12})`
    M.beginPath()
    M.arc(x + 0.7, y + 0.7, cr, Math.PI * 0.9, Math.PI * 1.9)
    M.stroke()
  }
  // Tycho and its rays
  M.strokeStyle = 'rgba(255,255,250,0.32)'
  for (let i = 0; i < 18; i++) {
    const ang = (i / 18) * Math.PI * 2 + 0.3
    M.lineWidth = 1 + (i % 3)
    M.beginPath()
    M.moveTo(mc - 0.1 * r, mc + 0.72 * r)
    M.lineTo(mc - 0.1 * r + Math.cos(ang) * r * 0.35, mc + 0.72 * r + Math.sin(ang) * r * 0.35)
    M.stroke()
  }
  const tycho = M.createRadialGradient(mc - 0.1 * r, mc + 0.72 * r, 0, mc - 0.1 * r, mc + 0.72 * r, 6)
  tycho.addColorStop(0, 'rgba(255,255,255,0.95)')
  tycho.addColorStop(1, 'rgba(255,255,255,0)')
  M.fillStyle = tycho
  M.fillRect(0, 0, 2 * r, 2 * r)

  // earthshine on the dark side
  ctx.fillStyle = 'rgba(38,52,98,0.5)'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()

  ctx.save()
  if (!waxing) {
    ctx.translate(cx * 2, 0)
    ctx.scale(-1, 1)
  }
  ctx.beginPath()
  ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2)
  if (crescent) {
    ctx.ellipse(cx, cy, Math.max(a, 0.01), r, 0, Math.PI / 2, -Math.PI / 2, true)
  } else {
    ctx.ellipse(cx, cy, Math.max(-a, 0.01), r, 0, Math.PI / 2, (Math.PI * 3) / 2)
  }
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(M.canvas, cx - r, cy - r)
  ctx.restore()

  // soften the terminator with a few fading strokes of the dark tone
  ctx.save()
  if (!waxing) {
    ctx.translate(cx * 2, 0)
    ctx.scale(-1, 1)
  }
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  for (let k = 5; k >= 1; k--) {
    ctx.strokeStyle = `rgba(40,54,100,${0.07})`
    ctx.lineWidth = k * 2.4
    ctx.beginPath()
    ctx.ellipse(cx, cy, Math.max(Math.abs(a), 0.01), r, 0, -Math.PI / 2, Math.PI / 2, !crescent)
    ctx.stroke()
  }
  ctx.restore()
  // a hairline of limb glow round the whole disc
  ctx.strokeStyle = `rgba(210,222,255,${0.12 + 0.2 * lit})`
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, r + 0.5, 0, Math.PI * 2)
  ctx.stroke()
  return layerTexture(ctx.canvas)
}

/* ---------- clouds ---------- */

interface CloudOpts {
  f: LayerFrame
  pxU: number
  seed: number
  /** 'bands': long banks that thin out (night, cirrus). 'cumulus': flat-
      bottomed heaps, lit from above. */
  kind: 'bands' | 'cumulus'
  night: boolean
}

const CUMULUS_AT: [number, number, number, number][] = [
  // centre u, base v, half-width (u), height (v)
  [-1.35, 0.5, 0.55, 0.16],
  [-0.1, 0.6, 0.42, 0.13],
  [0.98, 0.47, 0.6, 0.15],
  [2.0, 0.58, 0.62, 0.17],
  [2.85, 0.46, 0.42, 0.12],
]

/** Clouds from noise: a density field with a shaping mask (bands, or heaps
    with flat bottoms), lit by the vertical density gradient — the top of a
    heap is bright, its underside grey-blue — and softened by painting at a
    third of the resolution. */
function paintClouds(o: CloudOpts): HTMLCanvasElement {
  const fr = new Fr(o.f, o.pxU)
  const sw = Math.max(64, Math.round(fr.w / 3))
  const sh = Math.max(32, Math.round(fr.h / 3))
  const nf = fbmField(256, o.seed, { octaves: 6, freqX: 4, freqY: 7, persistence: 0.56 })
  const dens = new Float32Array(sw * sh)
  const bands: [number, number, number][] = [
    [0.52, 0.09, 0.9],
    [0.86, 0.13, 0.7],
    [1.3, 0.16, 0.55],
    [1.72, 0.14, 0.4],
  ]
  for (let y = 0; y < sh; y++) {
    const v = o.f.v1 - ((y + 0.5) / sh) * (o.f.v1 - o.f.v0)
    for (let x = 0; x < sw; x++) {
      const n = nf[Math.floor((y * 256) / sh) * 256 + Math.floor((x * 256) / sw)]
      let d = 0
      if (o.kind === 'bands') {
        let m = 0
        for (const [c, w, k] of bands) m += k * Math.exp(-(((v - c) / w) ** 2))
        d = smoothstep(0.5, 0.74, n) * Math.min(1, m)
      }
      dens[y * sw + x] = d
    }
  }
  if (o.kind === 'cumulus') {
    // heaps built from a few dozen overlapping puffs of every size, so the
    // top is lumpy and the flat base stays flat
    const prand = mulberry(o.seed + 5)
    const sxU = sw / (o.f.u1 - o.f.u0)
    const syV = sh / (o.f.v1 - o.f.v0)
    const acc = new Float32Array(sw * sh)
    for (const [uc, vb, hw, hh] of CUMULUS_AT) {
      for (let i = 0; i < 90; i++) {
        const fx = (prand() + prand() + prand()) / 1.5 - 1 // -1 … 1, centre-heavy
        // the envelope alone (a clean parabola in fx) puts every puff's
        // height on one smooth curve, so the heap reads as a single
        // symmetric triangular peak instead of a real cloud's several
        // uneven towers. `lobes` is low in the "valleys" between two or
        // three bumps across the width (seeded by uc so each cloud in
        // CUMULUS_AT differs) — SKIPPING a puff there, not just placing
        // it shorter, is what matters: puffs are big enough that merely
        // reshaping their height still smoothed straight over the gaps,
        // so valleys need genuinely fewer puffs, not shorter ones.
        const lobes =
          0.32 + 0.68 * Math.pow(0.5 + 0.5 * Math.sin(fx * 11 + uc * 7.3), 1.7)
        if (prand() > lobes) continue
        const jitter = 0.82 + 0.36 * prand()
        const top = hh * Math.pow(Math.max(0.02, 1 - fx * fx), 0.6) * jitter
        const rv = hh * (0.09 + 0.22 * prand() * prand() + 0.045 * (1 - Math.abs(fx)))
        const vy = vb + rv * 0.55 + prand() * Math.max(0, top - rv * 1.1)
        const cxp = (uc + fx * hw - o.f.u0) * sxU
        const cyp = (o.f.v1 - vy) * syV
        const rp = rv * syV
        const x0 = Math.max(0, Math.floor(cxp - rp))
        const x1 = Math.min(sw - 1, Math.ceil(cxp + rp))
        const y0 = Math.max(0, Math.floor(cyp - rp))
        const y1 = Math.min(sh - 1, Math.ceil(cyp + rp))
        const baseY = (o.f.v1 - vb) * syV
        for (let y = y0; y <= y1; y++) {
          if (y > baseY) continue // flat base
          for (let x = x0; x <= x1; x++) {
            const k = 1 - ((x - cxp) ** 2 + (y - cyp) ** 2) / (rp * rp)
            if (k > 0) acc[y * sw + x] += k * k * 0.55
          }
        }
      }
    }
    for (let i = 0; i < dens.length; i++) {
      const y = Math.floor(i / sw)
      const x = i - y * sw
      const n = nf[Math.floor((y * 256) / sh) * 256 + Math.floor((x * 256) / sw)]
      dens[i] = smoothstep(0.25, 0.85, acc[i] * (0.8 + 0.4 * n))
    }
  }
  const sm = makeCanvas(sw, sh, true)
  const img = sm.createImageData(sw, sh)
  const cool = hex('#3a4b86')
  const lit = hex('#a4b6ea')
  const top = hex('#ffffff')
  const belly = hex('#8fa2c2')
  for (let y = 0; y < sh; y++) {
    const v = o.f.v1 - ((y + 0.5) / sh) * (o.f.v1 - o.f.v0)
    for (let x = 0; x < sw; x++) {
      const u = o.f.u0 + ((x + 0.5) / sw) * (o.f.u1 - o.f.u0)
      const i = y * sw + x
      const d = dens[i]
      const up = dens[Math.max(0, y - 2) * sw + x]
      const dn = dens[Math.min(sh - 1, y + 2) * sw + x]
      let col: RGB
      let alpha: number
      if (o.night) {
        // the moon lights the clouds round it
        const dm = Math.hypot(u - MOON_AT.u, (v - MOON_AT.v) * 0.75)
        col = mixRGB(cool, lit, Math.exp(-dm * dm * 1.6))
        alpha = d * 150
      } else {
        const shade = clamp01(0.7 + 2.6 * (dn - up) + 0.18 * (d - 0.5))
        col = mixRGB(belly, top, shade)
        // cumulus used to clip to full opacity by d=0.35, so most of a
        // heap's body read as one flat painted shape; a wider ramp keeps
        // some translucency and density variation showing through
        alpha =
          o.kind === 'bands'
            ? smoothstep(0.02, 0.35, d) * 120
            : smoothstep(0.05, 0.62, d) * 232
      }
      const o4 = i * 4
      img.data[o4] = col[0]
      img.data[o4 + 1] = col[1]
      img.data[o4 + 2] = col[2]
      img.data[o4 + 3] = alpha
    }
  }
  sm.putImageData(img, 0, 0)
  const ctx = makeCanvas(fr.w, fr.h, true)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(sm.canvas, 0, 0, fr.w, fr.h)
  // the upscale leaves stair-steps on the edges: blur, then lay a little of
  // the sharper picture back over it
  const soft = blur(ctx.canvas, 2)
  const out = makeCanvas(fr.w, fr.h, true)
  out.drawImage(soft, 0, 0)
  out.globalAlpha = 0.4
  out.drawImage(ctx.canvas, 0, 0)
  return out.canvas
}

/* =====================================================================
   The city
   ===================================================================== */

type LayerName = 'far' | 'mid' | 'near'

interface Bld {
  u0: number
  u1: number
  top: number
  seed: number
  lit: number
  roof: 'flat' | 'tank' | 'mast' | 'step' | 'crown'
  glass: boolean
}

interface SkylineOpts {
  u0: number
  u1: number
  wMin: number
  wMax: number
  base: [number, number]
  tallP: number
  tall: [number, number]
  seed: number
  /** hand-placed buildings, painted last: [centre u, half width, top v, roof, glass] */
  pins: [number, number, number, Bld['roof'], boolean][]
}

function skyline(o: SkylineOpts): Bld[] {
  const rand = mulberry(o.seed)
  const out: Bld[] = []
  let u = o.u0 - rand() * 0.04
  while (u < o.u1) {
    const w = o.wMin + rand() * (o.wMax - o.wMin)
    const tall = rand() < o.tallP
    const top = tall
      ? o.tall[0] + rand() * (o.tall[1] - o.tall[0])
      : o.base[0] + rand() * (o.base[1] - o.base[0])
    const rr = rand()
    out.push({
      u0: u,
      u1: u + w,
      top,
      seed: Math.floor(rand() * 1e6),
      lit: 0.2 + rand() * 0.5,
      roof: tall
        ? rr < 0.5
          ? 'crown'
          : 'mast'
        : rr < 0.28
          ? 'tank'
          : rr < 0.45
            ? 'step'
            : rr < 0.6
              ? 'mast'
              : 'flat',
      glass: tall && rand() < 0.6,
    })
    u += w * (0.5 + rand() * 0.55)
  }
  for (const [uc, hw, top, roof, glass] of o.pins) {
    out.push({
      u0: uc - hw,
      u1: uc + hw,
      top,
      seed: Math.floor(rand() * 1e6),
      lit: 0.5 + rand() * 0.3,
      roof,
      glass,
    })
  }
  return out
}

const FAR_CITY: SkylineOpts = {
  u0: -0.7,
  u1: 2.6,
  wMin: 0.032,
  wMax: 0.09,
  base: [0.14, 0.26],
  tallP: 0.16,
  tall: [0.32, 0.5],
  seed: 101,
  pins: [
    [0.55, 0.036, 0.5, 'mast', true],
    [0.9, 0.03, 0.44, 'crown', true],
    [1.27, 0.034, 0.47, 'mast', true],
  ],
}
const MID_CITY: SkylineOpts = {
  u0: -0.5,
  u1: 1.95,
  wMin: 0.06,
  wMax: 0.15,
  base: [0.05, 0.19],
  tallP: 0.18,
  tall: [0.22, 0.36],
  seed: 202,
  pins: [],
}

/** Tips of the tallest far towers — where the red aircraft lights burn. */
export function beaconPositions(): Float32Array {
  const towers = skyline(FAR_CITY).filter((b) => b.top > 0.42 && b.u0 > 0.05 && b.u1 < 1.5)
  const pos: number[] = []
  for (const b of towers.slice(0, 6)) {
    const mastH = b.roof === 'mast' ? 0.055 : 0.012
    const [x, y] = patchToWorld((b.u0 + b.u1) / 2, b.top + mastH, LAYER.far.z + 0.02)
    pos.push(x, y, LAYER.far.z + 0.02)
  }
  return new Float32Array(pos)
}

interface Style {
  bodyTop: RGB
  bodyBot: RGB
  glassTop: RGB
  /** the lit edge on the right of each building */
  rim: string
  /** darkness of the left shoulder */
  shade: number
  cw: number
  ch: number
  ww: number
  wh: number
  /** night: an unlit window; day: a pane, a glint, a curtain */
  unlit: string
  pane: string
  glint: string
  curtain: string
  mist?: [RGB, number]
}

const NIGHT_STYLE: Record<LayerName, Style> = {
  far: {
    bodyTop: hex('#27335e'),
    bodyBot: hex('#352d52'),
    glassTop: hex('#2f4272'),
    rim: 'rgba(160,176,240,0.34)',
    shade: 0.13,
    cw: 5,
    ch: 6.5,
    ww: 2.3,
    wh: 3.4,
    unlit: 'rgba(100,120,182,0.08)',
    pane: '',
    glint: '',
    curtain: '',
    mist: [hex('#75587c'), 0.36],
  },
  mid: {
    bodyTop: hex('#151c3a'),
    bodyBot: hex('#1e1c38'),
    glassTop: hex('#1b2650'),
    rim: 'rgba(128,150,222,0.3)',
    shade: 0.2,
    cw: 8,
    ch: 10.5,
    ww: 4,
    wh: 5.6,
    unlit: 'rgba(84,104,170,0.1)',
    pane: '',
    glint: '',
    curtain: '',
    mist: [hex('#44385f'), 0.3],
  },
  near: {
    bodyTop: hex('#080b18'),
    bodyBot: hex('#0d0f1e'),
    glassTop: hex('#0d1226'),
    rim: 'rgba(112,132,204,0.36)',
    shade: 0.3,
    cw: 14,
    ch: 18,
    ww: 7.5,
    wh: 9.5,
    unlit: 'rgba(70,90,150,0.08)',
    pane: '',
    glint: '',
    curtain: '',
  },
}

const DAY_STYLE: Record<LayerName, Style> = {
  far: {
    bodyTop: hex('#a3b6cc'),
    bodyBot: hex('#b6c8da'),
    glassTop: hex('#adc3da'),
    rim: 'rgba(255,255,255,0.55)',
    shade: 0.07,
    cw: 5,
    ch: 6.5,
    ww: 2.3,
    wh: 3.4,
    unlit: '',
    pane: 'rgba(96,122,156,0.3)',
    glint: 'rgba(226,240,252,0.6)',
    curtain: 'rgba(214,216,210,0.4)',
    mist: [hex('#dbe9f2'), 0.5],
  },
  mid: {
    bodyTop: hex('#7c91a8'),
    bodyBot: hex('#90a3b8'),
    glassTop: hex('#86a0bb'),
    rim: 'rgba(255,255,255,0.45)',
    shade: 0.13,
    cw: 8,
    ch: 10.5,
    ww: 4,
    wh: 5.6,
    unlit: '',
    pane: 'rgba(52,80,114,0.42)',
    glint: 'rgba(214,232,246,0.7)',
    curtain: 'rgba(226,220,204,0.5)',
    mist: [hex('#cfe0ec'), 0.34],
  },
  near: {
    bodyTop: hex('#3a495c'),
    bodyBot: hex('#465667'),
    glassTop: hex('#42546a'),
    rim: 'rgba(214,232,250,0.5)',
    shade: 0.2,
    cw: 14,
    ch: 18,
    ww: 7.5,
    wh: 9.5,
    unlit: '',
    pane: 'rgba(28,44,64,0.55)',
    glint: 'rgba(170,196,220,0.6)',
    curtain: 'rgba(210,200,180,0.5)',
  },
}

const LIT_COLORS: [RGB, number][] = [
  [hex('#ffb45a'), 0.3],
  [hex('#ffd08a'), 0.22],
  [hex('#fff0d0'), 0.14],
  [hex('#ffc27a'), 0.1],
  [hex('#a8c8ff'), 0.09],
  [hex('#7fd6ff'), 0.06],
  [hex('#ff9a70'), 0.05],
  [hex('#b5ffcf'), 0.04],
]

function pickLit(r: number): RGB {
  let acc = 0
  for (const [c, w] of LIT_COLORS) {
    acc += w
    if (r < acc) return c
  }
  return LIT_COLORS[0][0]
}

const shadeRGB = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]

function paintPalm(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  lean: number,
  color: string,
  rim: string,
  seed: number,
): void {
  const rand = mulberry(seed)
  const tx = x + lean
  const ty = y - h
  // trunk: a leaning curve, tapering
  const cxp = x + lean * 0.15
  const cyp = y - h * 0.55
  ctx.fillStyle = color
  ctx.beginPath()
  const w0 = h * 0.03
  const w1 = h * 0.015
  ctx.moveTo(x - w0, y)
  ctx.quadraticCurveTo(cxp - w0 * 0.8, cyp, tx - w1, ty)
  ctx.lineTo(tx + w1, ty)
  ctx.quadraticCurveTo(cxp + w0 * 0.8, cyp, x + w0, y)
  ctx.closePath()
  ctx.fill()
  // fronds
  const n = 12
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.02 + (0.96 * i) / (n - 1)) + (rand() - 0.5) * 0.14
    const len = h * (0.32 + rand() * 0.16)
    const dx = Math.cos(a + Math.PI) * len
    const up = Math.sin(a) * len * 0.5
    const droop = len * (0.2 + rand() * 0.24)
    const ex = tx + dx
    const ey = ty - up + droop
    const qx = tx + dx * 0.55
    const qy = ty - up * 1.25 - len * 0.06
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1.4, h * 0.009)
    ctx.beginPath()
    ctx.moveTo(tx, ty)
    ctx.quadraticCurveTo(qx, qy, ex, ey)
    ctx.stroke()
    // leaflets: two rows swept toward the tip, drooping under their weight
    const steps = 22
    ctx.lineWidth = Math.max(1, h * 0.0045)
    for (let s2 = 2; s2 <= steps; s2++) {
      const t = s2 / steps
      const px = (1 - t) * (1 - t) * tx + 2 * (1 - t) * t * qx + t * t * ex
      const py = (1 - t) * (1 - t) * ty + 2 * (1 - t) * t * qy + t * t * ey
      // tangent of the rib at t
      let tdx = 2 * (1 - t) * (qx - tx) + 2 * t * (ex - qx)
      let tdy = 2 * (1 - t) * (qy - ty) + 2 * t * (ey - qy)
      const tl = Math.hypot(tdx, tdy) || 1
      tdx /= tl
      tdy /= tl
      const ll = len * 0.2 * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (0.7 + rand() * 0.3) + 2
      for (const side of [-1, 1]) {
        const nx = -tdy * side
        const ny = tdx * side
        const lx = px + (tdx * 0.62 + nx * 0.62) * ll
        const ly = py + (tdy * 0.62 + ny * 0.62) * ll + ll * 0.42
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(lx, ly)
        ctx.stroke()
      }
    }
    // rim light on the upper edge of the rib
    ctx.strokeStyle = rim
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(tx, ty - 1)
    ctx.quadraticCurveTo(qx, qy - 1, ex, ey - 1)
    ctx.stroke()
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(tx, ty + 2, h * 0.024, 0, Math.PI * 2)
  ctx.fill()
}

/** A leafy tree: trunk and limbs, then a canopy of a few hundred small
    clumps inside a wobbling outline, a rim light up and to the right, and
    leaves peeling off the edge so the outline is broken, not a blob. */
function paintTree(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  R: number,
  color: string,
  rim: string,
  seed: number,
  mid?: string,
): void {
  const rand = mulberry(seed)
  const cy = baseY - R * 1.25
  ctx.strokeStyle = color
  ctx.fillStyle = color
  // trunk with a flared foot
  ctx.beginPath()
  ctx.moveTo(cx - R * 0.09, baseY + 4)
  ctx.quadraticCurveTo(cx - R * 0.045, baseY - R * 0.45, cx - R * 0.04, cy + R * 0.2)
  ctx.lineTo(cx + R * 0.04, cy + R * 0.2)
  ctx.quadraticCurveTo(cx + R * 0.05, baseY - R * 0.45, cx + R * 0.1, baseY + 4)
  ctx.closePath()
  ctx.fill()
  // limbs
  ctx.lineCap = 'round'
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (rand() - 0.5) * 2.1
    ctx.lineWidth = R * (0.028 + rand() * 0.02)
    ctx.beginPath()
    ctx.moveTo(cx, cy + R * 0.35)
    ctx.lineTo(cx + Math.cos(a) * R * 0.75, cy + R * 0.2 + Math.sin(a) * R * 0.75)
    ctx.stroke()
  }
  const outline = (a: number) => 1 + 0.2 * Math.sin(a * 3 + seed) + 0.13 * Math.sin(a * 7 + 1.7 * seed)
  const blobs: [number, number, number][] = []
  for (let i = 0; i < 360; i++) {
    const a = rand() * Math.PI * 2
    const d = Math.sqrt(rand()) * 0.92
    const e = outline(a)
    blobs.push([
      cx + Math.cos(a) * d * R * e,
      cy + Math.sin(a) * d * R * e * 0.8,
      R * (0.04 + rand() * 0.07),
    ])
  }
  ctx.fillStyle = rim
  for (const [x, y, r] of blobs) {
    ctx.beginPath()
    ctx.arc(x + 1.3, y - 1.7, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = color
  for (const [x, y, r] of blobs) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  if (mid) {
    // day: a few lighter clumps catching sun on the upper right
    ctx.fillStyle = mid
    for (let i = 0; i < 90; i++) {
      const a = -Math.PI * 0.85 + rand() * Math.PI * 0.75
      const d = 0.35 + rand() * 0.5
      const e = outline(a)
      ctx.beginPath()
      ctx.arc(
        cx + Math.cos(a) * d * R * e,
        cy + Math.sin(a) * d * R * e * 0.8,
        R * (0.02 + rand() * 0.035),
        0,
        Math.PI * 2,
      )
      ctx.fill()
    }
  }
  // leaves off the edge
  ctx.fillStyle = color
  for (let i = 0; i < 260; i++) {
    const a = rand() * Math.PI * 2
    const e = outline(a) * (0.98 + rand() * 0.16)
    ctx.beginPath()
    ctx.ellipse(
      cx + Math.cos(a) * R * 0.98 * e,
      cy + Math.sin(a) * R * 0.98 * e * 0.8,
      R * 0.026,
      R * 0.012,
      rand() * Math.PI,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
}

function paintBuilding(
  ctx: CanvasRenderingContext2D,
  glow: CanvasRenderingContext2D,
  fr: Fr,
  b: Bld,
  st: Style,
  layer: LayerName,
  night: boolean,
): void {
  const rand = mulberry(b.seed)
  const x0 = fr.X(b.u0)
  const x1 = fr.X(b.u1)
  const yTop = fr.Y(b.top)
  const bw = x1 - x0
  const bottom = fr.h + 2
  const j = 0.9 + rand() * 0.2
  const g = ctx.createLinearGradient(0, yTop, 0, fr.h)
  g.addColorStop(0, css(shadeRGB(b.glass ? st.glassTop : st.bodyTop, j)))
  g.addColorStop(1, css(shadeRGB(st.bodyBot, j)))
  ctx.fillStyle = g
  ctx.fillRect(x0, yTop, bw, bottom - yTop)
  // the light comes from the right: a shoulder on the left, a lit edge on
  // the right
  ctx.fillStyle = `rgba(0,0,0,${st.shade})`
  ctx.fillRect(x0, yTop, bw * 0.16, bottom - yTop)
  ctx.fillStyle = st.rim
  ctx.fillRect(x1 - 1.5, yTop, 1.5, bottom - yTop)

  // roof furniture
  const roofFill = css(mixRGB(st.bodyTop, hex('#000000'), night ? 0.28 : 0.14))
  if (b.roof === 'tank') {
    const tw = Math.min(bw * 0.4, st.cw * 3)
    const th = tw * 0.9
    ctx.fillStyle = roofFill
    ctx.fillRect(x0 + bw * 0.2, yTop - th * 0.75, tw, th * 0.75)
    ctx.beginPath()
    ctx.ellipse(x0 + bw * 0.2 + tw / 2, yTop - th * 0.75, tw / 2, th * 0.28, 0, Math.PI, 0)
    ctx.fill()
  } else if (b.roof === 'step') {
    ctx.fillStyle = roofFill
    const sh = st.ch * 2.2
    ctx.fillRect(x0 + bw * 0.22, yTop - sh, bw * 0.5, sh)
    ctx.fillStyle = st.rim
    ctx.fillRect(x0 + bw * 0.22, yTop - sh, bw * 0.5, 1.2)
  } else if (b.roof === 'mast') {
    ctx.fillStyle = roofFill
    const mh = layer === 'far' ? fr.pxV * 0.055 : fr.pxV * 0.07
    ctx.fillRect(x0 + bw * 0.5 - 1, yTop - mh, 2, mh)
    ctx.fillRect(x0 + bw * 0.5 - 5, yTop - mh * 0.7, 10, 1.3)
    ctx.fillRect(x0 + bw * 0.5 - 3.5, yTop - mh * 0.45, 7, 1.2)
  }
  ctx.fillStyle = st.rim
  ctx.fillRect(x0, yTop, bw, 1.3)

  // facade: a grid of windows floor by floor, lit at random
  const sc = 0.85 + rand() * 0.4
  const cw = st.cw * sc
  const ch = st.ch * sc
  const ww = st.ww * sc
  const wh = st.wh * sc
  const cols = Math.max(1, Math.floor((bw - cw * 0.5) / cw))
  const gx = x0 + (bw - cols * cw) / 2
  if (layer !== 'far' && cols > 3 && rand() < 0.6) {
    // pilasters between bays
    ctx.fillStyle = 'rgba(0,0,0,0.13)'
    for (let c = 3; c < cols; c += 3) ctx.fillRect(gx + c * cw - 0.6, yTop + 2, 1.2, bottom - yTop)
  }
  for (let y = yTop + ch * 0.75; y + wh < fr.h; y += ch) {
    const rowLit = rand() < 0.14 ? 0.9 : b.lit * (0.5 + rand() * 1.0)
    for (let c = 0; c < cols; c++) {
      const wx = gx + c * cw + (cw - ww) / 2
      if (night) {
        if (rand() < rowLit) {
          const col = pickLit(rand())
          const a = 0.55 + rand() * 0.45
          ctx.fillStyle = css(col, a)
          ctx.fillRect(wx, y, ww, wh)
          glow.fillStyle = css(col, 0.9)
          glow.fillRect(wx - 0.5, y - 0.5, ww + 1, wh + 1)
        } else {
          ctx.fillStyle = st.unlit
          ctx.fillRect(wx, y, ww, wh)
        }
      } else {
        const t = rand()
        ctx.fillStyle = t < 0.16 ? st.glint : t < 0.3 ? st.curtain : st.pane
        ctx.fillRect(wx, y, ww, wh)
      }
    }
    if (layer !== 'far') {
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.fillRect(x0, y + wh + (ch - wh) * 0.45, bw, 1)
    }
  }
  // LED crown on tall towers at night
  if (night && b.roof === 'crown') {
    const cc = layer === 'far' ? hex('#7fd6ff') : hex('#ff8ad0')
    for (let x = x0 + 2; x < x1 - 2; x += 3.5) {
      ctx.fillStyle = css(cc, 0.85)
      ctx.fillRect(x, yTop + 2, 1.8, 1.5)
      glow.fillStyle = css(cc, 0.9)
      glow.fillRect(x - 0.5, yTop + 1.5, 2.8, 2.5)
    }
  }
}

function paintCityLayer(layer: LayerName, night: boolean): HTMLCanvasElement {
  const style = (night ? NIGHT_STYLE : DAY_STYLE)[layer]
  // texel density of the painted skylines: cut ~60% from the original
  // (420/440/500) — these layers sit 1.3-3.1m behind a 0.62x0.82m opening
  // and are already softened by atmospheric mist/glow, so the extra detail
  // was never resolvable from the room's camera positions
  const pxU = layer === 'far' ? 270 : layer === 'mid' ? 280 : 320
  const frame = LAYER[layer].f
  const fr = new Fr(frame, pxU)
  const ctx = makeCanvas(fr.w, fr.h, true)
  const glow = makeCanvas(fr.w, fr.h, true)

  if (layer !== 'near') {
    const list = skyline(layer === 'far' ? FAR_CITY : MID_CITY)
    for (const b of list) paintBuilding(ctx, glow, fr, b, style, layer, night)
    if (layer === 'mid') {
      // two coconut palms, the most Bengaluru thing you can put on a skyline
      const palmCol = night ? '#070a17' : '#33475c'
      const palmRim = night ? 'rgba(120,145,215,0.4)' : 'rgba(230,244,255,0.5)'
      paintPalm(ctx, fr.X(0.3), fr.Y(-0.22), fr.pxV * 0.6, fr.pxU * 0.035, palmCol, palmRim, 11)
      paintPalm(ctx, fr.X(1.5), fr.Y(-0.22), fr.pxV * 0.52, -fr.pxU * 0.05, palmCol, palmRim, 23)
    }
  } else {
    paintNear(ctx, glow, fr, night)
  }

  if (night) {
    addGlow(ctx, glow.canvas, [
      [1, 0.75],
      [3, 0.85],
      [5, 0.6],
    ])
  }
  // haze pooled low in the layer: the deeper the layer, the more of it
  if (style.mist) {
    const [mc, ma] = style.mist
    ctx.save()
    ctx.globalCompositeOperation = 'source-atop'
    const g = ctx.createLinearGradient(0, fr.Y(0.32), 0, fr.Y(-0.1))
    g.addColorStop(0, css(mc, 0))
    g.addColorStop(1, css(mc, ma))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, fr.w, fr.h)
    ctx.restore()
  }
  return ctx.canvas
}

/** The near roofs: a terrace parapet, a water tank, a clothes line with the
    day's washing, a TV antenna, a tree, and the overhead cables that cross
    every window in the city. */
function paintNear(
  ctx: CanvasRenderingContext2D,
  glow: CanvasRenderingContext2D,
  fr: Fr,
  night: boolean,
): void {
  const body = night ? '#070a16' : '#3b4a5d'
  const bodyLo = night ? '#0b0e1c' : '#455568'
  const rim = night ? 'rgba(118,140,214,0.42)' : 'rgba(226,240,252,0.6)'
  const rand = mulberry(303)

  // the neighbour's roof: parapet wall along the bottom
  const roofV = 0.085
  const gy = fr.Y(roofV)
  const wall = ctx.createLinearGradient(0, gy, 0, fr.h)
  wall.addColorStop(0, body)
  wall.addColorStop(1, bodyLo)
  ctx.fillStyle = wall
  ctx.fillRect(0, gy, fr.w, fr.h - gy)
  // render joints and a weathering stain or two
  ctx.fillStyle = 'rgba(0,0,0,0.16)'
  for (let u = -0.3; u < 1.5; u += 0.13) ctx.fillRect(fr.X(u), gy, 1.2, fr.h - gy)
  ctx.fillStyle = rim
  ctx.fillRect(0, gy, fr.w, 1.6)
  ctx.fillStyle = night ? '#0d1122' : '#4d5d70'
  ctx.fillRect(0, gy - 5, fr.w, 5)
  ctx.fillStyle = rim
  ctx.fillRect(0, gy - 5, fr.w, 1.2)

  // top-floor windows just under the parapet
  for (const [uu, w, warm] of [
    [0.42, 0.04, true],
    [0.83, 0.036, false],
  ] as const) {
    const x = fr.X(uu)
    const y = fr.Y(0.058)
    const ww = w * fr.pxU
    const hh = 0.034 * fr.pxV
    ctx.fillStyle = night ? (warm ? '#c98a40' : '#6f9fc4') : '#26364a'
    ctx.fillRect(x, y, ww, hh)
    if (night) {
      ctx.fillStyle = 'rgba(0,0,0,0.38)'
      ctx.fillRect(x, y, ww * 0.2, hh)
      ctx.fillRect(x + ww * 0.5 - 1, y, 2, hh)
      glow.fillStyle = warm ? 'rgba(255,178,90,0.55)' : 'rgba(140,200,255,0.5)'
      glow.fillRect(x, y, ww, hh)
    }
    ctx.fillStyle = body
    ctx.fillRect(x - 3, y + hh, ww + 6, 3)
  }

  // the stair-head on the left of the terrace
  ctx.fillStyle = body
  ctx.fillRect(fr.X(0.0), fr.Y(0.15), fr.pxU * 0.1, fr.Y(roofV) - fr.Y(0.15))
  ctx.fillStyle = rim
  ctx.fillRect(fr.X(0.0), fr.Y(0.15), fr.pxU * 0.1, 1.4)

  // water tank on a stand
  const tx = fr.X(0.56)
  const tw = fr.pxU * 0.075
  const th = fr.pxV * 0.085
  ctx.fillStyle = body
  for (const dx of [0.08, 0.5, 0.92]) ctx.fillRect(tx + tw * dx - 1.5, gy - th * 0.35 - 5, 3, th * 0.35)
  ctx.fillRect(tx - 2, gy - th * 0.38 - 5, tw + 4, 3)
  ctx.beginPath()
  ctx.moveTo(tx, gy - th * 0.38 - 5)
  ctx.lineTo(tx, gy - th * 0.85 - 5)
  ctx.quadraticCurveTo(tx + tw / 2, gy - th * 1.28 - 5, tx + tw, gy - th * 0.85 - 5)
  ctx.lineTo(tx + tw, gy - th * 0.38 - 5)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = rim
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(tx, gy - th * 0.85 - 5)
  ctx.quadraticCurveTo(tx + tw / 2, gy - th * 1.28 - 5, tx + tw, gy - th * 0.85 - 5)
  ctx.stroke()
  ctx.fillStyle = night ? '#0b0f1e' : '#2e3b4b'
  ctx.fillRect(tx + tw * 0.5 - 4, gy - th * 1.22 - 5, 8, 4)

  // TV antenna: a mast with crossbars
  const ax = fr.X(0.96)
  ctx.strokeStyle = body
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(ax, gy - 5)
  ctx.lineTo(ax, gy - fr.pxV * 0.15)
  ctx.stroke()
  ctx.lineWidth = 1.4
  for (let i = 0; i < 6; i++) {
    const yy = gy - fr.pxV * (0.065 + i * 0.014)
    const half = 15 - i * 2
    ctx.beginPath()
    ctx.moveTo(ax - half, yy)
    ctx.lineTo(ax + half, yy)
    ctx.stroke()
  }

  // a clothes line with the day's washing — two sarees and a towel
  const lx0 = fr.X(0.16)
  const lx1 = fr.X(0.5)
  const ly = gy - fr.pxV * 0.12
  ctx.strokeStyle = body
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(lx0, gy - 5)
  ctx.lineTo(lx0, ly - 4)
  ctx.moveTo(lx1, gy - 5)
  ctx.lineTo(lx1, ly - 4)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(lx0, ly)
  ctx.quadraticCurveTo((lx0 + lx1) / 2, ly + 8, lx1, ly)
  ctx.stroke()
  const cloths: [number, number, number, string][] = [
    [0.24, 0.06, 0.075, '#d9603b'],
    [0.32, 0.055, 0.09, '#2f7f8f'],
    [0.395, 0.035, 0.045, '#e4b23c'],
  ]
  for (const [uu, w, h, dayCol] of cloths) {
    const x = fr.X(uu)
    const ww = w * fr.pxU
    const hh = h * fr.pxV
    const sag = ly + 4
    ctx.fillStyle = night ? '#080b18' : dayCol
    ctx.beginPath()
    ctx.moveTo(x, sag)
    ctx.lineTo(x + ww, sag)
    for (let k = 0; k <= 6; k++) {
      const fx = x + ww - (k / 6) * ww
      ctx.lineTo(fx, sag + hh + Math.sin(k * 1.6 + uu * 40) * 3)
    }
    ctx.closePath()
    ctx.fill()
    if (night) {
      ctx.strokeStyle = rim
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x + ww, sag)
      for (let k = 0; k <= 6; k++) {
        const fx = x + ww - (k / 6) * ww
        ctx.lineTo(fx, sag + hh + Math.sin(k * 1.6 + uu * 40) * 3)
      }
      ctx.stroke()
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.14)'
      ctx.fillRect(x, sag, ww * 0.3, hh)
    }
  }

  // potted plants on the parapet
  ctx.fillStyle = body
  for (const uu of [0.66, 0.69, 0.72]) {
    const px = fr.X(uu)
    ctx.fillRect(px - 5, gy - 14, 10, 9)
    for (let i = 0; i < 9; i++) {
      ctx.beginPath()
      ctx.ellipse(
        px + (rand() - 0.5) * 12,
        gy - 20 - rand() * 12,
        4 + rand() * 3,
        6 + rand() * 4,
        rand(),
        0,
        Math.PI * 2,
      )
      ctx.fill()
    }
  }

  // a tree behind the parapet on the right
  paintTree(
    ctx,
    fr.X(1.2),
    gy,
    fr.pxU * 0.2,
    night ? '#050814' : '#2b4636',
    night ? 'rgba(122,146,220,0.5)' : 'rgba(210,235,200,0.55)',
    29,
    night ? undefined : '#3f6a4c',
  )

  // cables: catenaries with a hairline of rim light above each
  const wires: [number, number, number, number, number][] = [
    [-0.3, 0.46, 1.45, 0.34, 0.05],
    [-0.3, 0.4, 1.45, 0.29, 0.06],
    [-0.3, 0.2, 1.45, 0.36, 0.09],
  ]
  for (const [u0, v0, u1, v1, sag] of wires) {
    const x0 = fr.X(u0)
    const y0 = fr.Y(v0)
    const x1 = fr.X(u1)
    const y1 = fr.Y(v1)
    const mx = (x0 + x1) / 2
    const my = (y0 + y1) / 2 + sag * fr.pxV
    ctx.strokeStyle = night ? 'rgba(4,6,14,0.92)' : 'rgba(40,54,72,0.8)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.quadraticCurveTo(mx, my * 2 - (y0 + y1) / 2, x1, y1)
    ctx.stroke()
    ctx.strokeStyle = rim
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(x0, y0 - 1.3)
    ctx.quadraticCurveTo(mx, my * 2 - (y0 + y1) / 2 - 1.3, x1, y1 - 1.3)
    ctx.stroke()
  }
}

/* =====================================================================
   Bokeh: street lights and car lights, out of focus
   ===================================================================== */

function makeBokeh(): CanvasTexture {
  const fr = new Fr(LAYER.bokeh.f, 170) // out-of-focus by design; needs no fine texel grid
  const ctx = makeCanvas(fr.w, fr.h, true)
  const rand = mulberry(77)
  const sodium = hex('#ffb347')
  const warm = hex('#ffe2b0')
  const cool = hex('#bcd6ff')
  const red = hex('#ff4a3a')
  const green = hex('#6dffb0')
  const palette: [RGB, number][] = [
    [sodium, 0.4],
    [warm, 0.24],
    [cool, 0.1],
    [red, 0.12],
    [hex('#ff8a4a'), 0.1],
    [green, 0.04],
  ]
  const pick = (): RGB => {
    let r = rand()
    for (const [c, w] of palette) {
      r -= w
      if (r < 0) return c
    }
    return sodium
  }
  ctx.globalCompositeOperation = 'lighter'
  const disc = (x: number, y: number, r: number, c: RGB, a: number, sides: number) => {
    const rot = rand() * Math.PI
    const path = () => {
      ctx.beginPath()
      if (sides < 5) ctx.arc(x, y, r, 0, Math.PI * 2)
      else {
        for (let i = 0; i < sides; i++) {
          const ang = rot + (i / sides) * Math.PI * 2
          const px = x + Math.cos(ang) * r
          const py = y + Math.sin(ang) * r
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
      }
    }
    // a soft-edged body (the shadow is the falloff), a hair brighter at
    // the rim — a real out-of-focus highlight, not a ring
    ctx.save()
    ctx.shadowColor = css(c, 0.9)
    ctx.shadowBlur = Math.max(3, r * 0.5)
    ctx.fillStyle = css(c, a * 0.5)
    path()
    ctx.fill()
    ctx.restore()
    ctx.strokeStyle = css(c, a * 0.2)
    ctx.lineWidth = Math.max(1, r * 0.07)
    path()
    ctx.stroke()
    const core = ctx.createRadialGradient(x, y, 0, x, y, r * 0.8)
    core.addColorStop(0, css(mixRGB(c, [255, 255, 255], 0.5), a * 0.3))
    core.addColorStop(1, css(c, 0))
    ctx.fillStyle = core
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // a road climbing away to the left: cars strung along it
  for (let i = 0; i < 12; i++) {
    const t = i / 11
    const u = 1.32 - t * 1.2 + (rand() - 0.5) * 0.05
    const v = 0.045 + t * 0.15 + (rand() - 0.5) * 0.025
    const r = (0.036 - t * 0.016) * fr.pxU
    const c = rand() < 0.5 ? hex('#fff1d0') : red
    disc(fr.X(u), fr.Y(v), r, c, 0.8, rand() < 0.3 ? 7 : 0)
  }
  // street lamps
  for (let i = 0; i < 20; i++) {
    const u = -0.3 + rand() * 1.75
    const v = -0.18 + rand() * 0.42
    const r = (0.013 + rand() * rand() * 0.055) * fr.pxU
    disc(fr.X(u), fr.Y(v), r, pick(), 0.55 + rand() * 0.4, rand() < 0.25 ? 8 : 0)
  }
  // a couple of large, very soft ones near the sill
  for (let i = 0; i < 4; i++) {
    const u = 0.1 + rand() * 1.2
    const v = -0.3 + rand() * 0.16
    disc(fr.X(u), fr.Y(v), (0.05 + rand() * 0.03) * fr.pxU, pick(), 0.5, 0)
  }
  return layerTexture(ctx.canvas)
}

/** A point on the road the bokeh cars drive along, for k in 0…1 from the
    near right end to the far left one: world x, y, z (in the bokeh layer)
    and half the gap between a car's two lamps, which shrinks with distance. */
export function trafficPath(k: number): { x: number; y: number; z: number; gap: number } {
  const u = 1.32 - k * 1.2
  const v = 0.045 + k * 0.15
  const z = LAYER.bokeh.z + 0.01
  const [x, y] = patchToWorld(u, v, z)
  const [x2] = patchToWorld(u + 0.02 * (1 - 0.6 * k), v, z)
  return { x, y, z, gap: x2 - x }
}

/* =====================================================================
   Night / day sets
   ===================================================================== */

export interface NightScene {
  sky: CanvasTexture
  clouds: CanvasTexture
  moon: CanvasTexture
  far: CanvasTexture
  mid: CanvasTexture
  bokeh: CanvasTexture
  near: CanvasTexture
  dispose: () => void
}

export function makeNightScene(age = moonAge()): NightScene {
  const sky = gradientTile(NIGHT_SKY, 5)
  const clouds = layerTexture(
    paintClouds({ f: LAYER.clouds.f, pxU: 115, seed: 71, kind: 'bands', night: true }),
  )
  const moon = makeMoonTexture(age)
  const far = layerTexture(paintCityLayer('far', true))
  const mid = layerTexture(paintCityLayer('mid', true))
  const bokeh = makeBokeh()
  const near = layerTexture(paintCityLayer('near', true))
  return {
    sky,
    clouds,
    moon,
    far,
    mid,
    bokeh,
    near,
    dispose: () => {
      for (const t of [sky, clouds, moon, far, mid, bokeh, near]) t.dispose()
    },
  }
}

/** Lightning's wash of the sky: a tall soft gradient, brightest just above
    the roofs. Additive, sits behind the skylines so towers stay dark. */
export function makeFlashTexture(): CanvasTexture {
  const ctx = makeCanvas(4, 256)
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, 'rgba(176,190,255,0.55)')
  g.addColorStop(0.5, 'rgba(214,222,255,0.95)')
  g.addColorStop(0.72, 'rgba(236,236,255,1)')
  g.addColorStop(1, 'rgba(190,170,220,0.85)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 256)
  return layerTexture(ctx.canvas)
}

/** Three forked lightning bolts side by side in one atlas (512×1024 each).
    Each is a midpoint-displaced jagged line with a few thinner branches,
    drawn as a wide blue glow, a mid stroke and a white-hot core. */
export function makeBoltAtlas(): CanvasTexture {
  const W = 512
  const H = 1024
  const ctx = makeCanvas(W * 3, H)
  const rand = mulberry(1313)
  const jag = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    spread: number,
    depth: number,
  ): [number, number][] => {
    let pts: [number, number][] = [
      [x0, y0],
      [x1, y1],
    ]
    for (let d = 0; d < depth; d++) {
      const next: [number, number][] = []
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = pts[i]
        const [bx, by] = pts[i + 1]
        next.push(pts[i])
        next.push([(ax + bx) / 2 + (rand() - 0.5) * spread, (ay + by) / 2 + (rand() - 0.5) * spread * 0.4])
      }
      next.push(pts[pts.length - 1])
      pts = next
      spread *= 0.55
    }
    return pts
  }
  const stroke = (pts: [number, number][], ox: number, w: number, col: string, blurPx: number) => {
    ctx.save()
    ctx.strokeStyle = col
    ctx.lineWidth = w
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.shadowColor = 'rgba(150,176,255,0.95)'
    ctx.shadowBlur = blurPx
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x + ox, y) : ctx.lineTo(x + ox, y)))
    ctx.stroke()
    ctx.restore()
  }
  for (let k = 0; k < 3; k++) {
    const ox = k * W
    const startX = 200 + rand() * 110
    const main = jag(startX, 0, startX + (rand() - 0.5) * 160, H * 0.94, 150, 6)
    const branches: [number, number][][] = []
    for (let b = 0; b < 4; b++) {
      const at = main[Math.floor((0.2 + rand() * 0.55) * main.length)]
      const dir = rand() < 0.5 ? -1 : 1
      branches.push(jag(at[0], at[1], at[0] + dir * (60 + rand() * 120), at[1] + 120 + rand() * 260, 70, 4))
    }
    for (const line of [main, ...branches]) {
      const isMain = line === main
      stroke(line, ox, isMain ? 7 : 4, 'rgba(120,150,255,0.55)', isMain ? 26 : 16)
      stroke(line, ox, isMain ? 3.2 : 2, 'rgba(210,225,255,0.9)', 8)
      stroke(line, ox, isMain ? 1.5 : 1, '#ffffff', 2)
    }
  }
  const t = layerTexture(ctx.canvas)
  t.repeat.set(1 / 3, 1)
  return t
}

/* ---------- day ---------- */

/** Bengaluru daylight as the sky art sees it: a little wider than
    world.isDaylight so the last golden hour (live.dusk peaks at 18.0)
    is still painted with the sun on the horizon, not the morning. */
const SUNRISE = 6.5
const SUNSET = 18.25
const ART_DAWN = 5.75
const ART_DUSK = 19.25

interface DaySun {
  t: number
  warm: number
}

function sunState(hour: number): DaySun {
  const daylight = hour >= ART_DAWN && hour < ART_DUSK
  // outside daylight (the window clicked at night) it paints mid-morning
  const t = daylight ? clamp01((hour - SUNRISE) / (SUNSET - SUNRISE)) : 0.38
  const warm = daylight
    ? clamp01(1 - Math.min(hour - SUNRISE, SUNSET - hour) / 1.2)
    : 0
  return { t, warm }
}

/** Where the sun stands, in patch units and world units. */
export function sunPatch(hour: number): { u: number; v: number; warm: number } {
  const { t, warm } = sunState(hour)
  return { u: 0.1 + t * 0.82, v: 0.24 + Math.sin(Math.PI * t) * 0.56, warm }
}

export function sunFrame(hour: number): LayerFrame {
  const s = sunPatch(hour)
  const half = 0.34
  return { u0: s.u - half, u1: s.u + half, v0: s.v - half / ASPECT, v1: s.v + half / ASPECT }
}

/** The day sky gradient for a Bengaluru hour; warms toward orange in the
    first and last hour. Cheap (a 128×1024 tile): repainted hourly. */
export function makeDaySky(hour: number): CanvasTexture {
  const { warm } = sunState(hour)
  const day: [number, string][] = [
    [3.6, '#2b67b8'],
    [1.9, '#3f7fcb'],
    [1.2, '#5b9ad9'],
    [0.75, '#7db4e6'],
    [0.42, '#a3cdee'],
    [0.22, '#cfe5f2'],
    [0.08, '#e9f1ee'],
    [-0.3, '#c7dbe4'],
    [-2.4, '#a9bcc8'],
  ]
  const gold: [number, string][] = [
    [3.6, '#2a2f6d'],
    [1.9, '#4a4d94'],
    [1.2, '#7c6aa6'],
    [0.75, '#c77f86'],
    [0.42, '#f09c6b'],
    [0.22, '#ffbf78'],
    [0.08, '#ffdca4'],
    [-0.3, '#cf9a80'],
    [-2.4, '#7a5a5e'],
  ]
  const stops = day.map(([v, c], i): [number, RGB] => [v, mixRGB(hex(c), hex(gold[i][1]), warm)])
  return gradientTile(stops, 8)
}

/** Soft sun: white-hot core, a wide glow. Additive. */
function makeSunTexture(): CanvasTexture {
  const S = 512
  const ctx = makeCanvas(S, S)
  const c = S / 2
  const g = ctx.createRadialGradient(c, c, 0, c, c, c)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.07, 'rgba(255,252,238,1)')
  g.addColorStop(0.11, 'rgba(255,240,196,0.75)')
  g.addColorStop(0.2, 'rgba(255,226,160,0.32)')
  g.addColorStop(0.45, 'rgba(255,210,140,0.1)')
  g.addColorStop(1, 'rgba(255,200,120,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  return layerTexture(ctx.canvas)
}

function makeDayClouds(kind: 'high' | 'near'): CanvasTexture {
  return layerTexture(
    kind === 'high'
      ? paintClouds({ f: LAYER.clouds.f, pxU: 115, seed: 91, kind: 'bands', night: false })
      : paintClouds({ f: LAYER.cloudsNear.f, pxU: 165, seed: 92, kind: 'cumulus', night: false }),
  )
}

export interface DayHigh {
  clouds: CanvasTexture
  cloudsNear: CanvasTexture
  sun: CanvasTexture
  dispose: () => void
}

/** The sky's furniture that does not depend on the hour: cirrus, heaps,
    the sun disc. Split from the cities so the day set can be painted in
    slices, a few frames apart, instead of one long stall. */
export function makeDayHigh(): DayHigh {
  const clouds = makeDayClouds('high')
  const cloudsNear = makeDayClouds('near')
  const sun = makeSunTexture()
  return {
    clouds,
    cloudsNear,
    sun,
    dispose: () => {
      for (const t of [clouds, cloudsNear, sun]) t.dispose()
    },
  }
}

/** One of the three awake skylines. */
export function makeDayCity(layer: 'far' | 'mid' | 'near'): CanvasTexture {
  return layerTexture(paintCityLayer(layer, false))
}

/* =====================================================================
   Rain on the glass
   ===================================================================== */

/** A tile of falling streaks: fine, soft-edged trails that brighten toward a
    small bead at their lower head. Wraps both ways; scroll `offset.y`. */
export function makeRainStreaks(): CanvasTexture {
  const w = 256
  const h = 1024
  const ctx = makeCanvas(w, h)
  const rand = mulberry(2024)
  for (let i = 0; i < 70; i++) {
    const x = rand() * w
    const y = rand() * h
    const len = 60 + rand() * 340
    const bright = rand() < 0.22
    // a fifth of the runs are fat ones: they are what reads from across the room
    const fat = rand() < 0.2
    const width = fat ? 2.4 + rand() * 1.2 : bright ? 1.5 + rand() * 0.9 : 0.8 + rand() * 0.8
    for (const oy of [0, -h]) {
      const y0 = y + oy
      const g = ctx.createLinearGradient(0, y0, 0, y0 + len)
      g.addColorStop(0, 'rgba(190,208,245,0)')
      g.addColorStop(0.7, `rgba(205,222,255,${bright || fat ? 0.34 : 0.19})`)
      g.addColorStop(1, `rgba(235,244,255,${bright || fat ? 0.72 : 0.4})`)
      ctx.strokeStyle = g
      ctx.lineWidth = width
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x, y0)
      // a run of water wanders a little
      ctx.bezierCurveTo(
        x + (rand() - 0.5) * 3,
        y0 + len * 0.35,
        x + (rand() - 0.5) * 3,
        y0 + len * 0.7,
        x + (rand() - 0.5) * 2,
        y0 + len,
      )
      ctx.stroke()
      // the bead at the head of a run: a dark rim, then a small glint
      const br = width * 1.1 + (bright ? 1.2 : 0.5)
      ctx.fillStyle = 'rgba(8,12,28,0.34)'
      ctx.beginPath()
      ctx.arc(x, y0 + len, br + 0.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = `rgba(228,238,255,${bright ? 0.75 : 0.42})`
      ctx.beginPath()
      ctx.arc(x - br * 0.2, y0 + len - br * 0.2, br * 0.62, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const t = new CanvasTexture(ctx.canvas)
  t.colorSpace = SRGBColorSpace
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.anisotropy = 4
  t.repeat.set(1.5, 1.3)
  t.needsUpdate = true
  return t
}

/** Beads of water that stay put: a dark refractive rim, a lit crescent
    inside, a hard glint, some with a run of water above them. */
export function makeRainBeads(): CanvasTexture {
  const w = 768
  const h = 1024
  const ctx = makeCanvas(w, h)
  const rand = mulberry(515)
  const drop = (x: number, y: number, r: number, stretch: number, a: number) => {
    ctx.save()
    ctx.globalAlpha = a
    ctx.translate(x, y)
    ctx.scale(1, stretch)
    const body = ctx.createRadialGradient(0, r * 0.1, 0, 0, 0, r * 1.12)
    body.addColorStop(0, 'rgba(170,192,236,0.08)')
    body.addColorStop(0.62, 'rgba(126,152,212,0.12)')
    body.addColorStop(0.86, 'rgba(6,10,24,0.5)')
    body.addColorStop(1, 'rgba(6,10,24,0)')
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(0, 0, r * 1.12, 0, Math.PI * 2)
    ctx.fill()
    // the light the drop gathers, low inside it
    ctx.fillStyle = 'rgba(214,228,255,0.2)'
    ctx.beginPath()
    ctx.ellipse(r * 0.08, r * 0.28, r * 0.5, r * 0.3, 0, 0, Math.PI * 2)
    ctx.fill()
    // the glint
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.ellipse(-r * 0.34, -r * 0.36, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.32)'
    ctx.beginPath()
    ctx.arc(r * 0.38, r * 0.44, r * 0.1, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  // a fine scatter of tiny drops, a few fat ones, a handful mid-run
  for (let i = 0; i < 520; i++) {
    const r = 1.4 + Math.pow(rand(), 3.2) * 6
    drop(rand() * w, rand() * h, r, 1 + rand() * 0.1, 0.55 + rand() * 0.4)
  }
  for (let i = 0; i < 12; i++) {
    const x = 30 + rand() * (w - 60)
    const y = 120 + rand() * (h - 180)
    const r = 3.6 + rand() * 2.4
    const run = 50 + rand() * 170
    const g = ctx.createLinearGradient(0, y - run, 0, y)
    g.addColorStop(0, 'rgba(196,214,250,0)')
    g.addColorStop(1, 'rgba(196,214,250,0.16)')
    ctx.strokeStyle = g
    ctx.lineWidth = r * 0.5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x, y - run)
    ctx.lineTo(x + (rand() - 0.5) * 8, y)
    ctx.stroke()
    // shadowed edges of the trail
    ctx.strokeStyle = 'rgba(6,10,24,0.1)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x - r * 0.35, y - run)
    ctx.lineTo(x - r * 0.35, y)
    ctx.moveTo(x + r * 0.35, y - run)
    ctx.lineTo(x + r * 0.35, y)
    ctx.stroke()
    drop(x, y, r, 1.25, 1)
  }
  const t = new CanvasTexture(ctx.canvas)
  t.colorSpace = SRGBColorSpace
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

/* =====================================================================
   The blind gobo
   ===================================================================== */

export const BLIND_SLATS = 18

export interface Gobo {
  texture: CanvasTexture
  /** repaint the stripes for a blind that is `closed` (0 open … 1 shut) */
  paint: (closed: number) => void
}

/** A 512² projection map for the sun spot. White at mount (attach it
    THEN — a map added later changes the lights hash and recompiles every
    lit shader); horizontal bands darken as the blinds close. Linear
    colour space on purpose: the shader multiplies the light by it. */
export function makeGobo(): Gobo {
  const size = 512
  const ctx = makeCanvas(size, size)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  const texture = new CanvasTexture(ctx.canvas)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  let last = -1
  const paint = (closed: number) => {
    const c = Math.min(1, Math.max(0, closed))
    if (Math.abs(c - last) < 0.01) return
    last = c
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    if (c > 0.005) {
      const band = size / BLIND_SLATS
      // even shut, a blind leaks bars of light between the slats — the
      // stripes across the desk are the point
      const dark = band * (0.1 + 0.55 * c)
      ctx.fillStyle = `rgba(0,0,0,${(0.88 * c).toFixed(3)})`
      for (let i = 0; i < BLIND_SLATS; i++) {
        ctx.fillRect(0, i * band + (band - dark) / 2, size, dark)
      }
    }
    texture.needsUpdate = true
  }
  return { texture, paint }
}

/* =====================================================================
   The wall clock's dial and nameplate
   ===================================================================== */

/** Height field (0..1) from a canvas's red channel, lightly blurred. */
function fieldFromCanvas(c: HTMLCanvasElement): Float32Array {
  const size = c.width
  const b = scaledCopy(blur(c, 1), size, c.height)
  const ctx = b.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  const d = ctx.getImageData(0, 0, size, c.height).data
  const out = new Float32Array(size * c.height)
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255
  return out
}

function dataTexture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c)
  t.colorSpace = NoColorSpace
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

export interface ClockFace {
  map: CanvasTexture
  normalMap: CanvasTexture
}

/** Cream dial: minute track, raised hour bars, embossed numerals, a maker's
    mark and IST under the pivot. The relief is a second canvas turned into
    a normal map, so the printing catches the lamp. */
export function makeClockFace(): ClockFace {
  const S = 512
  const c = S / 2
  const ctx = makeCanvas(S, S, true)
  const rel = makeCanvas(S, S, true)
  rel.fillStyle = '#000'
  rel.fillRect(0, 0, S, S)
  // paper: warm cream, yellowed toward the rim
  const paper = ctx.createRadialGradient(c - 30, c - 40, 20, c, c, c)
  paper.addColorStop(0, '#f1ebdb')
  paper.addColorStop(0.75, '#e6dfcb')
  paper.addColorStop(1, '#d3c8ac')
  ctx.fillStyle = paper
  ctx.beginPath()
  ctx.arc(c, c, c, 0, Math.PI * 2)
  ctx.fill()
  // the printed chapter ring
  ctx.strokeStyle = '#a89e88'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(c, c, 228, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(c, c, 196, 0, Math.PI * 2)
  ctx.stroke()
  const ink = '#241f18'
  // ticks
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0
    const a = (i / 60) * Math.PI * 2
    const r0 = major ? 200 : 214
    const r1 = 226
    for (const [g, col, wd] of [
      [ctx, major ? ink : '#6e6555', major ? 7 : 2.4],
      [rel, '#ffffff', major ? 7 : 2.4],
    ] as const) {
      g.strokeStyle = col
      g.lineWidth = wd
      g.lineCap = 'butt'
      g.beginPath()
      g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0)
      g.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1)
      g.stroke()
    }
  }
  // numerals: a bold humanist serif, all twelve
  const nums = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const rr = 160
    const x = c + Math.sin(a) * rr
    const y = c - Math.cos(a) * rr
    for (const [g, col] of [
      [ctx, ink],
      [rel, '#ffffff'],
    ] as const) {
      g.fillStyle = col
      g.font = '700 50px Georgia, "Times New Roman", serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(nums[i], x, y + 2)
    }
  }
  // maker's mark and zone
  for (const [g, col] of [
    [ctx, '#5a5142'],
    [rel, '#a0a0a0'],
  ] as const) {
    g.fillStyle = col
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = '600 15px Georgia, serif'
    g.fillText('S Y N T H V I S I O N', c, c - 78)
    g.font = 'italic 600 15px Georgia, serif'
    g.fillText('quartz', c, c - 60)
    g.font = '700 17px Georgia, serif'
    g.fillText('I S T', c, c + 84)
  }
  // faint foxing and dust so it is not a decal
  const rand = mulberry(818)
  for (let i = 0; i < 140; i++) {
    const a = rand() * Math.PI * 2
    const d = Math.sqrt(rand()) * c * 0.98
    ctx.fillStyle = `rgba(120,96,56,${0.03 + rand() * 0.08})`
    ctx.beginPath()
    ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, 0.8 + rand() * 2.2, 0, Math.PI * 2)
    ctx.fill()
  }
  const map = new CanvasTexture(ctx.canvas)
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 8
  map.minFilter = LinearMipmapLinearFilter
  map.magFilter = LinearFilter
  map.needsUpdate = true
  const normalMap = dataTexture(normalCanvas(fieldFromCanvas(rel.canvas), S, 1.1))
  return { map, normalMap }
}

export interface Plate {
  map: CanvasTexture
  normalMap: CanvasTexture
}

/** Brass nameplate: brushed, with the city engraved into it. */
export function makeClockPlate(text = 'BENGALURU'): Plate {
  const W = 512
  const H = 93
  const ctx = makeCanvas(W, H, true)
  const rel = makeCanvas(W, H, true)
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#dcbb6c')
  g.addColorStop(0.45, '#c59f4e')
  g.addColorStop(1, '#a07d3a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  rel.fillStyle = '#808080'
  rel.fillRect(0, 0, W, H)
  const rand = mulberry(31)
  // brushed grain
  for (let i = 0; i < 380; i++) {
    const y = rand() * H
    ctx.strokeStyle = `rgba(${rand() < 0.5 ? '255,236,180' : '70,50,16'},${0.05 + rand() * 0.1})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y + (rand() - 0.5) * 4)
    ctx.stroke()
  }
  // engraved letters, spaced by hand
  const font = '700 60px Georgia, "Times New Roman", serif'
  ctx.font = font
  const tracking = 8
  const widths = [...text].map((ch) => ctx.measureText(ch).width)
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (text.length - 1)
  let x = (W - total) / 2
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    // highlight below-right, then the dark cut
    ctx.font = font
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(255,240,190,0.7)'
    ctx.fillText(ch, x + 1.4, H / 2 + 3.4)
    ctx.fillStyle = '#1c1006'
    ctx.fillText(ch, x, H / 2 + 2)
    rel.font = font
    rel.textBaseline = 'middle'
    rel.fillStyle = '#000000'
    rel.fillText(ch, x, H / 2 + 2)
    x += widths[i] + tracking
  }
  // a fine bevel
  ctx.strokeStyle = 'rgba(255,240,190,0.5)'
  ctx.lineWidth = 3
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3)
  ctx.strokeStyle = 'rgba(60,40,10,0.45)'
  ctx.strokeRect(4.5, 4.5, W - 9, H - 9)
  const map = new CanvasTexture(ctx.canvas)
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 8
  map.minFilter = LinearMipmapLinearFilter
  map.magFilter = LinearFilter
  map.needsUpdate = true
  // relief needs a square field for normalCanvas: pad to W×W, crop by UV
  const sq = makeCanvas(W, W, true)
  sq.fillStyle = '#808080'
  sq.fillRect(0, 0, W, W)
  sq.drawImage(rel.canvas, 0, (W - H) / 2)
  const nCanvas = normalCanvas(fieldFromCanvas(sq.canvas), W, 0.7)
  const crop = makeCanvas(W, H)
  crop.drawImage(nCanvas, 0, (W - H) / 2, W, H, 0, 0, W, H)
  const normalMap = dataTexture(crop.canvas)
  return { map, normalMap }
}
