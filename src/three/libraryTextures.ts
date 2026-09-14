import type { CanvasTexture } from 'three'
import type { Book } from '../data/library'
import {
  bookplateCanvas,
  coverCanvas,
  spineCanvas,
} from '../library/art'
import { finish, makeCanvas } from './textures'

/* =====================================================================
   The 3D shelf's half of the bookbinding: the drawings live in
   src/library/art.ts (shared with the catalogue page); this file only
   wraps them in CanvasTextures and adds the few pieces that exist
   nowhere but on the case itself — the brass placard and the small
   engraved strips.
   ===================================================================== */

const TERM = '"VT323", monospace'

export { bookDims, bookInk, spineTooltip } from '../library/art'
export type { BookDims, BookInk } from '../library/art'

/** The stamped spine, as it reads on the shelf. */
export function makeSpine(b: Book): CanvasTexture {
  return wrap(spineCanvas(b))
}

/** The front board of a volume held up to the camera. */
export function makeFrontCover(b: Book): CanvasTexture {
  return wrap(coverCanvas(b))
}

/** The pasted bookplate on the back board: the note, the stars, the date. */
export function makeBackCover(b: Book): CanvasTexture {
  return wrap(bookplateCanvas(b))
}

function wrap(canvas: HTMLCanvasElement): CanvasTexture {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return finish(ctx, false)
}

/* ---------------------------------------------------------------------
   Small parts that only the case wears.
   --------------------------------------------------------------------- */

export interface Strip {
  tex: CanvasTexture
  /** aspect ratio (w/h) so the mesh can size itself */
  aspect: number
}

export function makeStrip(
  text: string,
  opts: { fg: string; bg: string; size?: number; pad?: number } = {
    fg: '#1a1812',
    bg: '#c9a227',
  },
): Strip {
  const size = opts.size ?? 40
  const pad = opts.pad ?? 16
  const probe = makeCanvas(8, 8)
  probe.font = `${size}px ${TERM}`
  const w = Math.ceil(probe.measureText(text).width) + pad * 2
  const h = Math.ceil(size * 1.5)
  const ctx = makeCanvas(Math.max(16, w), h)
  ctx.fillStyle = opts.bg
  ctx.fillRect(0, 0, ctx.canvas.width, h)
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(0, 0, ctx.canvas.width, 2)
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(0, h - 2, ctx.canvas.width, 2)
  ctx.fillStyle = opts.fg
  ctx.font = `${size}px ${TERM}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, ctx.canvas.width / 2, h / 2 + 2)
  return { tex: finish(ctx, false), aspect: ctx.canvas.width / h }
}

/** Engraved brass plate screwed to the crown of the case. */
export function makePlacard(line: string, sub: string): CanvasTexture {
  const W = 640
  const H = 160
  const ctx = makeCanvas(W, H)
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#e0c16a')
  g.addColorStop(0.45, '#c9a227')
  g.addColorStop(0.55, '#b2881c')
  g.addColorStop(1, '#8a6a12')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = 'rgba(60,40,0,0.5)'
  ctx.lineWidth = 3
  ctx.strokeRect(12, 12, W - 24, H - 24)
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(50,34,0,0.92)'
  ctx.font = `62px ${TERM}`
  ctx.fillText(line, W / 2, 82)
  ctx.font = `30px ${TERM}`
  ctx.fillText(sub, W / 2, 124)
  for (const x of [34, W - 34]) {
    ctx.fillStyle = 'rgba(60,45,10,0.55)'
    ctx.beginPath()
    ctx.arc(x, H / 2, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,240,190,0.6)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x - 6, H / 2)
    ctx.lineTo(x + 6, H / 2)
    ctx.stroke()
  }
  return finish(ctx, false)
}
