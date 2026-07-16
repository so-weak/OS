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

/** Renders text using the bitmap glyph set above. Unknown chars = space. */
export function PixelText({ text, px, fill }: PixelTextProps): ReactElement {
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

/** Original SoubhikOS logo mark — a lit CRT with one amber power LED. */
export function PixelMark({ px }: { px: number }): ReactElement {
  const rects: ReactElement[] = []
  MARK_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill: string | undefined = MARK_COLORS[row[x]]
      if (fill) {
        rects.push(
          <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />,
        )
      }
    }
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
      {rects}
    </svg>
  )
}
