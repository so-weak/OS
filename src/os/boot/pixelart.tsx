import type { ReactElement } from 'react'

/* =====================================================================
   Original pixel art for boot & shutdown screens — hand-drawn bitmap
   glyphs rendered as crisp SVG rects. No fonts, no images, all ours.
   ===================================================================== */

/** 7-row bitmap glyphs (variable width). Only what the wordmark needs. */
const GLYPHS: Record<string, string[]> = {
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '#..##', '.##.#'],
  b: ['#....', '#....', '#.##.', '##..#', '#...#', '##..#', '#.##.'],
  h: ['#....', '#....', '#.##.', '##..#', '#...#', '#...#', '#...#'],
  i: ['.#.', '...', '##.', '.#.', '.#.', '.#.', '###'],
  k: ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'],
}

interface PixelTextProps {
  text: string
  /** CSS px per bitmap pixel */
  px: number
  fill: string
}

/* ---------------------------------------------------------------------
   Both marks below are pure functions of their props, and both are sat
   on top of a ticking render: the POST redraws on every memory-counter
   tick (34 ms) and the splash on every progress tick (50 ms). Rebuilding
   a couple of hundred <rect> elements at that rate cost 377 ms (mark) +
   142 ms (wordmark) of a 4x-throttled boot.

   So each caches its finished <svg> by props. Returning the IDENTICAL
   element lets React bail out of the whole subtree — it never touches
   the DOM, so the art cannot move by a pixel. The prop space is a
   handful of literals (px 4/5/6, two words), and the caches are capped
   anyway so no caller can grow them without bound.
   --------------------------------------------------------------------- */

const CACHE_CAP = 32

function remember<T>(cache: Map<string, T>, key: string, make: () => T): T {
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  if (cache.size >= CACHE_CAP) cache.clear()
  const made = make()
  cache.set(key, made)
  return made
}

const textCache = new Map<string, ReactElement>()

/** Renders text using the bitmap glyph set above. Unknown chars = space. */
export function PixelText({ text, px, fill }: PixelTextProps): ReactElement {
  return remember(textCache, `${px}|${fill}|${text}`, () => {
    const rects: ReactElement[] = []
    let x = 0
    for (const ch of text) {
      const rows: string[] | undefined = GLYPHS[ch]
      if (!rows) {
        x += 3
        continue
      }
      const w = rows.reduce((m, r) => Math.max(m, r.length), 0)
      rows.forEach((row, y) => {
        for (let i = 0; i < row.length; i++) {
          if (row[i] === '#') {
            rects.push(
              <rect key={`${x + i}-${y}`} x={x + i} y={y} width={1} height={1} />,
            )
          }
        }
      })
      x += w + 1
    }
    const cols = Math.max(1, x - 1)
    return (
      <svg
        width={cols * px}
        height={7 * px}
        viewBox={`0 0 ${cols} 7`}
        shapeRendering="crispEdges"
        fill={fill}
        aria-hidden="true"
      >
        {rects}
      </svg>
    )
  })
}

/* ---------- the SoubhikOS mark: a tiny glowing CRT on a stand ---------- */

const MARK_ROWS = [
  '..cccccccccccc..',
  '.cddddddddddddc.',
  '.cdggggggggggdc.',
  '.cdgsssggggggdc.',
  '.cdggggggggggdc.',
  '.cdssssssssssdc.',
  '.cdggggggggggdc.',
  '.cddddddddddddc.',
  '.cccccccccccacc.',
  '..cccccccccccc..',
  '......cccc......',
  '....cccccccc....',
  '...cccccccccc...',
]

const MARK_COLORS: Record<string, string> = {
  c: 'var(--face-light)',
  d: 'var(--face-darker)',
  g: 'var(--term-green)',
  s: 'color-mix(in srgb, var(--term-green) 45%, var(--term-bg))',
  a: 'var(--amber)',
}

/** the mark's rects are the same at every scale — built once, shared */
let markRects: ReactElement[] | null = null
const markCache = new Map<string, ReactElement>()

/** Original SoubhikOS logo mark — a lit CRT with one amber power LED.
    The fills are CSS vars, so caching the element freezes nothing: the
    browser still resolves `var(--term-green)` live at paint. */
export function PixelMark({ px }: { px: number }): ReactElement {
  return remember(markCache, String(px), () => {
    markRects ??= MARK_ROWS.flatMap((row, y) => {
      const out: ReactElement[] = []
      for (let x = 0; x < row.length; x++) {
        const fill: string | undefined = MARK_COLORS[row[x]]
        if (fill) {
          out.push(
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />,
          )
        }
      }
      return out
    })
    const w = MARK_ROWS[0].length
    const h = MARK_ROWS.length
    return (
      <svg
        width={w * px}
        height={h * px}
        viewBox={`0 0 ${w} ${h}`}
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {markRects}
      </svg>
    )
  })
}
