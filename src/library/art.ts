import {
  authorLine,
  fullByline,
  genreStyle,
  readDate,
  seeded,
  surname,
  type Book,
} from '../data/library'

/* =====================================================================
   Procedural bookbinding — the one set of drawings for the whole site.

   Every spine, cloth board and bookplate is drawn on a canvas from the
   book's own metadata: no image assets, so a book added by the ISBN
   scanner is fully bound the moment its entry lands in books.ts.

   These return plain canvases so both consumers can use them:
   - the catalogue page (src/library) puts them straight in the DOM
   - the 3D shelf (src/three/libraryTextures.ts) wraps them in
     CanvasTextures

   Deliberately free of any three.js import, so the catalogue page can
   be code-split away from the 3D bundle.

   Type is VT323 (--font-term) throughout: the site's own face, and a
   condensed one, which is what a spine needs. Callers must wait for
   document.fonts.ready (see useFontsReady) or the canvas rasterises
   with a fallback face and never repaints.
   ===================================================================== */

const TERM = '"VT323", monospace'

/** Canvas pixels per world metre — sets the resolution of every texture. */
const PPM = 3400

function makeCanvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return ctx
}

/** Deterministic PRNG so a redraw produces identical art. */
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

/** Author credit used by shelf tooltips and card subtitles. */
export function spineTooltip(b: Book): string {
  return `${b.title} — ${authorLine(b)}`
}

/* ---------- physical size of a volume ---------- */

export interface BookDims {
  /** spine thickness (world m) */
  thick: number
  /** height of the boards (world m) */
  tall: number
  /** front-to-fore-edge depth (world m) */
  deep: number
}

const BASE: BookDims = { thick: 0.032, tall: 0.212, deep: 0.142 }

/** Deterministic per-book dimensions; `spine` overrides win. */
export function bookDims(b: Book): BookDims {
  const tall = b.spine?.tall ?? 0.9 + seeded(b.id, 'tall') * 0.22
  const thick = b.spine?.thick ?? 0.78 + seeded(b.id, 'thick') * 0.55
  return {
    thick: BASE.thick * thick,
    tall: BASE.tall * tall,
    deep: BASE.deep * (0.94 + seeded(b.id, 'deep') * 0.14),
  }
}

export interface BookInk {
  cloth: string
  foil: string
}

export function bookInk(b: Book): BookInk {
  const g = genreStyle(b.genre)
  return { cloth: b.spine?.cloth ?? g.cloth, foil: b.spine?.foil ?? g.foil }
}

/* ---------- drawing helpers ---------- */

/** Largest font size in `family` at which `text` fits `maxW`. */
function fitSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  max: number,
  min: number,
): number {
  for (let size = max; size > min; size -= 2) {
    ctx.font = `${size}px ${TERM}`
    if (ctx.measureText(text).width <= maxW) return size
  }
  return min
}

/** Break `text` into lines that fit `maxW` at the current font. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines: number,
): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxW && line) {
      out.push(line)
      line = word
      if (out.length === maxLines) return out
    } else {
      line = test
    }
  }
  if (line && out.length < maxLines) out.push(line)
  return out
}

/** Trim with an ellipsis until it fits. */
function clip(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string {
  if (ctx.measureText(text).width <= maxW) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxW) {
    cut = cut.slice(0, -1)
  }
  return `${cut.trimEnd()}…`
}

/** Five-pointed star, filled. */
function star(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  half = false,
): void {
  ctx.save()
  if (half) {
    ctx.beginPath()
    ctx.rect(cx - r, cy - r, r, r * 2)
    ctx.clip()
  }
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const x = cx + Math.cos(a) * rad
    const y = cy + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** A row of five stars, `rating` of them lit. */
function starRow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rating: number | undefined,
  lit: string,
  dim: string,
): void {
  const gap = r * 2.5
  const start = cx - gap * 2
  for (let i = 0; i < 5; i++) {
    const x = start + i * gap
    star(ctx, x, cy, r, dim)
    const value = (rating ?? 0) - i
    if (value >= 1) star(ctx, x, cy, r, lit)
    else if (value >= 0.5) star(ctx, x, cy, r, lit, true)
  }
}

/** Woven cloth speckle over the whole canvas. */
function cloth(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
): void {
  const rand = mulberry(seed)
  const n = Math.round((w * h) / 260)
  for (let i = 0; i < n; i++) {
    ctx.fillStyle =
      rand() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.075)'
    ctx.fillRect(Math.floor(rand() * w), Math.floor(rand() * h), 2, 1)
  }
}

/** Darken the two long edges so a flat box reads as a rounded spine. */
function spineShading(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const g = ctx.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0, 'rgba(0,0,0,0.45)')
  g.addColorStop(0.18, 'rgba(0,0,0,0.06)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.07)')
  g.addColorStop(0.82, 'rgba(0,0,0,0.06)')
  g.addColorStop(1, 'rgba(0,0,0,0.45)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

/* ---------------------------------------------------------------------
   Spine — the face you read on the shelf.
   --------------------------------------------------------------------- */
export function spineCanvas(b: Book, scale = 1): HTMLCanvasElement {
  const d = bookDims(b)
  const ink = bookInk(b)
  const W = Math.max(64, Math.round(d.thick * PPM))
  const H = Math.round(d.tall * PPM)
  const ctx = makeCanvas(Math.round(W * scale), Math.round(H * scale))
  ctx.scale(scale, scale)

  ctx.fillStyle = ink.cloth
  ctx.fillRect(0, 0, W, H)
  cloth(ctx, W, H, Math.round(seeded(b.id, 'cloth') * 65535) + 7)

  // head and tail rules
  ctx.fillStyle = ink.foil
  ctx.globalAlpha = 0.85
  ctx.fillRect(W * 0.16, H * 0.055, W * 0.68, 3)
  ctx.fillRect(W * 0.16, H * 0.065, W * 0.68, 1)
  ctx.fillRect(W * 0.16, H * 0.93, W * 0.68, 3)
  ctx.globalAlpha = 1

  // raised bands on the older bindings
  if (b.spine?.bands) {
    for (const t of [0.16, 0.72, 0.83]) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      ctx.fillRect(0, H * t, W, H * 0.018)
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.fillRect(0, H * t + H * 0.018, W, 3)
    }
  }

  // title, stamped down the spine — the runway stops short of the tail
  // so a long title never runs into the author's name
  const bandTop = H * 0.17
  const bandBottom = H * 0.73
  const runway = bandBottom - bandTop
  ctx.save()
  ctx.translate(W / 2, bandTop)
  ctx.rotate(Math.PI / 2)
  ctx.textBaseline = 'middle'
  ctx.fillStyle = ink.foil

  const titleMax = Math.round(W * 0.62)
  const size = fitSize(ctx, b.title, runway, titleMax, 18)
  ctx.font = `${size}px ${TERM}`
  if (ctx.measureText(b.title).width <= runway) {
    ctx.fillText(b.title, 0, 0)
  } else {
    // very long titles get two stacked lines down the spine
    const lines = wrap(ctx, b.title, runway, 2)
    const lead = size * 0.78
    lines.forEach((line, i) => {
      ctx.fillText(clip(ctx, line, runway), 0, (i - (lines.length - 1) / 2) * lead)
    })
  }
  ctx.restore()

  // author at the tail, reading down from the foot of the title
  ctx.save()
  ctx.translate(W / 2, H * 0.76)
  ctx.rotate(Math.PI / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = ink.foil
  ctx.globalAlpha = 0.9
  const aSize = Math.round(W * 0.42)
  ctx.font = `${aSize}px ${TERM}`
  ctx.fillText(clip(ctx, surname(b.authors[0] ?? ''), H * 0.185), 0, 0)
  ctx.restore()

  spineShading(ctx, W, H)
  return ctx.canvas
}

/* ---------------------------------------------------------------------
   Front board.
   --------------------------------------------------------------------- */
export function coverCanvas(b: Book, scale = 1): HTMLCanvasElement {
  const ink = bookInk(b)
  const W = 512
  const H = Math.round((W * BASE.tall) / BASE.deep)
  // draw at 512-wide coordinates whatever the output size
  const ctx = makeCanvas(Math.round(W * scale), Math.round(H * scale))
  ctx.scale(scale, scale)

  ctx.fillStyle = ink.cloth
  ctx.fillRect(0, 0, W, H)
  cloth(ctx, W, H, Math.round(seeded(b.id, 'board') * 65535) + 11)

  // foil frame
  ctx.strokeStyle = ink.foil
  ctx.globalAlpha = 0.8
  ctx.lineWidth = 3
  ctx.strokeRect(26, 26, W - 52, H - 52)
  ctx.lineWidth = 1
  ctx.strokeRect(34, 34, W - 68, H - 68)
  ctx.globalAlpha = 1

  ctx.textAlign = 'center'
  ctx.fillStyle = ink.foil

  // genre, letter-spaced across the head
  ctx.font = `26px ${TERM}`
  ctx.globalAlpha = 0.75
  ctx.fillText(b.genre.toUpperCase().split('').join(' '), W / 2, 88)
  ctx.globalAlpha = 1

  // title — drops a size when it needs more than three lines
  ctx.font = `58px ${TERM}`
  const tSize = wrap(ctx, b.title, W - 110, 5).length > 3 ? 46 : 58
  ctx.font = `${tSize}px ${TERM}`
  const lines = wrap(ctx, b.title, W - 110, 5)
  let y = 190
  for (const line of lines) {
    ctx.fillText(line, W / 2, y)
    y += tSize * 0.92
  }

  if (b.subtitle) {
    ctx.globalAlpha = 0.8
    ctx.font = `28px ${TERM}`
    for (const line of wrap(ctx, b.subtitle, W - 140, 2)) {
      y += 34
      ctx.fillText(line, W / 2, y)
    }
    ctx.globalAlpha = 1
  }

  // rule + byline
  ctx.fillRect(W / 2 - 70, y + 40, 140, 2)
  ctx.font = `32px ${TERM}`
  let by = y + 92
  for (const line of wrap(ctx, fullByline(b), W - 120, 3)) {
    ctx.fillText(line, W / 2, by)
    by += 36
  }

  // stars, embossed low on the board
  starRow(ctx, W / 2, H - 150, 16, b.rating, ink.foil, 'rgba(0,0,0,0.28)')

  // publisher device
  ctx.globalAlpha = 0.7
  ctx.strokeStyle = ink.foil
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(W / 2, H - 96)
  ctx.lineTo(W / 2 + 18, H - 78)
  ctx.lineTo(W / 2, H - 60)
  ctx.lineTo(W / 2 - 18, H - 78)
  ctx.closePath()
  ctx.stroke()
  ctx.font = `24px ${TERM}`
  ctx.fillText(b.year ? String(b.year) : 'THE STACKS', W / 2, H - 34)
  ctx.globalAlpha = 1

  // corner wear
  const rand = mulberry(Math.round(seeded(b.id, 'wear') * 65535) + 3)
  for (const [cx, cy] of [
    [8, 8],
    [W - 8, 8],
    [8, H - 8],
    [W - 8, H - 8],
  ]) {
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 40 + rand() * 30)
    g.addColorStop(0, 'rgba(0,0,0,0.32)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }
  return ctx.canvas
}

/* ---------------------------------------------------------------------
   Back board — the bookplate: my note, my stars, my dates.
   --------------------------------------------------------------------- */
export function bookplateCanvas(b: Book, scale = 1): HTMLCanvasElement {
  const ink = bookInk(b)
  const W = 512
  const H = Math.round((W * BASE.tall) / BASE.deep)
  const ctx = makeCanvas(Math.round(W * scale), Math.round(H * scale))
  ctx.scale(scale, scale)

  ctx.fillStyle = ink.cloth
  ctx.fillRect(0, 0, W, H)
  cloth(ctx, W, H, Math.round(seeded(b.id, 'back') * 65535) + 23)

  // the pasted bookplate
  const px = 32
  const py = 40
  const pw = W - px * 2
  const ph = H - py * 2 - 20
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fillRect(px + 5, py + 6, pw, ph)
  ctx.fillStyle = '#f2ecdb'
  ctx.fillRect(px, py, pw, ph)
  // foxing
  const rand = mulberry(Math.round(seeded(b.id, 'fox') * 65535) + 5)
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(150,120,70,${0.03 + rand() * 0.06})`
    const r = 2 + rand() * 7
    ctx.beginPath()
    ctx.arc(px + rand() * pw, py + rand() * ph, r, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.textAlign = 'center'
  ctx.fillStyle = '#4a3b22'
  ctx.font = `24px ${TERM}`
  ctx.fillText('F R O M   T H E   L I B R A R Y   O F', W / 2, py + 44)
  ctx.fillStyle = '#1a1812'
  ctx.font = `34px ${TERM}`
  ctx.fillText('SOUBHIK GHOSH', W / 2, py + 80)
  ctx.fillStyle = 'rgba(232,72,63,0.45)'
  ctx.fillRect(px + 40, py + 98, pw - 80, 2)

  // the note, from the top
  ctx.textAlign = 'left'
  ctx.fillStyle = '#23201a'
  ctx.font = `30px ${TERM}`
  const noteX = px + 34
  const noteW = pw - 68
  let ny = py + 152
  const note = b.note?.trim()
    ? b.note
    : 'No note yet — this one is still waiting for a verdict.'
  for (const line of wrap(ctx, note, noteW, 7)) {
    ctx.fillText(line, noteX, ny)
    ny += 36
  }

  /* everything else hangs off the bottom of the plate, so a one-line
     note and a seven-line note both sit on a balanced card */
  const plateBottom = py + ph
  const barY = plateBottom - 130
  const tagY = barY - 34
  const metaY = barY - 72
  const starY = barY - 122

  starRow(ctx, W / 2, starY, 15, b.rating, '#b5720a', 'rgba(26,24,18,0.18)')

  ctx.textAlign = 'center'
  ctx.fillStyle = '#4a3b22'
  ctx.font = `26px ${TERM}`
  const meta: string[] = []
  if (b.status === 'read' && b.finished) {
    meta.push(`READ ${readDate(b.finished).toUpperCase()}`)
  } else if (b.status === 'reading') {
    meta.push('READING NOW')
  } else if (b.status === 'shelved') {
    meta.push('NOT READ YET')
  }
  if (b.pages) meta.push(`${b.pages} PP.`)
  if (b.year) meta.push(String(b.year))
  ctx.fillText(meta.join('   ·   '), W / 2, metaY)

  if (b.tags?.length) {
    ctx.font = `24px ${TERM}`
    ctx.fillStyle = '#6b5a3a'
    ctx.fillText(clip(ctx, b.tags.map((t) => `#${t}`).join('  '), noteW), W / 2, tagY)
  }

  // barcode strip
  const bw = 220
  const bh = 74
  const bx = (W - bw) / 2
  ctx.fillStyle = '#fdfcf7'
  ctx.fillRect(bx - 10, barY - 8, bw + 20, bh + 42)
  ctx.textAlign = 'center'
  if (b.isbn && /^\d{13}$/.test(b.isbn)) {
    drawEan13(ctx, bx, barY, bw, bh, b.isbn)
    ctx.fillStyle = '#1a1812'
    ctx.font = `22px ${TERM}`
    ctx.fillText(`ISBN ${b.isbn}`, W / 2, barY + bh + 28)
  } else {
    drawShelfMark(ctx, bx, barY, bw, bh, b.id)
    ctx.fillStyle = '#1a1812'
    ctx.font = `22px ${TERM}`
    ctx.fillText(`SHELF MARK ${shelfMark(b)}`, W / 2, barY + bh + 28)
  }

  // recommendation ribbon
  if (b.pick) {
    ctx.save()
    ctx.translate(W - 112, barY + 26)
    ctx.rotate(-0.22)
    ctx.fillStyle = 'rgba(181,114,10,0.9)'
    ctx.fillRect(-72, -20, 144, 40)
    ctx.fillStyle = '#fdfcf7'
    ctx.font = `26px ${TERM}`
    ctx.fillText("SOUBHIK'S PICK", 0, 8)
    ctx.restore()
  }

  return ctx.canvas
}

/* ---------- barcodes ---------- */

const EAN_L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
]
const EAN_G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
]
const EAN_R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
]
const EAN_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
]

/** A real EAN-13 (so a scanned ISBN scans back off the 3D book). */
function drawEan13(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  digits: string,
): void {
  const parity = EAN_PARITY[Number(digits[0])]
  let bits = '101'
  for (let i = 1; i <= 6; i++) {
    const d = Number(digits[i])
    bits += parity[i - 1] === 'L' ? EAN_L[d] : EAN_G[d]
  }
  bits += '01010'
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(digits[i])]
  bits += '101'

  const unit = w / bits.length
  ctx.fillStyle = '#1a1812'
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue
    // guard bars run a little long, as they do in print
    const guard = i < 3 || i >= bits.length - 3 || (i >= 45 && i < 50)
    ctx.fillRect(x + i * unit, y, Math.max(1, unit), h + (guard ? 8 : 0))
  }
}

/** Shelf mark for volumes with no ISBN — decorative, and labelled so. */
function drawShelfMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: string,
): void {
  const rand = mulberry(Math.round(seeded(seed, 'bars') * 65535) + 13)
  ctx.fillStyle = '#1a1812'
  let cx = x
  while (cx < x + w - 2) {
    const bar = 1 + Math.floor(rand() * 4)
    ctx.fillRect(cx, y, bar, h)
    cx += bar + 1 + Math.floor(rand() * 4)
  }
}

/** Just the barcode strip, for the catalogue page's bookplate. */
export function barcodeCanvas(b: Book, scale = 1): HTMLCanvasElement {
  const W = 240
  const H = 116
  const ctx = makeCanvas(Math.round(W * scale), Math.round(H * scale))
  ctx.scale(scale, scale)
  ctx.fillStyle = '#fdfcf7'
  ctx.fillRect(0, 0, W, H)
  const bw = 220
  const bh = 74
  const bx = (W - bw) / 2
  ctx.textAlign = 'center'
  if (b.isbn && /^\d{13}$/.test(b.isbn)) {
    drawEan13(ctx, bx, 10, bw, bh, b.isbn)
    ctx.fillStyle = '#1a1812'
    ctx.font = `22px ${TERM}`
    ctx.fillText(`ISBN ${b.isbn}`, W / 2, 110)
  } else {
    drawShelfMark(ctx, bx, 10, bw, bh, b.id)
    ctx.fillStyle = '#1a1812'
    ctx.font = `22px ${TERM}`
    ctx.fillText(`SHELF MARK ${shelfMark(b)}`, W / 2, 110)
  }
  return ctx.canvas
}

/** 'AI-KLE-017' — a plausible spine label built from real fields. */
export function shelfMark(b: Book): string {
  const g = b.genre.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'XX'
  const a = surname(b.authors[0] ?? 'anon').slice(0, 3).toUpperCase()
  const n = String(Math.floor(seeded(b.id, 'mark') * 900) + 100)
  return `${g}-${a}-${n}`
}

