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
export const GLASS_LOCAL = new Vector3(0, 0.26, 0.148)
/** Bezel front plate spans this local rect (used by Monitor.tsx). */
export const BEZEL = {
  halfW: 0.22,
  bottom: 0.06,
  top: 0.46,
  frontZ: 0.128,
  depth: 0.026,
  holeW: 0.362,
  holeH: 0.274,
} as const

const monEuler = new Euler(0, MON_YAW, 0)
export const GLASS_WORLD_CENTER = GLASS_LOCAL.clone()
  .applyEuler(monEuler)
  .add(MON_POS)
export const GLASS_WORLD_NORMAL = new Vector3(0, 0, 1).applyEuler(monEuler)

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
