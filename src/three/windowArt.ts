import { CanvasTexture, LinearFilter, RepeatWrapping } from 'three'
import { drawPixelText, finish, makeCanvas, mulberry } from './textures'

/* =====================================================================
   Everything painted on the far side of the glass — and the one thing
   painted THROUGH it (the blind gobo the sun projects onto the desk).
   Same pixel language as textures.ts (192×256, Nearest), but these
   pictures know what time it is: the day sky takes the hour, the night
   sky carries the real moon.
   ===================================================================== */

const W = 192
const H = 256

/* the skyline both skies share — heights per 24px tower */
const TOWERS = [46, 72, 38, 88, 56, 66, 30, 78]

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

/** Draw a moon of the given age: dark disc, then the lit region as one
    path — the half-disc facing the sun plus (gibbous) or minus (crescent)
    a half-ellipse whose horizontal axis is cos of the phase angle. Seen
    from the northern hemisphere, so a waxing moon is lit on the right. */
function drawMoon(
  ctx: CanvasRenderingContext2D,
  mx: number,
  my: number,
  r: number,
  age: number,
): void {
  const phase = age / SYNODIC // 0 new, 0.5 full
  const waxing = phase < 0.5
  const p = waxing ? phase : 1 - phase // 0 … 0.5
  const a = Math.cos(2 * Math.PI * p) * r // signed terminator half-axis
  const crescent = a > 0

  // dark limb: barely there, so a thin crescent still reads as a disc
  ctx.fillStyle = '#1b2448'
  ctx.beginPath()
  ctx.arc(mx, my, r, 0, Math.PI * 2)
  ctx.fill()

  ctx.save()
  if (!waxing) {
    // mirror so the lit side is on the left
    ctx.translate(mx * 2, 0)
    ctx.scale(-1, 1)
  }
  ctx.beginPath()
  // lit half-disc, top → bottom along the right edge
  ctx.arc(mx, my, r, -Math.PI / 2, Math.PI / 2)
  if (crescent) {
    // back up along the terminator (right side of the ellipse)
    ctx.ellipse(mx, my, Math.max(a, 0.01), r, 0, Math.PI / 2, -Math.PI / 2, true)
  } else {
    // continue round the far side of the ellipse (left)
    ctx.ellipse(mx, my, Math.max(-a, 0.01), r, 0, Math.PI / 2, (Math.PI * 3) / 2)
  }
  ctx.closePath()
  ctx.clip()

  ctx.fillStyle = '#e9edf7'
  ctx.beginPath()
  ctx.arc(mx, my, r, 0, Math.PI * 2)
  ctx.fill()
  // the same three maria the old moon had
  ctx.fillStyle = '#c3cbe0'
  ctx.fillRect(mx - 10, my - 4, 7, 7)
  ctx.fillRect(mx + 4, my + 6, 5, 5)
  ctx.fillRect(mx - 2, my - 14, 4, 4)
  ctx.restore()
}

/* ---------- night ---------- */

/** Night sky: stars, the real moon, the sleeping city. */
export function makeNightWindow(age = moonAge()): CanvasTexture {
  const ctx = makeCanvas(W, H)
  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#070b1c')
  sky.addColorStop(0.65, '#101a3a')
  sky.addColorStop(1, '#1a2547')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)
  const rand = mulberry(7)
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = rand() < 0.3 ? '#dfe6f7' : '#7f8db3'
    ctx.fillRect(
      Math.floor(rand() * W),
      Math.floor(rand() * 190),
      rand() < 0.15 ? 2 : 1,
      1,
    )
  }
  drawMoon(ctx, 132, 58, 22, age)
  // sleeping city silhouette
  let x = 0
  TOWERS.forEach((h, i) => {
    const w = 24
    ctx.fillStyle = '#04060e'
    ctx.fillRect(x, H - h, w, h)
    const r2 = mulberry(i * 31 + 5)
    for (let wy = 0; wy < Math.floor(h / 14); wy++) {
      for (let wx = 0; wx < 3; wx++) {
        if (r2() < 0.24) {
          ctx.fillStyle = '#f0a72b'
          ctx.fillRect(x + 4 + wx * 7, H - h + 6 + wy * 14, 3, 4)
        }
      }
    }
    x += w
  })
  return finish(ctx)
}

/* ---------- day ---------- */

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (s: number) =>
    Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`
}

/** Bengaluru daylight as the sky art sees it: a little wider than
    world.isDaylight so the last golden hour (live.dusk peaks at 18.0)
    is still painted with the sun on the horizon, not the morning. */
const SUNRISE = 6.5
const SUNSET = 18.25
const ART_DAWN = 5.75
const ART_DUSK = 19.25

/** Day sky for a given Bengaluru hour: the sun climbs and sets, and the
    whole picture warms toward orange in the first and last hour. Outside
    daylight (the window clicked at night) it paints mid-morning. */
export function makeDayWindow(hour: number): CanvasTexture {
  const ctx = makeCanvas(W, H)
  const daylight = hour >= ART_DAWN && hour < ART_DUSK
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
  const t = daylight ? clamp01((hour - SUNRISE) / (SUNSET - SUNRISE)) : 0.38
  // golden weight: within ~1.2 h of either horizon
  const warm = daylight
    ? clamp01(1 - Math.min(hour - SUNRISE, SUNSET - hour) / 1.2)
    : 0

  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, mix('#3f7ecb', '#4a4f8f', warm))
  sky.addColorStop(0.6, mix('#7cb3e6', '#d98a62', warm))
  sky.addColorStop(1, mix('#cfe6f4', '#ffb46a', warm))
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)

  // the sun's arc: left to right, high at noon, low at the horizons
  const sx = Math.round(28 + t * 136)
  const sy = Math.round(178 - Math.sin(Math.PI * t) * 128)
  const sunCore = mix('#ffd94d', '#ff9a4a', warm)
  ctx.fillStyle = warm > 0.5 ? 'rgba(255, 190, 120, 0.5)' : 'rgba(255, 243, 176, 0.55)'
  ctx.beginPath()
  ctx.arc(sx, sy, 30, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = sunCore
  ctx.beginPath()
  ctx.arc(sx, sy, 20, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = mix('#fff0a8', '#ffcf8a', warm)
  ctx.fillRect(sx - 10, sy - 10, 8, 8)
  ctx.fillStyle = sunCore
  const rays: [number, number, number, number][] = [
    [sx - 2, sy - 34, 4, 9],
    [sx - 2, sy + 25, 4, 9],
    [sx - 34, sy - 2, 9, 4],
    [sx + 25, sy - 2, 9, 4],
    [sx - 27, sy - 27, 6, 6],
    [sx + 21, sy - 27, 6, 6],
    [sx - 27, sy + 21, 6, 6],
    [sx + 21, sy + 21, 6, 6],
  ]
  rays.forEach(([x, y, w, h]) => ctx.fillRect(x, y, w, h))

  // chunky clouds, pink-bellied at golden hour
  const cloud = (cx: number, cy: number, s: number) => {
    ctx.fillStyle = mix('#f4f9ff', '#ffd9b8', warm)
    ctx.fillRect(cx, cy, 34 * s, 10 * s)
    ctx.fillRect(cx + 6 * s, cy - 6 * s, 16 * s, 8 * s)
    ctx.fillStyle = mix('#d7e6f3', '#d9906e', warm)
    ctx.fillRect(cx, cy + 7 * s, 34 * s, 3 * s)
  }
  cloud(18, 44, 1)
  cloud(96, 104, 0.8)
  cloud(40, 148, 0.6)

  // a few pixel birds heading somewhere better
  ctx.fillStyle = '#28394f'
  ;[
    [58, 78],
    [70, 70],
    [82, 82],
  ].forEach(([bx, by]) => {
    ctx.fillRect(bx, by, 3, 2)
    ctx.fillRect(bx + 3, by - 2, 3, 2)
    ctx.fillRect(bx + 6, by, 3, 2)
  })

  // the skyline, awake — hazy faces, glinting glass, lamps coming on late
  const rand = mulberry(7)
  const face = mix('#7e93ae', '#5c4a5a', warm)
  const cap = mix('#93a8c2', '#b07a68', warm)
  let x = 0
  TOWERS.forEach((h, i) => {
    const w = 24
    ctx.fillStyle = face
    ctx.fillRect(x, H - h, w, h)
    ctx.fillStyle = cap
    ctx.fillRect(x, H - h, w, 3)
    const r2 = mulberry(i * 31 + 5)
    for (let wy = 0; wy < Math.floor(h / 14); wy++) {
      for (let wx = 0; wx < 3; wx++) {
        if (r2() < 0.24) {
          const glint = rand() < 0.3
          ctx.fillStyle = glint
            ? mix('#eef6ff', '#ffd27a', warm)
            : mix('#5f7797', '#3b2f40', warm)
          ctx.fillRect(x + 4 + wx * 7, H - h + 6 + wy * 14, 3, 4)
        }
      }
    }
    x += w
  })
  return finish(ctx)
}

/* ---------- rain on the glass ---------- */

/** A tile of falling streaks. Wraps both ways; scroll `offset.y`. */
export function makeRainStreaks(): CanvasTexture {
  const w = 64
  const h = 256
  const ctx = makeCanvas(w, h)
  const rand = mulberry(2024)
  for (let i = 0; i < 20; i++) {
    const x = Math.floor(rand() * w)
    const y = Math.floor(rand() * h)
    const len = 10 + Math.floor(rand() * 40)
    const bright = rand() < 0.3
    ctx.fillStyle = bright ? 'rgba(220,232,255,0.8)' : 'rgba(180,196,230,0.4)'
    ctx.fillRect(x, y, 1, len)
    // wrap the tail so the tile tiles
    if (y + len > h) ctx.fillRect(x, 0, 1, y + len - h)
    // a bead at the head of the brighter drops
    if (bright) {
      ctx.fillStyle = 'rgba(240,246,255,0.95)'
      ctx.fillRect(x - 1, y + len - 2, 3, 2)
    }
  }
  const tex = finish(ctx)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.repeat.set(1.5, 1.3)
  return tex
}

/* ---------- the blind gobo ---------- */

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

/* ---------- the wall clock's face ---------- */

/** Cream dial: sixty ticks, four pixel numerals, IST under the pivot. */
export function makeClockFace(): CanvasTexture {
  const S = 256
  const ctx = makeCanvas(S, S)
  const c = S / 2
  ctx.fillStyle = '#e9e3d3'
  ctx.beginPath()
  ctx.arc(c, c, c, 0, Math.PI * 2)
  ctx.fill()
  // faint chapter ring
  ctx.strokeStyle = '#cfc6b2'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(c, c, 112, 0, Math.PI * 2)
  ctx.stroke()
  // ticks
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0
    const a = (i / 60) * Math.PI * 2
    const r0 = major ? 96 : 104
    const r1 = 111
    ctx.strokeStyle = major ? '#2b2620' : '#8a8274'
    ctx.lineWidth = major ? 4 : 2
    ctx.beginPath()
    ctx.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0)
    ctx.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1)
    ctx.stroke()
  }
  // numerals at the quarters
  drawPixelText(ctx, '12', c - 13, c - 92, 4, '#2b2620')
  drawPixelText(ctx, '3', c + 68, c - 10, 4, '#2b2620')
  drawPixelText(ctx, '6', c - 6, c + 70, 4, '#2b2620')
  drawPixelText(ctx, '9', c - 80, c - 10, 4, '#2b2620')
  drawPixelText(ctx, 'IST', c - 10, c + 30, 2, '#8a8274')
  return finish(ctx, false)
}
