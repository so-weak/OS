import type { ReactElement } from 'react'
import { KNOB_LEVELS, useRoom } from '../../three/roomState'
import './crt.css'

/* =====================================================================
   Always-on CRT texture over the OS: scanlines, RGB sub-pixel mask,
   slow flicker, drifting light band, vignette + faint edge glow.
   pointer-events: none — the desktop below stays fully interactive.
   The bezel knobs in the 3D room (src/three/roomState.ts) drive the
   picture itself via a CSS filter on the OS plane (Monitor.tsx); here
   the contrast knob additionally digs the tube texture in or washes it
   out, so twisting it feels physical on both the picture and the glass.
   ===================================================================== */

export default function CrtOverlay(): ReactElement {
  const contrastLevel = KNOB_LEVELS[useRoom((s) => s.contrastIdx)]
  // neutral detent = 1 -> full texture; low contrast softens the
  // scanline/mask layers, high contrast is already deepened by the
  // picture filter, so we cap at 1 rather than double up.
  const texOpacity = Math.min(1, 0.25 + 0.75 * contrastLevel)

  return (
    <div className="crt-overlay" aria-hidden="true">
      <div style={{ opacity: texOpacity }}>
        <div className="crt-scanlines" />
        <div className="crt-mask" />
      </div>
      <div className="crt-flicker" />
      <div className="crt-roll" />
      <div className="crt-vignette" />
    </div>
  )
}
