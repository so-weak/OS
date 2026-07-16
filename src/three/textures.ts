/* =====================================================================
   Procedural canvas textures — every "printed" pixel in the room is
   drawn here at runtime. No image files, all original art.
   ===================================================================== */

import {
  CanvasTexture,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'

/* Deterministic PRNG so StrictMode double-renders draw identical art. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return ctx
}

function finish(ctx: CanvasRenderingContext2D, pixel = true): CanvasTexture {
  const tex = new CanvasTexture(ctx.canvas)
  tex.colorSpace = SRGBColorSpace
  if (pixel) {
    tex.magFilter = NearestFilter
  }
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

/* ---------------------------------------------------------------------
   3×5 pixel font — original glyphs, used for posters/labels/badges.
   --------------------------------------------------------------------- */
const FONT: Record<string, [string, string, string, string, string]> = {
  A: ['.X.', 'X.X', 'XXX', 'X.X', 'X.X'],
  B: ['XX.', 'X.X', 'XX.', 'X.X', 'XX.'],
  C: ['.XX', 'X..', 'X..', 'X..', '.XX'],
  D: ['XX.', 'X.X', 'X.X', 'X.X', 'XX.'],
  E: ['XXX', 'X..', 'XX.', 'X..', 'XXX'],
  F: ['XXX', 'X..', 'XX.', 'X..', 'X..'],
  G: ['.XX', 'X..', 'X.X', 'X.X', '.XX'],
  H: ['X.X', 'X.X', 'XXX', 'X.X', 'X.X'],
  I: ['XXX', '.X.', '.X.', '.X.', 'XXX'],
  J: ['..X', '..X', '..X', 'X.X', '.X.'],
  K: ['X.X', 'X.X', 'XX.', 'X.X', 'X.X'],
  L: ['X..', 'X..', 'X..', 'X..', 'XXX'],
  M: ['X.X', 'XXX', 'XXX', 'X.X', 'X.X'],
  N: ['XX.', 'X.X', 'X.X', 'X.X', 'X.X'],
  O: ['.X.', 'X.X', 'X.X', 'X.X', '.X.'],
  P: ['XX.', 'X.X', 'XX.', 'X..', 'X..'],
  Q: ['.X.', 'X.X', 'X.X', 'X.X', '.XX'],
  R: ['XX.', 'X.X', 'XX.', 'X.X', 'X.X'],
  S: ['.XX', 'X..', '.X.', '..X', 'XX.'],
  T: ['XXX', '.X.', '.X.', '.X.', '.X.'],
  U: ['X.X', 'X.X', 'X.X', 'X.X', 'XXX'],
  V: ['X.X', 'X.X', 'X.X', 'X.X', '.X.'],
  W: ['X.X', 'X.X', 'XXX', 'XXX', 'X.X'],
  X: ['X.X', 'X.X', '.X.', 'X.X', 'X.X'],
  Y: ['X.X', 'X.X', '.X.', '.X.', '.X.'],
  Z: ['XXX', '..X', '.X.', 'X..', 'XXX'],
  '0': ['.X.', 'X.X', 'X.X', 'X.X', '.X.'],
  '1': ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
  '2': ['XX.', '..X', '.X.', 'X..', 'XXX'],
  '3': ['XX.', '..X', '.X.', '..X', 'XX.'],
  '4': ['X.X', 'X.X', 'XXX', '..X', '..X'],
  '5': ['XXX', 'X..', 'XX.', '..X', 'XX.'],
  '6': ['.XX', 'X..', 'XX.', 'X.X', '.X.'],
  '7': ['XXX', '..X', '.X.', '.X.', '.X.'],
  '8': ['.X.', 'X.X', '.X.', 'X.X', '.X.'],
  '9': ['.X.', 'X.X', '.XX', '..X', 'XX.'],
  '.': ['...', '...', '...', '...', '.X.'],
  '!': ['.X.', '.X.', '.X.', '...', '.X.'],
  '-': ['...', '...', 'XXX', '...', '...'],
  '_': ['...', '...', '...', '...', 'XXX'],
  ':': ['...', '.X.', '...', '.X.', '...'],
  '>': ['X..', '.X.', '..X', '.X.', 'X..'],
  '/': ['..X', '..X', '.X.', 'X..', 'X..'],
  ' ': ['...', '...', '...', '...', '...'],
}

/** Width in pixels of a string rendered with drawPixelText at cell=1. */
export function pixelTextWidth(text: string): number {
  return text.length * 4 - 1
}

function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  cell: number,
  color: string,
): void {
  ctx.fillStyle = color
  let cx = x
  for (const raw of text.toUpperCase()) {
    const glyph = FONT[raw] ?? FONT[' ']
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if (glyph[r][c] === 'X') {
          ctx.fillRect(cx + c * cell, y + r * cell, cell, cell)
        }
      }
    }
    cx += 4 * cell
  }
}

/** Draw a char-map of pixels using a palette ('.' = skip). */
function drawArt(
  ctx: CanvasRenderingContext2D,
  art: string[],
  palette: Record<string, string>,
  x: number,
  y: number,
  cell: number,
): void {
  art.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const key = row[c]
      if (key === '.') continue
      const color = palette[key]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x + c * cell, y + r * cell, cell, cell)
    }
  })
}

/* ---------------------------------------------------------------------
   Posters
   --------------------------------------------------------------------- */

const ROCKET: string[] = [
  '.....n.....',
  '....nnn....',
  '...nnnnn...',
  '...wwwww...',
  '...wwcww...',
  '...wcccw...',
  '...wwcww...',
  '...wwwww...',
  '..fwwwwwf..',
  '.ffwwwwwff.',
  '.ffwwwwwff.',
  '...wwwww...',
  '...aaaaa...',
  '....aya....',
  '....aya....',
  '.....y.....',
]

/** "SHIP IT!" rocket poster. */
export function makeRocketPoster(): CanvasTexture {
  const ctx = makeCanvas(160, 208)
  ctx.fillStyle = '#101a33'
  ctx.fillRect(0, 0, 160, 208)
  // starfield
  const rand = mulberry(42)
  for (let i = 0; i < 46; i++) {
    const s = rand() < 0.2 ? 2 : 1
    ctx.fillStyle = rand() < 0.5 ? '#a9b7d8' : '#5d6d94'
    ctx.fillRect(
      6 + Math.floor(rand() * 148),
      6 + Math.floor(rand() * 160),
      s,
      s,
    )
  }
  drawArt(
    ctx,
    ROCKET,
    {
      n: '#e8483f',
      w: '#f4f1e8',
      c: '#1786a0',
      f: '#e8483f',
      a: '#f0a72b',
      y: '#ffe08a',
    },
    36,
    18,
    8,
  )
  const text = 'SHIP IT!'
  const cell = 4
  drawPixelText(
    ctx,
    text,
    Math.round((160 - pixelTextWidth(text) * cell) / 2),
    172,
    cell,
    '#f0a72b',
  )
  // border
  ctx.strokeStyle = '#f0a72b'
  ctx.lineWidth = 4
  ctx.strokeRect(4, 4, 152, 200)
  return finish(ctx)
}

const FLOPPY_ART: string[] = [
  'BBBBBBBBBBB.',
  'BBBSSSSSBBBB',
  'BBBSSDDSBBBB',
  'BBBSSDDSBBBB',
  'BBBSSSSSBBBB',
  'BBBBBBBBBBBB',
  'BBLLLLLLLLBB',
  'BBLppppppLBB',
  'BBLLLLLLLLBB',
  'BBLppppppLBB',
  'BBLLLLLLLLBB',
  'BBBBBBBBBBBB',
]

/** "SAVE EARLY / SAVE OFTEN" floppy poster. */
export function makeFloppyPoster(): CanvasTexture {
  const ctx = makeCanvas(128, 168)
  ctx.fillStyle = '#0d221a'
  ctx.fillRect(0, 0, 128, 168)
  drawArt(
    ctx,
    FLOPPY_ART,
    {
      B: '#2b3a8c',
      S: '#b9bdc9',
      D: '#23262e',
      L: '#eceadf',
      p: '#1786a0',
    },
    16,
    14,
    8,
  )
  drawPixelText(ctx, 'SAVE EARLY', 26, 122, 2, '#33ff66')
  drawPixelText(ctx, 'SAVE OFTEN', 26, 140, 2, '#33ff66')
  ctx.strokeStyle = '#33ff66'
  ctx.lineWidth = 3
  ctx.strokeRect(3, 3, 122, 162)
  return finish(ctx)
}

/* ---------------------------------------------------------------------
   Sticky note — handwritten hint on the monitor bezel.
   --------------------------------------------------------------------- */
export function makeStickyNote(): CanvasTexture {
  const ctx = makeCanvas(128, 128)
  ctx.fillStyle = '#f6d84f'
  ctx.fillRect(0, 0, 128, 128)
  // slightly sun-faded top edge + curled corner shadow
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(0, 0, 128, 14)
  ctx.fillStyle = '#d9b93a'
  ctx.beginPath()
  ctx.moveTo(128, 128)
  ctx.lineTo(104, 128)
  ctx.lineTo(128, 104)
  ctx.closePath()
  ctx.fill()
  ctx.save()
  ctx.translate(64, 56)
  ctx.rotate(-0.07)
  ctx.fillStyle = '#28417e'
  ctx.font = "26px 'Comic Sans MS', 'Marker Felt', 'Segoe Print', cursive"
  ctx.textAlign = 'center'
  ctx.fillText('try the', 0, -8)
  ctx.fillText('terminal', 0, 24)
  ctx.restore()
  // little prompt doodle
  ctx.fillStyle = '#28417e'
  drawPixelText(ctx, '>_', 50, 96, 4, '#28417e')
  return finish(ctx, false)
}

/* ---------------------------------------------------------------------
   Readable mini-documents — lifted off the desk paper stack. Real body
   fonts (already loaded document-wide) drawn onto a paper canvas.
   --------------------------------------------------------------------- */
export function makeDocument(title: string, paragraphs: string[]): CanvasTexture {
  const W = 512
  const H = 704
  const ctx = makeCanvas(W, H)
  ctx.fillStyle = '#fdfcf7' // --paper
  ctx.fillRect(0, 0, W, H)
  // aged edges
  ctx.fillStyle = 'rgba(68, 65, 58, 0.12)'
  ctx.fillRect(0, 0, W, 3)
  ctx.fillRect(0, H - 3, W, 3)
  ctx.fillRect(0, 0, 3, H)
  ctx.fillRect(W - 3, 0, 3, H)
  // red margin rule + punch holes
  ctx.fillStyle = 'rgba(232, 72, 63, 0.35)'
  ctx.fillRect(52, 0, 2, H)
  ctx.fillStyle = '#dedbd0'
  ;[120, 352, 584].forEach((y) => {
    ctx.beginPath()
    ctx.arc(26, y, 9, 0, Math.PI * 2)
    ctx.fill()
  })
  // faint coffee ring
  ctx.strokeStyle = 'rgba(107, 74, 47, 0.16)'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.arc(408, 610, 42, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = '#1a1812'
  ctx.font = '34px "VT323", monospace'
  ctx.fillText(title, 72, 62)
  ctx.fillStyle = '#8a857a'
  ctx.fillRect(72, 76, W - 128, 2)

  ctx.font = '23px "VT323", monospace'
  ctx.fillStyle = '#2c2a24'
  const maxW = W - 72 - 44
  let y = 116
  for (const para of paragraphs) {
    let line = ''
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, 72, y)
        y += 27
        line = word
      } else {
        line = test
      }
      if (y > H - 48) break
    }
    if (line && y <= H - 48) {
      ctx.fillText(line, 72, y)
      y += 27
    }
    y += 13
    if (y > H - 48) break
  }
  drawPixelText(ctx, 'SOUBHIK SYSTEMS INTERNAL', 72, H - 30, 2, '#a29d90')
  return finish(ctx, false)
}

/* ---------------------------------------------------------------------
   Trash-toss scoreboard, re-drawn whenever the tally changes.
   --------------------------------------------------------------------- */
export function makeScoreboard(
  sunk: number,
  missed: number,
  streak: number,
): CanvasTexture {
  const W = 128
  const H = 72
  const ctx = makeCanvas(W, H)
  ctx.fillStyle = '#0b0d0c'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = '#2c4136'
  ctx.lineWidth = 2
  ctx.strokeRect(2, 2, W - 4, H - 4)
  drawPixelText(ctx, `IN ${sunk}`, 10, 10, 4, '#33ff66')
  drawPixelText(ctx, `MISS ${missed}`, 10, 36, 4, '#e8483f')
  // streak pips — three in a row earns the dance
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < streak % 3 || (streak > 0 && streak % 3 === 0)
      ? '#f0a72b'
      : '#20281f'
    ctx.fillRect(96 + 0, 12 + i * 18, 10, 10)
  }
  return finish(ctx)
}

/** Soft radial dot — steam puffs and celebration sparks. */
export function makeSoftCircle(): CanvasTexture {
  const ctx = makeCanvas(64, 64)
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30)
  g.addColorStop(0, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return finish(ctx, false)
}

/* ---------------------------------------------------------------------
   Night window
   --------------------------------------------------------------------- */
export function makeNightWindow(): CanvasTexture {
  const ctx = makeCanvas(192, 256)
  const sky = ctx.createLinearGradient(0, 0, 0, 256)
  sky.addColorStop(0, '#070b1c')
  sky.addColorStop(0.65, '#101a3a')
  sky.addColorStop(1, '#1a2547')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, 192, 256)
  const rand = mulberry(7)
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = rand() < 0.3 ? '#dfe6f7' : '#7f8db3'
    ctx.fillRect(
      Math.floor(rand() * 192),
      Math.floor(rand() * 190),
      rand() < 0.15 ? 2 : 1,
      1,
    )
  }
  // pixel moon
  const mx = 132
  const my = 58
  ctx.fillStyle = '#e9edf7'
  ctx.beginPath()
  ctx.arc(mx, my, 22, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#c3cbe0'
  ctx.fillRect(mx - 10, my - 4, 7, 7)
  ctx.fillRect(mx + 4, my + 6, 5, 5)
  ctx.fillRect(mx - 2, my - 14, 4, 4)
  // sleeping city silhouette
  ctx.fillStyle = '#04060e'
  const heights = [46, 72, 38, 88, 56, 66, 30, 78]
  let x = 0
  heights.forEach((h, i) => {
    const w = 24
    ctx.fillRect(x, 256 - h, w, h)
    const r2 = mulberry(i * 31 + 5)
    for (let wy = 0; wy < Math.floor(h / 14); wy++) {
      for (let wx = 0; wx < 3; wx++) {
        if (r2() < 0.24) {
          ctx.fillStyle = '#f0a72b'
          ctx.fillRect(x + 4 + wx * 7, 256 - h + 6 + wy * 14, 3, 4)
          ctx.fillStyle = '#04060e'
        }
      }
    }
    x += w
  })
  return finish(ctx)
}

/* ---------------------------------------------------------------------
   Day window — same frame, the sun on shift (day mode)
   --------------------------------------------------------------------- */
export function makeDayWindow(): CanvasTexture {
  const ctx = makeCanvas(192, 256)
  const sky = ctx.createLinearGradient(0, 0, 0, 256)
  sky.addColorStop(0, '#3f7ecb')
  sky.addColorStop(0.6, '#7cb3e6')
  sky.addColorStop(1, '#cfe6f4')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, 192, 256)

  // pixel sun where the moon hangs at night, blocky rays and all
  const sx = 132
  const sy = 58
  ctx.fillStyle = 'rgba(255, 243, 176, 0.55)'
  ctx.beginPath()
  ctx.arc(sx, sy, 30, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffd94d'
  ctx.beginPath()
  ctx.arc(sx, sy, 20, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff0a8'
  ctx.fillRect(sx - 10, sy - 10, 8, 8)
  ctx.fillStyle = '#ffd94d'
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

  // chunky clouds drifting past
  const cloud = (cx: number, cy: number, s: number) => {
    ctx.fillStyle = '#f4f9ff'
    ctx.fillRect(cx, cy, 34 * s, 10 * s)
    ctx.fillRect(cx + 6 * s, cy - 6 * s, 16 * s, 8 * s)
    ctx.fillStyle = '#d7e6f3'
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

  // the same skyline, awake now — hazy daylight faces, glinting glass
  const rand = mulberry(7)
  ctx.fillStyle = '#04060e'
  const heights = [46, 72, 38, 88, 56, 66, 30, 78]
  let x = 0
  heights.forEach((h, i) => {
    const w = 24
    ctx.fillStyle = '#7e93ae'
    ctx.fillRect(x, 256 - h, w, h)
    ctx.fillStyle = '#93a8c2'
    ctx.fillRect(x, 256 - h, w, 3)
    const r2 = mulberry(i * 31 + 5)
    for (let wy = 0; wy < Math.floor(h / 14); wy++) {
      for (let wx = 0; wx < 3; wx++) {
        if (r2() < 0.24) {
          ctx.fillStyle = rand() < 0.3 ? '#eef6ff' : '#5f7797'
          ctx.fillRect(x + 4 + wx * 7, 256 - h + 6 + wy * 14, 3, 4)
        }
      }
    }
    x += w
  })
  return finish(ctx)
}

/* ---------------------------------------------------------------------
   Labels & badges (pixel font on transparent or solid ground)
   --------------------------------------------------------------------- */
export function makeLabel(
  text: string,
  fg: string,
  bg: string | null = null,
  cell = 4,
  pad = 2,
): CanvasTexture {
  const w = pixelTextWidth(text) * cell + pad * 2
  const h = 5 * cell + pad * 2
  const ctx = makeCanvas(w, h)
  if (bg) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
  }
  drawPixelText(ctx, text, pad, pad, cell, fg)
  return finish(ctx)
}

/* ---------------------------------------------------------------------
   Surface textures
   --------------------------------------------------------------------- */
export function makeWood(base: string, seam: string, seed = 3): CanvasTexture {
  const ctx = makeCanvas(256, 256)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 256, 256)
  const rand = mulberry(seed)
  const plankH = 42
  for (let y = 0; y < 256; y += plankH) {
    const tint = (rand() - 0.5) * 22
    ctx.fillStyle = `rgba(${tint > 0 ? '255,235,200' : '0,0,0'},${
      Math.abs(tint) / 255
    })`
    ctx.fillRect(0, y, 256, plankH)
    ctx.fillStyle = seam
    ctx.fillRect(0, y, 256, 2)
    // grain flecks
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + rand() * 0.1})`
      ctx.fillRect(
        Math.floor(rand() * 256),
        y + 3 + Math.floor(rand() * (plankH - 6)),
        6 + Math.floor(rand() * 30),
        1,
      )
    }
    // occasional knot
    if (rand() < 0.7) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.beginPath()
      ctx.arc(rand() * 256, y + plankH / 2, 2 + rand() * 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const tex = finish(ctx)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  return tex
}

export function makeWallNoise(base: string, seed = 11): CanvasTexture {
  const ctx = makeCanvas(128, 128)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 128, 128)
  const rand = mulberry(seed)
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle =
      rand() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.05)'
    ctx.fillRect(Math.floor(rand() * 128), Math.floor(rand() * 128), 1, 1)
  }
  const tex = finish(ctx)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  return tex
}
