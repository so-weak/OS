import type { CanvasTexture } from 'three'
import type { Book } from '../data/library'
import {
  bookplateCanvas,
  coverCanvas,
  spineCanvas,
} from '../library/art'
import { finishText, makeCanvas } from './textures'

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

export interface SpineAtlas {
  /** one shared texture, all shelved spines baked into a grid */
  tex: CanvasTexture
  /** book id -> this book's cell, as a 0..1 UV rect */
  uv: Map<string, { u0: number; v0: number; u1: number; v1: number }>
  dispose(): void
}

/** Gutter around each spine in the atlas, filled with the spine's own
    edge colours (see makeSpineAtlas) so the mip chain never bleeds a
    neighbour — or bare black — into a book's edge. 8 texels holds clean
    through mip level 3, i.e. to 1/8 scale, well past the shelf view. */
const ATLAS_PAD = 8

/**
 * Every stamped spine in one texture instead of one canvas (and one GPU
 * upload) per book: each volume still gets its own drawing (the title
 * differs), but they land as tiles in a shared sheet, so 113 shelved
 * books can share ONE material instead of ~110 distinct ones. Cheap
 * enough to rebuild on open/close — same lifetime as the old per-book
 * textures it replaces.
 */
export function makeSpineAtlas(list: Book[]): SpineAtlas {
  if (list.length === 0) {
    const ctx = makeCanvas(2, 2)
    return { tex: finishText(ctx), uv: new Map(), dispose: () => {} }
  }
  const cells = list.map((b) => ({ book: b, canvas: spineCanvas(b) }))
  const maxW = Math.max(...cells.map((c) => c.canvas.width))
  const maxH = Math.max(...cells.map((c) => c.canvas.height))
  const cellW = maxW + ATLAS_PAD * 2
  const cellH = maxH + ATLAS_PAD * 2
  // pack close to a square in actual pixels, not cell counts, so a
  // sheet of mostly-tall narrow spines doesn't end up a skyscraper
  const cols = Math.max(1, Math.round(Math.sqrt((cells.length * cellH) / cellW)))
  const rows = Math.ceil(cells.length / cols)
  const atlasW = cols * cellW
  const atlasH = rows * cellH
  const ctx = makeCanvas(atlasW, atlasH)
  const uv = new Map<string, { u0: number; v0: number; u1: number; v1: number }>()
  cells.forEach(({ book, canvas }, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = Math.round(col * cellW + ATLAS_PAD + (maxW - canvas.width) / 2)
    const y = Math.round(row * cellH + ATLAS_PAD + (maxH - canvas.height) / 2)
    // gutter: the spine stretched a pad wider on every side, then the
    // spine itself on top — its edge colours extend into the pad
    ctx.drawImage(
      canvas,
      x - ATLAS_PAD,
      y - ATLAS_PAD,
      canvas.width + ATLAS_PAD * 2,
      canvas.height + ATLAS_PAD * 2,
    )
    ctx.drawImage(canvas, x, y)
    uv.set(book.id, {
      u0: x / atlasW,
      v0: 1 - (y + canvas.height) / atlasH,
      u1: (x + canvas.width) / atlasW,
      v1: 1 - y / atlasH,
    })
  })
  // The atlas is drawn at 3400 texels per metre and the library view
  // shows it at ~600-1200 screen px per metre, so the titles are always
  // MINIFIED ~3-5x. Without mips (as before) that sampled every 3rd-5th
  // texel: letter strokes dropped out and shimmered. Trilinear mips plus
  // full anisotropy (the case is angled to the camera) read clean; the
  // padded gutters above keep the mips from bleeding across cells.
  const tex = finishText(ctx)
  return { tex, uv, dispose: () => tex.dispose() }
}

/** Covers are drawn at 2x: the held volume fills a good part of the
    screen, and at 1x its 512-texel board was stretched on a 2x display.
    One book at a time, built on selection, so load never pays for it. */
const COVER_SCALE = 2

/** The front board of a volume held up to the camera. */
export function makeFrontCover(b: Book): CanvasTexture {
  return wrap(coverCanvas(b, COVER_SCALE))
}

/** The pasted bookplate on the back board: the note, the stars, the date. */
export function makeBackCover(b: Book): CanvasTexture {
  return wrap(bookplateCanvas(b, COVER_SCALE))
}

function wrap(canvas: HTMLCanvasElement): CanvasTexture {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return finishText(ctx)
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
  return { tex: finishText(ctx), aspect: ctx.canvas.width / h }
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
  return finishText(ctx)
}
