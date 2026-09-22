import { MathUtils } from 'three'
import { useSystem } from '../os/store'
import { reducedMotion } from '../world'
import { useLibrary } from './libraryState'
import { useRoom } from './roomState'

/* =====================================================================
   `live` — every continuous value the room lights itself by, damped in
   ONE useFrame (WorldFrame.tsx, priority -1, runs before all others).
   Everyone reads it inside their own useFrame; nobody else writes it.

     day    0 night … 1 day            (roomState.isDay, DAY_FADE)
     dusk   0 … 1 golden-hour weight   (Bengaluru clock)
     lamp   0 off … 1 on               (roomState.lampOn)
     crt    0 off … 1 powered          (useSystem.power)
     rain   0 … 1                      (world.weather)
     flash  0 … 1 lightning envelope   (strike())
     idle   0 … 1                      (world.idle, slow)

   `canTransition()` is the shared rule for anything that would change
   the scenery on its own: only in room view, never over a lifted paper
   or an open bookcase. `strike()` is the only way to fire lightning and
   it enforces the same gate plus reduced-motion.
   ===================================================================== */

/** Shared damping rate for every day/night crossfade (≈1.5 s sunrise). */
export const DAY_FADE = 2.2

export const live = {
  day: 0,
  dusk: 0,
  lamp: 1,
  crt: 0,
  rain: 0,
  flash: 0,
  idle: 0,
  /** true while any of the above is still moving toward its target */
  settling: false,
}

/** May the world change the scenery right now? */
export function canTransition(): boolean {
  const view = useSystem.getState().view
  if (view !== 'room') return false
  if (useRoom.getState().paperUp) return false
  if (useLibrary.getState().open) return false
  return true
}

/* lightning: keyframes (0,1) (0.06,0.2) (0.1,0.8) (0.3,0) over `t` seconds */
let flashT = -1
let flashStrength = 0
const FLASH_KEYS: [number, number][] = [
  [0, 1],
  [0.06, 0.2],
  [0.1, 0.8],
  [0.3, 0],
]
function flashEnvelope(t: number): number {
  for (let i = 1; i < FLASH_KEYS.length; i++) {
    const [t0, v0] = FLASH_KEYS[i - 1]
    const [t1, v1] = FLASH_KEYS[i]
    if (t <= t1) return MathUtils.lerp(v0, v1, (t - t0) / (t1 - t0))
  }
  return 0
}

/** Fire a lightning strike (strength 0–1). Returns false if refused. */
export function strike(strength = 1): boolean {
  if (!canTransition() || reducedMotion()) return false
  flashT = 0
  flashStrength = MathUtils.clamp(strength, 0, 1)
  return true
}

/** @internal — WorldFrame's frame loop advances the lightning envelope. */
export function advanceFlash(dt: number): boolean {
  if (flashT < 0) return false
  flashT += dt
  live.flash = flashEnvelope(flashT) * flashStrength
  if (flashT > 0.3) {
    flashT = -1
    live.flash = 0
    return false
  }
  return true
}
