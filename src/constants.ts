/* Shared physical constants — keep 3D scene and OS in agreement. */

/** Logical OS resolution (CSS px). The OS root div is exactly this size. */
export const SCREEN_W = 1024
export const SCREEN_H = 768

/**
 * World size of the CRT glass (meters-ish). With drei <Html transform
 * scale={HTML_SCALE}> a 1024px div maps exactly onto the glass plane.
 */
export const GLASS_W = 0.352
export const GLASS_H = 0.264
export const HTML_SCALE = GLASS_W / SCREEN_W // 1 css px -> world units

/** Camera vertical FOV (deg) used everywhere. */
export const CAM_FOV = 38
