import { useFrame } from '@react-three/fiber'
import { MathUtils } from 'three'
import { useSystem } from '../os/store'
import { duskAmount, useWorld, wantsDay } from '../world'
import { advanceFlash, canTransition, DAY_FADE, live } from './live'
import { useRoom } from './roomState'

/* =====================================================================
   The one frame loop that damps every shared light value (see live.ts).
   Priority -1 so it runs before every other useFrame in the scene.
   Also the only place the desk's clock is allowed to move the light —
   and only when nobody is reading (canTransition).
   ===================================================================== */

export default function WorldFrame() {
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const room = useRoom.getState()
    const world = useWorld.getState()
    const powered = useSystem.getState().power !== 'off'

    // the desk's clock may only move the light when nobody is reading
    if (!world.dayOverride && canTransition()) {
      const want = wantsDay()
      if (want !== room.isDay) room.setDay(want)
    }

    const dayT = room.isDay ? 1 : 0
    const duskT = duskAmount(world.hour)
    const lampT = room.lampOn ? 1 : 0
    const crtT = powered ? 1 : 0
    const rainT = world.weather === 'clear' ? 0 : 1
    const idleT = world.idle ? 1 : 0

    live.day = MathUtils.damp(live.day, dayT, DAY_FADE, dt)
    live.dusk = MathUtils.damp(live.dusk, duskT, DAY_FADE, dt)
    live.lamp = MathUtils.damp(live.lamp, lampT, 7, dt)
    live.crt = MathUtils.damp(live.crt, crtT, 5, dt)
    live.rain = MathUtils.damp(live.rain, rainT, 0.8, dt)
    live.idle = MathUtils.damp(live.idle, idleT, 1.5, dt)

    const flashing = advanceFlash(dt)

    live.settling =
      Math.abs(live.day - dayT) > 0.004 ||
      Math.abs(live.dusk - duskT) > 0.004 ||
      Math.abs(live.lamp - lampT) > 0.004 ||
      Math.abs(live.crt - crtT) > 0.004 ||
      flashing
  }, -1)

  return null
}
