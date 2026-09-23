import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSystem } from '../os/store'
import {
  createRainAmbience,
  rainProbe,
  type RainAmbience,
  type RainInputs,
} from '../os/rainSound'
import { useWorld } from '../world'
import { useLibrary } from './libraryState'
import { live } from './live'

/* =====================================================================
   The sound of the window: rain on the glass, heard from inside.

   Renders nothing. It hands the ambience (src/os/rainSound.ts) what the
   room already knows — live.rain, whether the sky is a storm, whether
   the OS fills the screen, whether the camera is at the bookcase, the
   mute flag — and the ambience does the rest: the moment it hears that
   it is raining today it has its loops synthesised in idle time behind
   the reveal, it retargets its level ten times a second, it starts the
   instant the first gesture unlocks audio (the loops are already
   waiting), and it lets go of every node when the tab is hidden or this
   component unmounts (the /library page unmounts the whole scene).

   The inputs object is reused every frame: no per-frame allocation.
   ===================================================================== */

const inputs: RainInputs = { rain: 0, storm: false, screen: false, library: false, muted: false }

function read(): RainInputs {
  const sys = useSystem.getState()
  inputs.rain = live.rain
  inputs.storm = useWorld.getState().weather === 'storm'
  // zooming in is already "the OS is coming up": start easing then
  inputs.screen = sys.view === 'screen' || sys.view === 'zooming-in'
  inputs.library = useLibrary.getState().open
  inputs.muted = sys.muted
  return inputs
}

/* dev only: window.__rain.level() / .sources() / .state() for the browser
   checks (the gain follows live.rain, sources are running, nothing is
   left playing after unmount) */
declare global {
  interface Window {
    __rain?: {
      level: () => number
      sources: () => number
      state: () => ReturnType<typeof rainProbe>
    }
  }
}
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__rain = {
    level: () => rainProbe().level,
    sources: () => rainProbe().sources,
    state: rainProbe,
  }
}

export default function RainAudio(): null {
  const ambience = useRef<RainAmbience | null>(null)

  useEffect(() => {
    const a = createRainAmbience()
    ambience.current = a
    // a mute click should not wait for the next tick
    const unsub = useSystem.subscribe((s, prev) => {
      if (s.muted !== prev.muted) a.poke(read())
    })
    return () => {
      unsub()
      a.dispose()
      ambience.current = null
    }
  }, [])

  // after WorldFrame (priority -1) has damped live.rain for this frame
  useFrame((_, delta) => {
    ambience.current?.frame(delta, read())
  })

  return null
}
