import { create } from 'zustand'
import type { Object3D, Vector3 } from 'three'
import { useLibrary } from './libraryState'
import { useRoom } from './roomState'

/* =====================================================================
   The pin-up board — state, layout and camera pose.

   Four photographs are pinned to the cork board on the back wall. Click
   the board and the camera glides to a straight-on close-up; from there a
   print can be lifted off the cork and held up to the lens.

   Cross-module contract (it mirrors the library's):
     CameraRig   imports `usePins.open`, BOARD_FOV and boardCamPose to
                 cross-fade the room pose into the close-up
     Keyboard    reads `usePins.open` to stand down
     Terminal    the `pinboard` command calls openBoard()
     PinHud      the only DOM this feature owns (portalled to <body>)

   Everything spatial lives here so the meshes (SetDressing / PinUps) and
   the rig can never drift apart. Keep this file free of runtime `three`
   imports: the terminal (a lazy OS app) imports it, and a value import
   would drag the whole 3D library into a shared chunk.
   ===================================================================== */

/** the cork board on the back wall (world metres); the frame is w x h */
export const BOARD = { x: 0.87, y: 1.06, z: -1.0795, w: 0.5, h: 0.36, tilt: 0.008 } as const
/** the cork surface sits this far proud of the board's origin plane */
export const CORK_Z = 0.0056

/** a longer lens for the close-up, like the library's */
export const BOARD_FOV = 30
/** how much of the viewport the whole board fills at the close-up */
const FILL_V = 0.76
const FILL_H = 0.92

/** Straight-on close-up of the board, framed so it fills most of the
    viewport whatever the aspect ratio (a phone gets a wider shot). */
export function boardCamPose(aspect: number, outPos: Vector3, outTarget: Vector3): void {
  const halfV = Math.tan((BOARD_FOV * Math.PI) / 360)
  const halfH = halfV * Math.max(aspect, 0.1)
  const dist = Math.max(BOARD.h / 2 / (halfV * FILL_V), BOARD.w / 2 / (halfH * FILL_H))
  const z = BOARD.z + CORK_Z
  outTarget.set(BOARD.x, BOARD.y, z)
  outPos.set(BOARD.x, BOARD.y, z + dist)
}

/* ---------- the prints ---------- */

export type PrintId = 'wall' | 'lift' | 'io' | 'corridor'

export interface PrintSpec {
  id: PrintId
  /** the photograph itself, metres */
  pw: number
  ph: number
  /** paper margins around it, metres */
  mSide: number
  mTop: number
  mBot: number
  /** the whole print (photo + margins), metres */
  w: number
  h: number
  /** centre on the cork (board metres), and tilt about the wall normal */
  x: number
  y: number
  rot: number
  /** height of the paper above the cork surface, metres */
  z: number
  /** pushpin colour */
  pin: string
}

function print(
  id: PrintId,
  aspect: number,
  pw: number,
  x: number,
  y: number,
  rot: number,
  z: number,
  pin: string,
): PrintSpec {
  const mSide = 0.0058
  const mTop = 0.0058
  const mBot = 0.0125
  const ph = pw / aspect
  return { id, pw, ph, mSide, mTop, mBot, w: pw + mSide * 2, h: ph + mTop + mBot, x, y, rot, z, pin }
}

/* three portraits across the top, the landscape one under them, and the
   little paper cards fill the corner that is left (see CARDS in tex/room).
   Reading order = the order the arrow keys step through. */
export const PRINTS: readonly PrintSpec[] = [
  print('wall', 767 / 1024, 0.095, -0.122, 0.078, 0.045, 0.0042, '#d94a3d'),
  print('lift', 767 / 1024, 0.095, 0.0, 0.082, -0.03, 0.0046, '#2f8f9d'),
  print('io', 767 / 1024, 0.095, 0.122, 0.077, 0.038, 0.005, '#e6b83a'),
  print('corridor', 1024 / 844, 0.146, -0.14, -0.083, -0.04, 0.0054, '#3aa76d'),
]

export const PRINT_IDS: readonly PrintId[] = PRINTS.map((p) => p.id)

/** the pushpin holds a print this far below its top edge (metres) */
export const PIN_INSET = 0.0075

/** where a print's pushpin goes (cork-surface space), centred at the top */
export function printPin(p: PrintSpec): { id: string; x: number; y: number; z: number; color: string } {
  const oy = p.h / 2 - PIN_INSET
  return {
    id: p.id,
    x: p.x - Math.sin(p.rot) * oy,
    y: p.y + Math.cos(p.rot) * oy,
    z: p.z + 0.0012,
    color: p.pin,
  }
}

/* ---------- shared, non-reactive scratch ---------- */

/** The print under the pointer in the close-up. Written by the input
    layer, read by the prints' frame loop, so hovering never re-renders. */
export const pinHover: { id: PrintId | null } = { id: null }

/** Live objects the input layer needs to hit-test (registered by PinUps). */
export const pinRegistry: { prints: Map<PrintId, Object3D>; board: Object3D | null } = {
  prints: new Map(),
  board: null,
}

/** True while any print is on its way to or from the camera (held, or
    still easing back to the cork after a release) — NOT while one is just
    hovered on the board, which never changes its distance from the
    camera. Written by PinUps' frame loop; read by CameraRig, which must
    not pull the near plane in while a print could be anywhere between the
    board and the lens (see the board close-up's near-plane note there). */
export const pinFlight: { active: boolean } = { active: false }

/* ---------- the store ---------- */

interface PinState {
  /** the camera is parked at the board */
  open: boolean
  /** the print lifted off the cork and held up to the lens */
  heldId: PrintId | null

  openBoard: () => void
  closeBoard: () => void
  hold: (id: PrintId) => void
  release: () => void
  step: (dir: 1 | -1) => void
}

export const usePins = create<PinState>((set, get) => ({
  open: false,
  heldId: null,

  /* Refuses while the library is open (the two are exclusive). It does NOT
     look at the view: the terminal's `pinboard` command calls it while the
     camera is still pulling back from the screen, just like `library`. */
  openBoard: () => {
    if (get().open || useLibrary.getState().open) return
    set({ open: true, heldId: null })
    // "something is lifted to the camera": hides the room's hint line and
    // keeps Enter/Space from powering the machine on behind the close-up
    useRoom.getState().setPaperUp(true)
  },
  closeBoard: () => {
    if (!get().open) return
    set({ open: false, heldId: null })
    useRoom.getState().setPaperUp(false)
  },
  hold: (id) => {
    if (get().open) set({ heldId: id })
  },
  release: () => set({ heldId: null }),
  step: (dir) => {
    if (!get().open) return
    const n = PRINT_IDS.length
    const cur = get().heldId
    if (cur === null) {
      set({ heldId: PRINT_IDS[dir > 0 ? 0 : n - 1] })
      return
    }
    const i = PRINT_IDS.indexOf(cur)
    set({ heldId: PRINT_IDS[(i + dir + n) % n] })
  },
}))

/* dev only: window.__pins.getState() to inspect / drive the board from the
   console or a headless script. Nothing here reaches production. */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__pins = usePins
}
