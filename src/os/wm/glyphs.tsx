/* =====================================================================
   Tiny pixel glyphs owned by the shell (titlebar controls, tray speaker,
   power symbol, dialog badges). App icons live in src/os/icons — these
   are chrome furniture only. All drawn as 1px rect grids, crispEdges,
   in currentColor so they inherit bevel-button ink.
   ===================================================================== */

type Px = [x: number, y: number, w?: number, h?: number]

function Pixels({
  px,
  vw,
  vh,
  w,
  h,
  fill = 'currentColor',
}: {
  px: Px[]
  vw: number
  vh: number
  w: number
  h: number
  fill?: string
}) {
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${vw} ${vh}`}
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
      style={{ display: 'block' }}
    >
      {px.map(([x, y, pw = 1, ph = 1], i) => (
        <rect key={i} x={x} y={y} width={pw} height={ph} fill={fill} />
      ))}
    </svg>
  )
}

/* ---------- titlebar controls (classic 8x7 / 9x8 grids) ---------- */

export function GlyphMinimize() {
  return <Pixels vw={8} vh={7} w={10} h={9} px={[[1, 5, 6, 2]]} />
}

export function GlyphMaximize() {
  return (
    <Pixels
      vw={9}
      vh={8}
      w={10}
      h={9}
      px={[
        [0, 0, 9, 2],
        [0, 2, 1, 5],
        [8, 2, 1, 5],
        [0, 7, 9, 1],
      ]}
    />
  )
}

export function GlyphRestore() {
  return (
    <Pixels
      vw={9}
      vh={8}
      w={10}
      h={9}
      px={[
        [3, 0, 6, 2],
        [8, 2, 1, 3],
        [7, 5, 2, 1],
        [0, 3, 6, 2],
        [0, 5, 1, 3],
        [5, 5, 1, 3],
        [0, 7, 6, 1],
      ]}
    />
  )
}

export function GlyphClose() {
  return (
    <Pixels
      vw={8}
      vh={7}
      w={10}
      h={9}
      px={[
        [0, 0, 2, 1],
        [6, 0, 2, 1],
        [1, 1, 2, 1],
        [5, 1, 2, 1],
        [2, 2, 4, 1],
        [3, 3, 2, 1],
        [2, 4, 4, 1],
        [1, 5, 2, 1],
        [5, 5, 2, 1],
        [0, 6, 2, 1],
        [6, 6, 2, 1],
      ]}
    />
  )
}

/* ---------- system tray speaker ---------- */

const SPEAKER_BODY: Px[] = [
  [0, 3, 3, 4],
  [3, 2, 1, 6],
  [4, 1, 1, 8],
  [5, 0, 1, 10],
]

export function GlyphSpeaker() {
  return (
    <Pixels
      vw={12}
      vh={10}
      w={14}
      h={12}
      px={[
        ...SPEAKER_BODY,
        // small wave
        [7, 3, 1, 1],
        [8, 4, 1, 2],
        [7, 6, 1, 1],
        // big wave
        [9, 1, 1, 1],
        [10, 2, 1, 2],
        [10, 6, 1, 2],
        [9, 8, 1, 1],
        [10, 4, 1, 2],
      ]}
    />
  )
}

export function GlyphSpeakerMuted() {
  return (
    <span style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
      <Pixels vw={12} vh={10} w={14} h={12} px={SPEAKER_BODY} />
      <span style={{ position: 'absolute', left: 0, top: 0 }}>
        <Pixels
          vw={12}
          vh={10}
          w={14}
          h={12}
          fill="var(--led-red)"
          px={[
            [7, 2, 1, 1],
            [11, 2, 1, 1],
            [8, 3, 1, 1],
            [10, 3, 1, 1],
            [9, 4, 1, 2],
            [8, 6, 1, 1],
            [10, 6, 1, 1],
            [7, 7, 1, 1],
            [11, 7, 1, 1],
          ]}
        />
      </span>
    </span>
  )
}

/* ---------- power symbol (start menu shut-down row) ---------- */

export function GlyphPower({ size = 16 }: { size?: number }) {
  return (
    <Pixels
      vw={9}
      vh={9}
      w={size}
      h={size}
      px={[
        [4, 0, 1, 4],
        [2, 1, 1, 1],
        [6, 1, 1, 1],
        [1, 2, 1, 1],
        [7, 2, 1, 1],
        [0, 3, 1, 3],
        [8, 3, 1, 3],
        [1, 6, 1, 1],
        [7, 6, 1, 1],
        [2, 7, 5, 1],
      ]}
    />
  )
}

/* ---------- dialog badges ---------- */

/** Red "access denied" badge for message boxes. */
export function BadgeError({ size = 32 }: { size?: number }) {
  return (
    <Pixels
      vw={14}
      vh={14}
      w={size}
      h={size}
      px={[
        // red disc
        [4, 0, 6, 1, ],
        [2, 1, 10, 1],
        [1, 2, 12, 2],
        [0, 4, 14, 6],
        [1, 10, 12, 2],
        [2, 12, 10, 1],
        [4, 13, 6, 1],
      ]}
      fill="var(--led-red)"
    />
  )
}

/** White X drawn over BadgeError (compose in a relative box). */
export function BadgeErrorX({ size = 32 }: { size?: number }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
      <BadgeError size={size} />
      <span style={{ position: 'absolute', left: 0, top: 0 }}>
        <Pixels
          vw={14}
          vh={14}
          w={size}
          h={size}
          fill="var(--paper)"
          px={[
            [4, 4, 2, 1],
            [8, 4, 2, 1],
            [5, 5, 2, 1],
            [7, 5, 2, 1],
            [6, 6, 2, 2],
            [5, 8, 2, 1],
            [7, 8, 2, 1],
            [4, 9, 2, 1],
            [8, 9, 2, 1],
          ]}
        />
      </span>
    </span>
  )
}
