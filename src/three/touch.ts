import { create } from 'zustand'
import { useRoom } from './roomState'

/* =====================================================================
   Touch input for the room — "prime, then act".

   A mouse has a hover state, so a prop can say what it is before you
   commit to it. A finger has none: a tap fires pointerover and click in
   the same instant, so the old model flashed a label for one frame and
   then did the thing. On a phone the toy box was invisible — the only
   way to learn what the duck was, was to already have pressed it.

   So on `pointer: 'touch'` a Clickable takes two taps:

     tap 1  the prop names itself (a Silkscreen tag anchored ABOVE your
            fingertip, where the thumb is not covering it) and leans a
            couple of millimetres toward the lens. Nothing fires.
     tap 2  the same prop, within PRIME_MS — it does its thing.
     tap    a different prop: the tag moves there instead.
     tap    empty room: everything stands down.

   All of that state lives here because only one prop may hold the floor
   at a time and the dismiss-on-miss listener has to be shared. Nothing
   in this file is reachable from Clickable's mouse branch, so the desk
   raycast, the desk tooltip and the desk render never see any of it.
   ===================================================================== */

/** how long a primed prop stays armed for its second tap (ms) */
export const PRIME_MS = 3500
/** how long the tag lingers after the prop fires, so you can read what
    the prop renamed itself to on the way out (the duck's riddles) */
export const LINGER_MS = 2600
/** a fingertip, in CSS px — the hit target small props are grown to */
export const FINGER_PX = 44
/** the first few primes also say "tap again"; after that the visitor
    knows the rule and the hint gets out of the way for good */
const HINTS = 3

interface TouchState {
  /** the prop armed for its second tap (a Clickable's React id) */
  primed: string | null
  /** who owns the tag on screen — outlives `primed` through the linger */
  tagged: string | null
  /** show the "tap again" line under the label */
  hint: boolean
}

export const useTouch = create<TouchState>(() => ({
  primed: null,
  tagged: null,
  hint: false,
}))

let timer = 0
let primes = 0

function stopTimer(): void {
  if (timer) {
    clearTimeout(timer)
    timer = 0
  }
}

/** Tap one: the prop names itself and waits to be believed. */
export function primeTap(id: string, label?: string): void {
  stopTimer()
  primes += 1
  useTouch.setState({ primed: id, tagged: id, hint: primes <= HINTS })
  useRoom.getState().setTooltip(label ?? null)
  timer = window.setTimeout(dismissTap, PRIME_MS)
}

/**
 * Tap two: the prop is about to fire. The tag stays up a beat longer —
 * some props rename themselves as they go and the reply is worth
 * reading — but the arming is spent, so a third tap primes afresh.
 */
export function consumeTap(id: string): void {
  stopTimer()
  useTouch.setState({ primed: null, tagged: id, hint: false })
  timer = window.setTimeout(dismissTap, LINGER_MS)
}

/** A tap on empty room, a timeout, or the prop going away. */
export function dismissTap(): void {
  stopTimer()
  if (useTouch.getState().tagged === null) return
  useTouch.setState({ primed: null, tagged: null, hint: false })
  const room = useRoom.getState()
  if (room.tooltip !== null) room.setTooltip(null)
}

/** Stand down, but only if this prop is the one holding the floor. */
export function releaseTap(id: string): void {
  const s = useTouch.getState()
  if (s.primed === id || s.tagged === id) dismissTap()
}

/* ---------- where the tag hangs ----------
   The tag is DOM (Tooltip.tsx, beside the canvas) but it has to follow a
   point in the ROOM, so the prop holding it projects its own tap point
   every frame and hands the result straight to the tag's style. React is
   deliberately not in that loop: a label re-rendering at display rate
   would be the most expensive thing on the phone's main thread. */

type Painter = (x: number, y: number) => void
let painter: Painter | null = null

/** Tooltip lends its brush; the returned function is its cleanup. */
export function setTagPainter(fn: Painter): () => void {
  painter = fn
  return () => {
    if (painter === fn) painter = null
  }
}

/** Screen position of the tapped point, in CSS px. */
export function paintTag(x: number, y: number): void {
  painter?.(x, y)
}

/* ---------- tapping nothing ----------
   R3F sources its events from #root, so a native pointerdown reaches
   #root — and R3F's raycast — BEFORE it bubbles on to window. A
   Clickable that was hit claims the tap on its way past; if no claim
   arrives, the tap landed on the room itself and everything stands
   down. One listener, shared, removed when the last prop unmounts. */

let claimed = false
let watchers = 0

/** Called from a Clickable's onPointerDown: this tap has an owner. */
export function claimTap(): void {
  claimed = true
}

function onDown(): void {
  if (claimed) {
    claimed = false
    return
  }
  dismissTap()
}

/** Every touch Clickable calls this once; returns its own release. */
export function watchTaps(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (watchers === 0) {
    window.addEventListener('pointerdown', onDown, { passive: true })
  }
  watchers += 1
  return () => {
    watchers -= 1
    if (watchers === 0) {
      window.removeEventListener('pointerdown', onDown)
      claimed = false
    }
  }
}
