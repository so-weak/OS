/* =====================================================================
   Shell metrics + coordinate helpers.

   The OS root is a 1024x768 CSS-px div that lives on the CRT glass via
   drei <Html transform> — i.e. it is scaled/perspective-transformed in
   the browser viewport. Pointer math must therefore convert clientX/Y
   deltas into OS-local pixels using the root's on-screen bounding box.
   ===================================================================== */

import { SCREEN_W, SCREEN_H } from '../../constants'

/** Taskbar height in OS px (keep in sync with shell.css). */
export const TASKBAR_H = 30
/** Usable desktop height above the taskbar. */
export const DESKTOP_H = SCREEN_H - TASKBAR_H
/** Titlebar height + window frame padding (win95.css .win / .win-titlebar). */
export const TITLEBAR_H = 22
export const WIN_FRAME = 3

/** Default window minimum size when the registry doesn't pin one. */
export const DEFAULT_MIN_W = 220
export const DEFAULT_MIN_H = 140

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}

/** Browser-px -> OS-px scale factors of the transformed .os-root. */
export function osScale(from: HTMLElement): { sx: number; sy: number } {
  const root = from.closest('.os-root') as HTMLElement | null
  if (!root) return { sx: 1, sy: 1 }
  const r = root.getBoundingClientRect()
  return {
    sx: r.width > 0 ? r.width / SCREEN_W : 1,
    sy: r.height > 0 ? r.height / SCREEN_H : 1,
  }
}

/** Convert a client-space point into OS-local coordinates. */
export function localPoint(
  clientX: number,
  clientY: number,
  from: HTMLElement,
): { x: number; y: number } {
  const root = from.closest('.os-root') as HTMLElement | null
  if (!root) return { x: clientX, y: clientY }
  const r = root.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return { x: clientX, y: clientY }
  return {
    x: ((clientX - r.left) / r.width) * SCREEN_W,
    y: ((clientY - r.top) / r.height) * SCREEN_H,
  }
}
