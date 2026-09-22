import { extend } from '@react-three/fiber'
import type { ThreeElement } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/* =====================================================================
   Rounded boxes — the house style for anything a hand could pick up.

   Nothing in a real room has a razor edge: even a cheap beige case has a
   1–3 mm radius, and that radius is what catches the lamp and tells the
   eye "solid object". So every box in the scene is a <roundedBoxGeometry>
   whose radius is derived from its own size:

     <mesh>
       <roundedBoxGeometry args={rb(w, h, d)} />          // sensible default
       <roundedBoxGeometry args={rb(w, h, d, 0.012)} />   // a fatter edge
       <roundedBoxGeometry args={rb(w, h, d, 0.012, 4)} />// smoother curve
     </mesh>

   `rb` clamps the radius to 45 % of the smallest side, so it can never
   invert a thin plate. Importing this file registers the element with
   R3F (extend) and its JSX types. Do NOT use it on an InstancedMesh whose
   instances are non-uniformly scaled — the radius scales with them.
   ===================================================================== */

extend({ RoundedBoxGeometry })

declare module '@react-three/fiber' {
  interface ThreeElements {
    roundedBoxGeometry: ThreeElement<typeof RoundedBoxGeometry>
  }
}

/** Default edge radius for a box of this size (metres). */
export function edgeFor(w: number, h: number, d: number): number {
  const m = Math.min(w, h, d)
  // small parts get a fine edge, furniture-sized ones a softer one
  const cap = m < 0.06 ? 0.004 : 0.008
  return Math.max(0.0004, Math.min(m * 0.35, cap))
}

/** args tuple for <roundedBoxGeometry>: [w, h, d, segments, radius]. */
export function rb(
  w: number,
  h: number,
  d: number,
  radius?: number,
  segments = 2,
): [number, number, number, number, number] {
  const r = radius ?? edgeFor(w, h, d)
  const clamped = Math.max(0.0002, Math.min(r, Math.min(w, h, d) * 0.45))
  return [w, h, d, segments, clamped]
}
