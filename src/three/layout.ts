/* =====================================================================
   Shared spatial layout for the 3D room. One meter = one world unit.
   Everything that two components must agree on (desk height, monitor
   pose, camera poses) lives here so the rig and the meshes never drift.
   ===================================================================== */

import { Euler, MathUtils, Vector3 } from 'three'
import { CAM_FOV, GLASS_H, GLASS_W } from '../constants'

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
   of the back wall; the sky layers sit BEHIND it (more negative z). */
export const WINDOW = {
  x: -1.18,
  y: 1.52,
  wallZ: -1.08,
  glassW: 0.62,
  glassH: 0.82,
  frameW: 0.72,
  frameH: 0.92,
} as const

/* ---------- tower ---------- */
export const TOWER_POS = new Vector3(0.98, 0.25, -0.64)
export const TOWER_SIZE = { w: 0.22, h: 0.5, d: 0.48 } as const
export const TOWER_YAW = -0.05

/* ---------- camera ---------- */
export const ROOM_CAM_POS = new Vector3(0.88, 1.24, 1.62)
export const ROOM_CAM_TARGET = new Vector3(-0.04, 0.86, -0.55)
/** Where the camera boots up on first load (dollies into ROOM_CAM_POS). */
export const INTRO_CAM_POS = new Vector3(1.55, 1.72, 2.6)

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

/** Re-export so the rig can lerp between the room lens and the shelf lens. */
export const CAM_FOV_ROOM = CAM_FOV
