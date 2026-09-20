import Moth from './Moth'
import WallClock from './WallClock'
import { WeatherRunner } from './weather'

/* =====================================================================
   Mount point for the living-world props (owned by the scenery module):
   the Bengaluru wall clock, the moth around the lamp, the weather runner
   that schedules lightning. Scene.tsx mounts this once. Everything that
   comes through the glass itself lives in Window.tsx.
   ===================================================================== */

export default function Scenery() {
  return (
    <>
      <WallClock />
      <Moth />
      <WeatherRunner />
    </>
  )
}
