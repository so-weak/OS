/* =====================================================================
   Shared spatial layout for the 3D room. One meter = one world unit.
   Everything that two components must agree on (desk height, monitor
   pose, camera poses) lives here so the rig and the meshes never drift.
   ===================================================================== */

import { Euler, MathUtils, Vector3 } from 'three'
import { CAM_FOV, GLASS_H, GLASS_W } from '../constants'
import type { DeviceState } from '../device'

/* ---------- desk ---------- */
export const DESK_TOP = 0.742 // world y of the desk surface
export const DESK = {
  x: 0.05,
  z: -0.62,
  w: 1.7,
  d: 0.66,
  thick: 0.045,
} as const

/* ---------- monitor ---------- */
/** Monitor group origin sits on the desk surface. */
export const MON_POS = new Vector3(0.02, DESK_TOP, -0.7)
/** Slight turn toward the room camera (radians). */
export const MON_YAW = 0.09
/** CRT glass centre in monitor-local space. */
/* Recessed 13 mm behind the bezel face (R-P4): the OS sits inside the
   chamfered frame like a real tube, and screenCamPose follows. */
export const GLASS_LOCAL = new Vector3(0, 0.26, 0.128)
/** Bezel front plate spans this local rect (used by Monitor.tsx). */
export const BEZEL = {
  halfW: 0.22,
  bottom: 0.06,
  top: 0.46,
  frontZ: 0.128,
  depth: 0.026,
  holeW: 0.362,
  holeH: 0.274,
  /** chamfer on the frame's edges — hole widens by this toward the face */
  bevel: 0.006,
} as const

const monEuler = new Euler(0, MON_YAW, 0)
export const GLASS_WORLD_CENTER = GLASS_LOCAL.clone()
  .applyEuler(monEuler)
  .add(MON_POS)
export const GLASS_WORLD_NORMAL = new Vector3(0, 0, 1).applyEuler(monEuler)

/* ---------- the window opening in the back wall ----------
   Shared by BackWall.tsx (cuts the hole), Window.tsx (frame, glass, sky
   layers) and Room.tsx (things that must clear it). `wallZ` is the plane
   of the back wall's room-side face; the sky layers sit BEHIND it (more
   negative z).

   The hole in the wall is frameW × frameH and `reveal` deep; the sash and
   its glass (glassW × glassH, `glassDepth` behind the wall face) sit in
   the outer part of that tunnel. A moulded casing stands `casingProud`
   off the wall and reaches `casingW` beyond the hole on the top and both
   sides, so the whole unit measures (frameW + 2·casingW) × (frameH +
   casingW + apron) on the wall; the sill projects `sillOut` into the room
   and runs `sillHorn` past the casing at each end. */
export const WINDOW = {
  x: -1.18,
  y: 1.52,
  wallZ: -1.08,
  glassW: 0.62,
  glassH: 0.82,
  frameW: 0.72,
  frameH: 0.92,
  reveal: 0.14,
  glassDepth: 0.098,
  casingW: 0.065,
  casingProud: 0.025,
  sillOut: 0.085,
  sillHorn: 0.03,
} as const

/* ---------- tower ---------- */
export const TOWER_POS = new Vector3(0.98, 0.25, -0.64)
export const TOWER_SIZE = { w: 0.22, h: 0.5, d: 0.48 } as const
export const TOWER_YAW = -0.05

/* ---------- camera ---------- */
/* pulled back and tilted down slightly from the original (0.88, 1.24,
   1.62) -> (-0.04, 0.86, -0.55) so the wastebasket behind the chair and
   the whole rug are back in frame */
export const ROOM_CAM_POS = new Vector3(1.07, 1.43, 2.12)
export const ROOM_CAM_TARGET = new Vector3(-0.1, 0.72, -0.5)
/** Where the camera boots up on first load (dollies into ROOM_CAM_POS). */
export const INTRO_CAM_POS = new Vector3(1.55, 1.72, 2.6)

/* ---------- framing the room on a small screen ----------
   The three constants above are a photograph: they were composed by eye
   in a 1440x900 window, and at that size they are the contract — the
   regression harness diffs them pixel for pixel. `roomCamPose` returns
   them verbatim for tier 'desk' and never touches the arithmetic below.

   Everywhere else the lens has to be re-derived, because a fixed
   vertical FOV keeps the frame's HEIGHT and throws its width away: on a
   9:16 phone the desk shot covers 0.94 m across, barely wider than the
   monitor, and the desk, the chair and the rug are all outside it.

   The geometry is unforgiving. A frame covers `width / aspect` of world
   height, always — so "fit the whole 2.1 m desk on a phone" also means
   "show 4.5 m of floor and ceiling in a 2.6 m room". Width and height
   cannot both be held. So this scales the covered width as a power of
   the aspect ratio:

       width(a) = ROOM_WIDTH * (a / ROOM_ASPECT) ** WIDTH_EXP

   WIDTH_EXP = 1 is the old behaviour (constant height, width collapses);
   0.5 would hold the frame's area (width 1.75 m on a phone, but 3.8 m of
   height — floor to well past the ceiling). 0.75 splits the difference:
   a 9:16 phone covers 1.28 m across and 2.78 m of height, so the desk
   runs edge to edge, the chair and the drawer stack bracket it, and the
   overflow lands on the posters above and the rug below instead of on
   bare wall. It is one continuous curve, so an orientation flip glides.

   Distance vs FOV: this pulls back first and widens the lens only for
   what is left over, because a long lens flatters the CRT and the room
   is small. The ceiling on pulling back is physical, not taste — the
   floor and both side walls stop at z = 2.3, so past `maxDist` the lens
   is standing outside the box. A phone runs out of room at ~3.0 m and
   makes up the rest at about 49 deg vertical, which in portrait is only
   ~24 deg horizontal: no wide-angle stretch where it would show. */

/** Aspect the room was composed at — the 1440x900 desk shot. */
const ROOM_ASPECT = 1.6
/** Unit vector from the room camera toward its target: the shot's axis. */
const ROOM_AXIS = ROOM_CAM_TARGET.clone().sub(ROOM_CAM_POS).normalize()
/** How far the desk shot stands off its target. */
const ROOM_DIST = ROOM_CAM_POS.distanceTo(ROOM_CAM_TARGET)
const ROOM_HALF_V = Math.tan(MathUtils.degToRad(CAM_FOV) / 2)
/** World width the desk shot covers at the target plane (3.257 m). */
const ROOM_WIDTH = 2 * ROOM_HALF_V * ROOM_ASPECT * ROOM_DIST
/** See the note above: 1 keeps the lens, 0.5 keeps the frame area. */
const WIDTH_EXP = 0.75
/** Nothing sane needs more; a freak viewport must not fish-eye the room. */
const CAM_MAX_FOV = 62
/** The floor plane and both side walls end here (Room.tsx). */
const ROOM_FRONT_Z = 2.3
/** Keep the lens this far inside that edge, so parallax cannot cross it. */
const CAM_FRONT_MARGIN = 0.16

/**
 * Furthest a camera may stand back along `axis` from `target` and still
 * be inside the room. `axis` points from the camera at the target, so
 * the camera sits at `target - axis * d` and its z grows as `-axis.z*d`.
 */
function maxDist(target: Vector3, axis: Vector3): number {
  const back = -axis.z
  if (back <= 1e-4) return Infinity
  return Math.max(0.5, (ROOM_FRONT_Z - CAM_FRONT_MARGIN - target.z) / back)
}

/**
 * The room pose for this device. Writes the pose into the out-vectors
 * and returns the vertical FOV (deg) to shoot it at.
 *
 * `dev` decides WHETHER to reframe (tier 'desk' gets the authored
 * constants, byte for byte, before any arithmetic runs); the camera's
 * own `aspect` decides HOW, the way screenCamPose and boardCamPose
 * already do it — the projection matrix is the authority on what the
 * lens actually sees, and it already tracks resize and orientation.
 */
export function roomCamPose(
  dev: DeviceState,
  aspect: number,
  outPos: Vector3,
  outTarget: Vector3,
): number {
  if (dev.tier === 'desk') {
    outPos.copy(ROOM_CAM_POS)
    outTarget.copy(ROOM_CAM_TARGET)
    return CAM_FOV_ROOM
  }
  const a = Math.max(aspect, 0.1)
  const width = ROOM_WIDTH * Math.pow(a / ROOM_ASPECT, WIDTH_EXP)
  /* The narrower the frame, the less of the room is left to compose
     with, so the aim slides off the authored point and onto the CRT's
     own centre: it re-centres the monitor and spends the extra height on
     the wall above rather than on more floorboards. Zero at 16:10 and
     wider, so a landscape tablet keeps the authored aim exactly. */
  const narrow = MathUtils.clamp(1 - a / ROOM_ASPECT, 0, 1)
  outTarget.lerpVectors(ROOM_CAM_TARGET, GLASS_WORLD_CENTER, narrow)

  const want = width / 2 / (ROOM_HALF_V * a)
  const dist = Math.min(want, maxDist(outTarget, ROOM_AXIS))
  outPos.copy(outTarget).addScaledVector(ROOM_AXIS, -dist)
  return Math.min(CAM_MAX_FOV, MathUtils.radToDeg(2 * Math.atan(width / 2 / (dist * a))))
}

/** The opening dolly, as an offset from the room pose it lands on. */
const INTRO_OFFSET = INTRO_CAM_POS.clone().sub(ROOM_CAM_POS)
const _introPos = new Vector3()
const _introTgt = new Vector3()

/**
 * Where the opening dolly starts on this device. The same move in the
 * camera's own frame as the desk shot's, scaled with the distance the
 * shot is taken from, so it always ends on `roomCamPose` — a dolly that
 * lands somewhere else reads as a bug.
 */
export function roomIntroPos(dev: DeviceState, aspect: number, out: Vector3): Vector3 {
  if (dev.tier === 'desk') return out.copy(INTRO_CAM_POS)
  roomCamPose(dev, aspect, _introPos, _introTgt)
  const scale = _introPos.distanceTo(_introTgt) / ROOM_DIST
  return out.copy(_introPos).addScaledVector(INTRO_OFFSET, scale)
}

/** Fraction of the limiting viewport dimension the glass fills at zoom. */
const SCREEN_FILL = 0.94

/**
 * Camera pose that frames the CRT glass, filling most of the viewport
 * regardless of aspect ratio. Writes into the provided vectors.
 */
export function screenCamPose(
  aspect: number,
  outPos: Vector3,
  outTarget: Vector3,
): void {
  const halfV = Math.tan(MathUtils.degToRad(CAM_FOV) / 2)
  const halfH = halfV * Math.max(aspect, 0.1)
  const dist = Math.max(
    GLASS_H / 2 / (halfV * SCREEN_FILL),
    GLASS_W / 2 / (halfH * SCREEN_FILL),
  )
  outTarget.copy(GLASS_WORLD_CENTER)
  outPos.copy(GLASS_WORLD_CENTER).addScaledVector(GLASS_WORLD_NORMAL, dist)
}

/* ---------- shared scene palette (materials, not CSS) ----------
   Mirrors tokens.css where a token exists: --amber #f0a72b,
   --led-green #46d160, --led-red #e8483f, --term-green #33ff66. */
export const P = {
  chassis: '#cdc8bc', // matches --face
  chassisDark: '#b4afa2',
  chassisDarker: '#8a857a', // --face-dark
  plasticDark: '#44413a', // --face-darker
  ink: '#1a1812', // --ink
  amber: '#f0a72b', // --amber
  ledGreen: '#46d160', // --led-green
  ledRed: '#e8483f', // --led-red
  termGreen: '#33ff66', // --term-green
  screenGlow: '#5fe6c4',
  wallA: '#2c313c',
  floorWood: '#4a3423',
  deskWood: '#6b4a2f',
  cable: '#141519',
  metal: '#3a3d42',
  night: '#0a0c11',
} as const

/* ---------- the stacks (3D library, back-left corner) ----------
   Local space: origin on the floor at the centre of the case, shelves
   facing local +z. BOOKCASE_YAW turns that front into the room. */
export const BOOKCASE_POS = new Vector3(-1.6, 0, -0.6)
export const BOOKCASE_YAW = 0.45

export const CASE = {
  /** outside width / height / depth of the carcass */
  w: 0.8,
  h: 1.52,
  d: 0.3,
  /** side plank thickness */
  side: 0.035,
  /** plinth height */
  plinth: 0.09,
  /** shelf board thickness */
  board: 0.022,
  /** usable run for books on one shelf */
  inner: 0.71,
} as const

/** Top surface of each book shelf (local y). Books stand on these.
    Five shelves at 0.263 m: the real shelf is over a hundred books, and
    the tallest spine (0.22 m, see bookDims) still clears the board above. */
export const SHELF_Y = [0.12, 0.383, 0.646, 0.909, 1.172] as const
/** Headroom above each shelf — the tallest volume must clear this. */
export const SHELF_CLEAR = 0.24

/** Front plane of the carcass in local z. */
export const CASE_FRONT = CASE.d / 2

const UP = new Vector3(0, 1, 0)

/** Bookcase-local point -> world. Writes into `out`. */
export function caseToWorld(local: Vector3, out: Vector3): Vector3 {
  return out.copy(local).applyAxisAngle(UP, BOOKCASE_YAW).add(BOOKCASE_POS)
}

/** Camera pose for library view — frames the shelves and the catalogue.
    A longer lens than the room (LIB_FOV): it crops the desk and the
    chair out of the shot and flattens the case the way a reader
    standing in front of it would see it. */
export const LIB_FOV = 35
export const LIB_CAM_TARGET = new Vector3(-1.535, 0.8, -0.465)
/* Far enough back to hold the placard and the catalogue card in one
   frame, and far enough left that the desk chair stays out of it. */
export const LIB_CAM_POS = new Vector3(-1.45, 0.97, 1.93)

const LIB_AXIS = LIB_CAM_TARGET.clone().sub(LIB_CAM_POS).normalize()
const LIB_DIST = LIB_CAM_POS.distanceTo(LIB_CAM_TARGET)
/** What the shelf shot is actually framed on: the carcass, top to toe.
    Derived from the pose above, so at 16:10 the fit below reproduces it. */
const LIB_FIT_H = 2 * Math.tan(MathUtils.degToRad(LIB_FOV) / 2) * LIB_DIST
/** The case plus a hand's width of air on each side. */
const LIB_FIT_W = CASE.w * 1.2

/**
 * The shelf pose for this device — same contract as `roomCamPose`.
 *
 * The desk shot is framed on the carcass's HEIGHT, which leaves the
 * 0.8 m case filling a third of a 16:10 frame and only 0.70 m of frame
 * to live in on a 9:16 phone: the sides of the case get cut off. So on
 * anything narrow this fits the case in both directions instead (the
 * same max-of-two-fits as screenCamPose), pulling back to the room's
 * front edge and widening the lens for the remainder.
 */
export function libCamPose(
  dev: DeviceState,
  aspect: number,
  outPos: Vector3,
  outTarget: Vector3,
): number {
  outTarget.copy(LIB_CAM_TARGET)
  if (dev.tier === 'desk') {
    outPos.copy(LIB_CAM_POS)
    return LIB_FOV
  }
  const a = Math.max(aspect, 0.1)
  const halfV = Math.tan(MathUtils.degToRad(LIB_FOV) / 2)
  const want = Math.max(LIB_FIT_H / 2 / halfV, LIB_FIT_W / 2 / (halfV * a))
  const dist = Math.min(want, maxDist(outTarget, LIB_AXIS))
  outPos.copy(outTarget).addScaledVector(LIB_AXIS, -dist)
  // the height it was composed on comes first; widen only if the case
  // still would not fit across
  const fov = Math.max(
    MathUtils.radToDeg(2 * Math.atan(LIB_FIT_H / 2 / dist)),
    MathUtils.radToDeg(2 * Math.atan(LIB_FIT_W / 2 / (dist * a))),
  )
  return Math.min(CAM_MAX_FOV, fov)
}

/** Re-export so the rig can lerp between the room lens and the shelf lens. */
export const CAM_FOV_ROOM = CAM_FOV
