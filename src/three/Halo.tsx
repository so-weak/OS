import type { Ref } from 'react'
import {
  AdditiveBlending,
  type CanvasTexture,
  type ColorRepresentation,
  type SpriteMaterial,
} from 'three'
import { makeSoftCircle } from './textures'

/* =====================================================================
   A soft additive glow behind an LED. A textured sprite (soft radial
   disc) so it composites correctly over the DOM alpha hole and never
   costs a light. Pass a `ref` to the material to drive `opacity` (and
   `color`) per frame alongside the LED's emissive.
   ===================================================================== */

let shared: CanvasTexture | null = null
/** One 64² soft disc for every halo in the room; never disposed. */
function haloTexture(): CanvasTexture {
  if (!shared) shared = makeSoftCircle()
  return shared
}

/* halos are decoration: never let them catch a raycast */
const noRaycast = () => undefined

export default function Halo({
  color,
  size,
  intensity = 1,
  position,
  ref,
}: {
  color: ColorRepresentation
  /** world diameter of the glow */
  size: number
  /** 0..1 opacity of the glow (static, or the starting value if ref'd) */
  intensity?: number
  position?: [number, number, number]
  ref?: Ref<SpriteMaterial>
}) {
  return (
    <sprite
      position={position}
      scale={[size, size, 1]}
      raycast={noRaycast}
      renderOrder={5}
    >
      <spriteMaterial
        ref={ref}
        map={haloTexture()}
        color={color}
        transparent
        opacity={intensity}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  )
}
