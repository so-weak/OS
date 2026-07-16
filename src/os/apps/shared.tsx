import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Project } from '../../data/resume'
import { CATEGORY_TINT, hashString, mulberry32 } from './helpers'

/* =====================================================================
   Shared presentational components for the resume apps.
   - PixelPattern / ProjectArt: deterministic retro placeholder art
     seeded from the project id (the real /projects/*.jpg may not exist)
   - MenuGag: decorative Win9x menu bar whose items only crack jokes
   ===================================================================== */

interface PixelPatternProps {
  seed: string
  category: Project['category']
}

/**
 * Deterministic identicon-ish sprite: a horizontally mirrored 16x10 grid
 * seeded from the project id, tinted per category via tokens.
 */
export function PixelPattern({ seed, category }: PixelPatternProps) {
  const tint = CATEGORY_TINT[category]
  const rand = mulberry32(hashString(seed))
  const W = 16
  const H = 10
  const HALF = W / 2
  const rects: ReactNode[] = []
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < HALF; x++) {
      const r = rand()
      if (r < 0.42) {
        const fill = r < 0.07 ? tint.hi : tint.px
        rects.push(
          <rect key={`a${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />,
          <rect
            key={`b${x}-${y}`}
            x={W - 1 - x}
            y={y}
            width={1}
            height={1}
            fill={fill}
          />,
        )
      }
    }
  }
  return (
    <svg
      className="pixel-pattern"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      shapeRendering="crispEdges"
      aria-hidden
    >
      <rect x={0} y={0} width={W} height={H} fill={tint.bg} />
      {rects}
    </svg>
  )
}

/**
 * Project artwork: always renders the procedural placeholder; if the real
 * /projects/<id>.jpg ever exists it appears on top (onLoad), otherwise
 * the 404 is silently ignored.
 */
export function ProjectArt({ project }: { project: Project }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="proj-art">
      <PixelPattern seed={project.id} category={project.category} />
      <img
        src={project.art}
        alt=""
        draggable={false}
        onLoad={() => setLoaded(true)}
        style={{ display: loaded ? 'block' : 'none' }}
      />
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
