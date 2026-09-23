import { create } from 'zustand'

/* =====================================================================
   Which machine is this, really?

   One source of truth for every responsive decision in the app. Nothing
   else in the codebase is allowed to call matchMedia, read innerWidth,
   or sniff a user agent — they ask here, so the breakpoints exist in
   exactly one place and a desk browser provably takes the same path it
   took before this file existed.

   One deliberate exemption: src/world.ts owns `prefers-reduced-motion`.
   That is an accessibility preference, not a device tier — it is set by
   the person, applies equally to a phone and a desk, and belongs with
   the rest of world.ts's persisted preferences. This file answers "what
   is this machine", not "what did the visitor ask for".

   THE DESK INVARIANT. On a pointer:fine viewport wider than TABLET_MAX
   (the regression harness runs at 1440x900), this module reports

       { tier: 'desk', pointer: 'mouse', portrait: false, lite: false }

   and every consumer MUST fall through to the code path it had before.
   The desktop render is the contract; the phone is the new work. If a
   change would alter a single pixel at 1440x900, it belongs behind a
   tier check, not in the shared path.
   ===================================================================== */

/** Widest viewport still treated as a phone (CSS px). */
export const PHONE_MAX = 700
/** Widest viewport still treated as a tablet (CSS px). */
export const TABLET_MAX = 1100

export type DeviceTier = 'phone' | 'tablet' | 'desk'
export type PointerKind = 'mouse' | 'touch'

export interface DeviceState {
  tier: DeviceTier
  pointer: PointerKind
  /** taller than it is wide — drives the portrait camera framing */
  portrait: boolean
  /** viewport size in CSS px, as the room's camera sees it */
  w: number
  h: number
  /**
   * Run the room in its reduced form: lower pixel-ratio ceiling, cheaper
   * shadows, fewer particles. True on phones and on any device that
   * failed the capability probe — never on a desk.
   */
  lite: boolean
}

function mql(q: string): boolean {
  try {
    return window.matchMedia(q).matches
  } catch {
    return false
  }
}

/**
 * A phone rotated to landscape is still a phone.
 *
 * Judging a touch device by width alone gets this wrong in a way that
 * matters: an iPhone on its side is ~844px wide, which would read as a
 * tablet and hand phone silicon the full desktop settings — and it would
 * flip back and forth every time the visitor rotated. So a touch device
 * is judged by its SHORT edge, which is the one thing rotation does not
 * change. A mouse is judged by width, because a narrow desktop window
 * really is narrow and its height is not telling us anything about the
 * machine.
 */
function tierFor(w: number, h: number, pointer: PointerKind): DeviceTier {
  const ref = pointer === 'touch' ? Math.min(w, h) : w
  if (ref <= PHONE_MAX) return 'phone'
  if (ref <= TABLET_MAX) return 'tablet'
  return 'desk'
}

/** Read the live viewport. Safe to call before React mounts. */
export function readDevice(): DeviceState {
  // no window (SSR, a test harness): assume the desk, so the desk path
  // is also the default path
  if (typeof window === 'undefined') {
    return { tier: 'desk', pointer: 'mouse', portrait: false, w: 1440, h: 900, lite: false }
  }
  const w = window.innerWidth
  const h = window.innerHeight
  // `any-pointer: coarse` catches a touchscreen laptop without
  // demoting it; `pointer: coarse` is the PRIMARY input being a finger.
  const pointer: PointerKind = mql('(pointer: coarse)') ? 'touch' : 'mouse'
  const tier = tierFor(w, h, pointer)
  return {
    tier,
    pointer,
    portrait: h > w,
    w,
    h,
    lite: tier === 'phone',
  }
}

export const useDevice = create<DeviceState>(() => readDevice())

/** True on the machine the regression harness measures. */
export function isDesk(): boolean {
  return useDevice.getState().tier === 'desk'
}

/** Non-reactive read for module scope and useFrame callbacks. */
export function device(): DeviceState {
  return useDevice.getState()
}

let bound = false

/**
 * Start tracking resize/orientation. Idempotent; call once from App.
 * Writes only when something actually changed, so a resize storm does
 * not re-render the room every frame.
 */
export function watchDevice(): void {
  if (bound || typeof window === 'undefined') return
  bound = true
  const sync = (): void => {
    const next = readDevice()
    const cur = useDevice.getState()
    if (
      next.tier === cur.tier &&
      next.pointer === cur.pointer &&
      next.portrait === cur.portrait &&
      next.w === cur.w &&
      next.h === cur.h &&
      next.lite === cur.lite
    )
      return
    useDevice.setState(next)
  }
  window.addEventListener('resize', sync, { passive: true })
  window.addEventListener('orientationchange', sync, { passive: true })
}
