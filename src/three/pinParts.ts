import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  SRGBColorSpace,
  Vector2,
} from 'three'
import wallThumb from '../assets/pins/wall-s.jpg'
import wallFull from '../assets/pins/wall.jpg'
import liftThumb from '../assets/pins/lift-s.jpg'
import liftFull from '../assets/pins/lift.jpg'
import ioThumb from '../assets/pins/io-s.jpg'
import ioFull from '../assets/pins/io.jpg'
import corridorThumb from '../assets/pins/corridor-s.jpg'
import corridorFull from '../assets/pins/corridor.jpg'
import { PRINTS, type PrintId, type PrintSpec } from './pinState'
import { makeCanvas } from './textures'

/* =====================================================================
   Parts for the pinned photographs: the images and how they are loaded,
   the glossy print texture (photo + its white paper margin baked into one
   canvas), the lightly bowed sheet, the pushpin, and the contact shadows.

   Loading is deliberately gentle and never touches Suspense: the board
   starts with a neutral paper-toned print, the 384 px thumbnail replaces
   it as soon as it decodes, and the full-size file is only fetched the
   first time the close-up opens. A failed load leaves the last good
   picture (or the blank paper) and says nothing.
   ===================================================================== */

export const PHOTOS: Record<PrintId, { thumb: string; full: string }> = {
  wall: { thumb: wallThumb, full: wallFull },
  lift: { thumb: liftThumb, full: liftFull },
  io: { thumb: ioThumb, full: ioFull },
  corridor: { thumb: corridorThumb, full: corridorFull },
}

const images = new Map<string, Promise<HTMLImageElement | null>>()

/** Fetch + decode one image. Resolves null on any failure (no throw, no
    console noise from us); a failure is forgotten so a later call retries. */
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  const known = images.get(url)
  if (known) return known
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      // decode off the main thread so the first draw doesn't hitch
      img.decode().then(
        () => resolve(img),
        () => resolve(img),
      )
    }
    img.onerror = () => {
      images.delete(url)
      resolve(null)
    }
    img.src = url
  })
  images.set(url, p)
  return p
}

/** A print as one texture: white paper, a hair of edge shadow, then the
    photograph inside its margins. With no image it is the blank paper
    (a neutral grey-beige square where the picture will go). */
export function printTexture(img: HTMLImageElement | null, spec: PrintSpec): CanvasTexture {
  const pxW = img ? img.naturalWidth : 48
  const pxH = img ? img.naturalHeight : Math.round((48 * spec.ph) / spec.pw)
  const k = pxW / spec.pw // pixels per metre
  const ms = Math.max(1, Math.round(spec.mSide * k))
  const mt = Math.max(1, Math.round(spec.mTop * k))
  const mb = Math.max(1, Math.round(spec.mBot * k))
  const W = pxW + ms * 2
  const H = pxH + mt + mb
  const ctx = makeCanvas(W, H)

  const paper = ctx.createLinearGradient(0, 0, W, H)
  paper.addColorStop(0, '#f4f1e9')
  paper.addColorStop(1, '#e7e2d5')
  ctx.fillStyle = paper
  ctx.fillRect(0, 0, W, H)

  if (img) {
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, ms, mt, pxW, pxH)
    // the cut edge of the emulsion: a hair darker than the paper
    ctx.strokeStyle = 'rgba(58,48,36,0.28)'
    ctx.lineWidth = Math.max(1, W / 320)
    ctx.strokeRect(ms - 0.5, mt - 0.5, pxW + 1, pxH + 1)
  } else {
    ctx.fillStyle = '#cbc6b8'
    ctx.fillRect(ms, mt, pxW, pxH)
  }

  const tex = new CanvasTexture(ctx.canvas)
  tex.colorSpace = SRGBColorSpace
  // blank paper is a 48 px stand-in: keep its edges crisp when enlarged
  tex.magFilter = img ? LinearFilter : NearestFilter
  tex.minFilter = LinearMipmapLinearFilter
  tex.anisotropy = 8
  return tex
}

/** One print: a sheet with a slight bow, held at the top by its pin, so
    the lower corners lift a hair off the cork and catch the light. */
export function printGeo(spec: PrintSpec): BufferGeometry {
  const g = new PlaneGeometry(spec.w, spec.h, 4, 5)
  const p = g.attributes.position
  for (let v = 0; v < p.count; v++) {
    const nx = p.getX(v) / (spec.w / 2)
    const ny = p.getY(v) / (spec.h / 2)
    p.setZ(v, 0.0009 * (nx * nx * 0.55 + ny * ny * 0.35 - ny * 0.35))
  }
  g.computeVertexNormals()
  return g
}

/** The lit (on the board) and unlit (held up to the lens) materials of every
    print, and the textures that feed them. One object so the swap from
    blank paper to thumbnail to full size happens in exactly one place. */
export class PrintSet {
  readonly board: MeshStandardMaterial[]
  readonly held: MeshBasicMaterial[]
  private readonly tex: CanvasTexture[]
  /** 0 blank paper, 1 thumbnail, 2 full size */
  private readonly tier: number[]

  constructor() {
    this.tex = PRINTS.map((p) => printTexture(null, p))
    this.tier = PRINTS.map(() => 0)
    this.board = this.tex.map(
      (map) =>
        new MeshStandardMaterial({
          map,
          roughness: 0.42,
          metalness: 0,
          // a whisper of self-light so a face still reads at night from the
          // room camera (the index card on the desk does the same)
          emissive: new Color('#ffffff'),
          emissiveMap: map,
          emissiveIntensity: 0.14,
        }),
    )
    this.held = this.tex.map(
      (map) =>
        new MeshBasicMaterial({
          map,
          toneMapped: false,
          depthTest: false,
          depthWrite: false,
          transparent: true,
        }),
    )
  }

  /** Give print `i` a picture (tier 1 thumbnail, 2 full). A worse tier never
      replaces a better one; a null image (failed load) changes nothing. */
  apply(i: number, img: HTMLImageElement | null, tier: 1 | 2): void {
    if (!img || tier <= this.tier[i]) return
    const next = printTexture(img, PRINTS[i])
    const prev = this.tex[i]
    this.tex[i] = next
    this.tier[i] = tier
    const b = this.board[i]
    b.map = next
    b.emissiveMap = next
    b.needsUpdate = true
    const h = this.held[i]
    h.map = next
    h.needsUpdate = true
    prev.dispose()
  }

  dispose(): void {
    this.tex.forEach((t) => t.dispose())
    this.board.forEach((m) => m.dispose())
    this.held.forEach((m) => m.dispose())
  }
}

/** A pushpin standing on +z: a flat flange, a short neck, a glossy dome.
    Head about 10 mm across and 6.5 mm tall; origin at the paper. */
export function pinHeadGeo(): BufferGeometry {
  const profile: [number, number][] = [
    [0.0001, 0],
    [0.0046, 0],
    [0.005, 0.0004],
    [0.0047, 0.0009],
    [0.003, 0.0012],
    [0.0022, 0.0016],
    [0.0022, 0.0028],
    [0.0038, 0.0032],
    [0.0048, 0.0042],
    [0.0046, 0.0052],
    [0.0034, 0.006],
    [0.0016, 0.0064],
    [0.0001, 0.0065],
  ]
  const g = new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    14,
  )
  g.rotateX(Math.PI / 2) // the lathe stands on +y; the wall's normal is +z
  return g
}

export interface ShadowRect {
  x: number
  y: number
  w: number
  h: number
  rot: number
}

/** Every soft contact shadow on the cork as ONE geometry (a feathered quad
    per card and per print, six vertices each). It carries RGBA vertex
    colours so a print's shadow can fade out the moment the print leaves
    the board. Cork-surface space; sits 1.6 mm above the cork. */
export function buildShadowGeo(rects: readonly ShadowRect[]): BufferGeometry {
  const corners: [number, number, number, number][] = [
    [-1, -1, 0, 0],
    [1, -1, 1, 0],
    [1, 1, 1, 1],
    [-1, -1, 0, 0],
    [1, 1, 1, 1],
    [-1, 1, 0, 1],
  ]
  const n = rects.length * 6
  const pos = new Float32Array(n * 3)
  const uv = new Float32Array(n * 2)
  const col = new Float32Array(n * 4)
  rects.forEach((r, i) => {
    const cs = Math.cos(r.rot)
    const sn = Math.sin(r.rot)
    const hw = (r.w + 0.02) / 2
    const hh = (r.h + 0.02) / 2
    corners.forEach(([sx, sy, u, v], k) => {
      const o = i * 6 + k
      const lx = sx * hw
      const ly = sy * hh
      pos[o * 3] = r.x + 0.003 + lx * cs - ly * sn
      pos[o * 3 + 1] = r.y - 0.004 + lx * sn + ly * cs
      pos[o * 3 + 2] = 0.0016
      uv[o * 2] = u
      uv[o * 2 + 1] = v
      col[o * 4] = 0.02
      col[o * 4 + 1] = 0.015
      col[o * 4 + 2] = 0.01
      col[o * 4 + 3] = 1
    })
  })
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new Float32BufferAttribute(col, 4))
  return g
}
