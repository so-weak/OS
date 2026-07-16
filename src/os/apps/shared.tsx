import { useId } from 'react'
import type { ReactNode } from 'react'
import type { Project } from '../../data/resume'
import { CATEGORY_TINT, hashString, mulberry32 } from './helpers'

/* =====================================================================
   Shared presentational components for the resume apps.
   - PixelPattern / ProjectArt: deterministic synthwave cover art
     generated per project id — pure vector, no raster asset to fetch
   - MenuGag: decorative Win9x menu bar whose items only crack jokes
   ===================================================================== */

interface PixelPatternProps {
  seed: string
  category: Project['category']
}

/**
 * Deterministic "synthwave boot screen" cover: a pixel sun over a perspective
 * grid, seeded from the project id and tinted per category. Pure vector, so it
 * stays crisp from the tiny grid thumbnail to the full detail hero — and needs
 * no raster asset (nothing to fetch, nothing to 404).
 */
export function PixelPattern({ seed, category }: PixelPatternProps) {
  const tint = CATEGORY_TINT[category]
  const rand = mulberry32(hashString(seed))
  const clipId = useId()
  const W = 64
  const H = 40
  const horizon = 22

  // Sun — size and horizontal position vary per project.
  const r = 7 + Math.floor(rand() * 5) // 7..11
  const cx = 16 + Math.floor(rand() * 32) // 16..47

  // Star field scattered across the sky.
  const stars: ReactNode[] = []
  for (let i = 0; i < 7; i++) {
    const sx = Math.floor(rand() * W)
    const sy = 2 + Math.floor(rand() * (horizon - r - 3))
    stars.push(<rect key={`s${i}`} x={sx} y={sy} width={1} height={1} fill={tint.hi} />)
  }

  // Classic synthwave stripe cut-outs across the lower half of the sun.
  const bands: ReactNode[] = []
  for (let i = 1; i <= 3; i++) {
    bands.push(
      <rect key={`b${i}`} x={cx - r} y={horizon - i * 2} width={r * 2} height={1} fill={tint.bg} />,
    )
  }

  // Perspective floor: verticals converging on the sun, receding horizontals.
  const verticals: ReactNode[] = []
  for (let i = 0; i <= 10; i++) {
    const xb = -W * 0.6 + (i / 10) * (W * 2.2)
    verticals.push(
      <line key={`v${i}`} x1={cx} y1={horizon} x2={xb} y2={H} stroke={tint.px} strokeWidth={0.4} opacity={0.7} />,
    )
  }
  const horizontals: ReactNode[] = []
  let gy = horizon + 1.4
  let hstep = 1.4
  let hi = 0
  while (gy < H) {
    horizontals.push(
      <rect key={`h${hi}`} x={0} y={gy} width={W} height={0.5} fill={tint.px} opacity={0.75} />,
    )
    gy += hstep
    hstep *= 1.55
    hi++
  }

  return (
    <svg
      className="pixel-pattern"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={W} height={horizon} />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill={tint.bg} />
      {stars}
      <g clipPath={`url(#${clipId})`}>
        <circle cx={cx} cy={horizon} r={r} fill={tint.px} />
        <circle cx={cx} cy={horizon} r={r} fill="none" stroke={tint.hi} strokeWidth={0.6} />
        {bands}
      </g>
      <rect x={0} y={horizon} width={W} height={0.8} fill={tint.hi} />
      {verticals}
      {horizontals}
    </svg>
  )
}

/**
 * Project artwork: the self-contained procedural cover. Wrapped in .proj-art
 * so the hero gets the CRT scanline overlay from CSS.
 */
export function ProjectArt({ project }: { project: Project }) {
  return (
    <div className="proj-art">
      <PixelPattern seed={project.id} category={project.category} />
    </div>
  )
}

/* ---------- decorative menu bar ---------- */

export interface MenuGagItem {
  label: string
  line: string
}

export function MenuGag({
  items,
  onGag,
}: {
  items: MenuGagItem[]
  onGag: (line: string) => void
}) {
  return (
    <div className="app-menubar">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          className="app-menu-item"
          onClick={() => onGag(it.line)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
