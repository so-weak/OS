import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { device, useDevice } from '../device'
import { useSystem } from '../os/store'
import { useRoom } from './roomState'
import { setTagPainter, useTouch } from './touch'

/* =====================================================================
   The room tooltip — a tiny Silkscreen tag that trails the cursor while
   a prop is hovered. (The old "hire" toast lived here too; it was a
   floating panel and a dead end, so "hire" now boots the machine.) Lives in the DOM beside the canvas (rendered by
   Scene), positioned imperatively so it never re-renders per mousemove.

   On a finger there is no cursor to trail and a tag under the thumb is
   a tag nobody can read, so the touch branch anchors it to the prop
   instead: the primed Clickable projects its own tapped point every
   frame (Clickable's TouchTag) and hands the screen position here,
   where it lands just ABOVE the fingertip. Same tag, same tokens, one
   grid step larger because 8px Silkscreen is not a phone size.

   The mouse branch below is byte-for-byte what it was: `touch` is
   permanently false on a pointer:fine machine, so the mousemove
   listener attaches once at mount exactly as before and the rendered
   style object is the same literal it always was.
   ===================================================================== */

/* survives remounts so the tag doesn't flash at 0,0 */
let lastX = -200
let lastY = -200

/* the touch branch's equivalent, written by the painter each frame so a
   React re-render (a new label) resumes from where the tag actually is */
let tapX = -200
let tapY = -200

/** clearance above the fingertip: half a 44px pad, plus air */
const LIFT_PX = 38
/** and a margin so the tag never runs off the edge of a phone */
const EDGE_PX = 10

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

/* the same tag, sized for a thumb and hung above the touch point. 16px
   is the other Silkscreen grid step, so the bitmap face stays crisp.

   Placed by TRANSFORM, not by left/top: a fixed box positioned with
   `left` shrink-wraps inside what is left of the viewport, so a tag
   near the right edge folded a two-word label onto three lines. Pinned
   at 0,0 it lays out against the whole width, and the transform moves
   it afterwards — which is also the cheaper of the two every frame. */
const touchTagStyle: CSSProperties = {
  ...tagStyle,
  left: 0,
  top: 0,
  fontSize: '16px',
  padding: '5px 10px 4px',
  boxShadow: '3px 3px 0 rgba(0, 0, 0, 0.55)',
  // wide enough that an ordinary name stays one line and reads as a
  // tag; the duck hands out whole riddles, and those may wrap
  whiteSpace: 'normal',
  maxWidth: '88vw',
  textAlign: 'center',
  lineHeight: 1.5,
  willChange: 'transform',
}

const hang = (x: number, y: number): string =>
  `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -100%)`

const hintStyle: CSSProperties = {
  display: 'block',
  marginTop: '5px',
  fontSize: '8px',
  color: 'var(--amber)',
}

export default function RoomTooltip() {
  const label = useRoom((s) => s.tooltip)
  const view = useSystem((s) => s.view)
  const touch = useDevice((s) => s.pointer) === 'touch'
  const hint = useTouch((s) => s.hint)
  const ref = useRef<HTMLDivElement>(null)
  /** measured once per label so the edge clamp costs no layout per frame */
  const half = useRef(0)
  const tall = useRef(0)

  useEffect(() => {
    if (touch) return
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
  }, [touch])

  // the prop that owns the tag drives this, once per rendered frame
  useEffect(() => {
    if (!touch) return
    return setTagPainter((x, y) => {
      const el = ref.current
      if (!el) return
      const w = device().w
      tapX = Math.min(
        Math.max(x, half.current + EDGE_PX),
        Math.max(w - half.current - EDGE_PX, half.current + EDGE_PX),
      )
      // above the finger, but never off the top of the screen
      tapY = Math.max(y - LIFT_PX, tall.current + EDGE_PX)
      el.style.transform = hang(tapX, tapY)
    })
  }, [touch])

  useLayoutEffect(() => {
    if (!touch) return
    const el = ref.current
    if (!el || !label) return
    half.current = el.offsetWidth / 2
    tall.current = el.offsetHeight
  }, [touch, label, hint])

  const visible = view === 'room' && !!label
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-room-tooltip={visible ? 'on' : 'off'}
      style={
        touch
          ? {
              ...touchTagStyle,
              transform: hang(tapX, tapY),
              display: visible ? 'block' : 'none',
            }
          : {
              ...tagStyle,
              left: lastX + 15,
              top: lastY + 20,
              display: visible ? 'block' : 'none',
            }
      }
    >
      {touch ? (
        <>
          {label}
          {hint && <span style={hintStyle}>tap again</span>}
        </>
      ) : (
        label
      )}
    </div>
  )
}
