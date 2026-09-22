import { useRef, type RefObject, type Ref } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  CanvasTexture,
  LinearFilter,
  SRGBColorSpace,
  type ColorRepresentation,
  type MeshStandardMaterial,
  type Sprite,
  type SpriteMaterial,
} from 'three'
import { makeCanvas } from './textures'

/* =====================================================================
   The glow around an LED, the way a lens shows it: a tight hot core with
   a faint inverse-square skirt, not a flat disc. A textured sprite (so it
   composites correctly over the DOM alpha hole and never costs a light).

   Pass a `ref` to the material to drive `opacity` (and `color`) yourself,
   or pass `source` — the LED's own emissive material — and the halo
   follows its real emissiveIntensity (`gain` glow per unit of emission,
   capped at `max`), so the two can never disagree.
   ===================================================================== */

let shared: CanvasTexture | null = null

/** One 128² falloff for every halo in the room; never disposed. */
function haloTexture(): CanvasTexture {
  if (shared) return shared
  const S = 128
  const ctx = makeCanvas(S, S)
  const img = ctx.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = Math.hypot((x + 0.5) / S - 0.5, (y + 0.5) / S - 0.5) * 2
      const core = 1 / (1 + (r / 0.09) ** 2) ** 1.5
      const skirt = 0.12 * Math.exp(-r * 4)
      // fade to exactly nothing at the sprite's edge
      const win = r >= 1 ? 0 : 1 - Math.max(0, (r - 0.62) / 0.38) ** 2
      const a = Math.min(1, core * 0.9 + skirt) * Math.max(0, win)
      const i = (y * S + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  const t = new CanvasTexture(ctx.canvas)
  t.colorSpace = SRGBColorSpace
  t.minFilter = LinearFilter
  t.magFilter = LinearFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  shared = t
  return t
}

/* halos are decoration: never let them catch a raycast */
const noRaycast = () => undefined

export default function Halo({
  color,
  size,
  intensity = 1,
  position,
  ref,
  source,
  gain = 0.22,
  max = 0.5,
}: {
  color: ColorRepresentation
  /** world diameter of the glow */
  size: number
  /** 0..1 opacity of the glow (static, or the starting value if ref'd) */
  intensity?: number
  position?: [number, number, number]
  ref?: Ref<SpriteMaterial>
  /** an emissive LED material: the halo tracks its emissiveIntensity */
  source?: RefObject<MeshStandardMaterial | null>
  gain?: number
  max?: number
}) {
  const own = useRef<SpriteMaterial>(null)
  const spriteRef = useRef<Sprite>(null)

  useFrame(() => {
    const led = source?.current
    const mat = own.current
    if (!led || !mat) return
    const op = Math.min(max, led.emissiveIntensity * gain)
    mat.opacity = op
    mat.color.copy(led.emissive)
    // an LED's glow is invisible well before its emission is: skip the
    // draw call entirely while dark instead of blending a transparent quad
    if (spriteRef.current) spriteRef.current.visible = op > 0.003
  })

  return (
    <sprite
      ref={spriteRef}
      position={position}
      scale={[size, size, 1]}
      raycast={noRaycast}
      renderOrder={5}
      visible={source ? true : intensity > 0.003}
    >
      <spriteMaterial
        ref={source ? own : ref}
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
