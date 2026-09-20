import { useEffect, useRef, type CSSProperties } from 'react'
import { useSystem } from '../os/store'
import { useRoom } from './roomState'

/* =====================================================================
   The room tooltip — a tiny Silkscreen tag that trails the cursor while
   a prop is hovered. (The old "hire" toast lived here too; it was a
   floating panel and a dead end, so "hire" now boots the machine.) Lives in the DOM beside the canvas (rendered by
   Scene), positioned imperatively so it never re-renders per mousemove.
   ===================================================================== */

/* survives remounts so the tag doesn't flash at 0,0 */
let lastX = -200
let lastY = -200

const tagStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 45,
  pointerEvents: 'none',
  fontFamily: 'var(--font-label)',
  fontSize: '8px',
  letterSpacing: '1px',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  color: 'var(--term-green)',
  background: 'var(--ink)',
  border: '1px solid var(--face-darker)',
  boxShadow: '2px 2px 0 rgba(0, 0, 0, 0.55)',
  padding: '3px 7px 2px',
}

export default function RoomTooltip() {
  const label = useRoom((s) => s.tooltip)
  const view = useSystem((s) => s.view)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const move = (e: MouseEvent) => {
      lastX = e.clientX
      lastY = e.clientY
      const el = ref.current
      if (el) {
        el.style.left = `${lastX + 15}px`
        el.style.top = `${lastY + 20}px`
      }
    }
    window.addEventListener('mousemove', move, { passive: true })
    return () => window.removeEventListener('mousemove', move)
  }, [])

  const visible = view === 'room' && !!label
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-room-tooltip={visible ? 'on' : 'off'}
      style={{
        ...tagStyle,
        left: lastX + 15,
        top: lastY + 20,
        display: visible ? 'block' : 'none',
      }}
    >
      {label}
    </div>
  )
}
