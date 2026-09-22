import { create } from 'zustand'
import { useWorld } from '../world'

/* =====================================================================
   Easter-egg state shared across modules. The OS shell renders the
   overlays (BSOD, hacker mode); terminal commands, the konami code and
   3D room props trigger them. Final API — compose, don't extend other
   modules' stores.
   ===================================================================== */

/** after this many debugging sessions labubu ascends (Labubu.tsx, Terminal).
    Kept as DUCK_GOLDEN_AT — see duckClicks below, same reason. */
export const DUCK_GOLDEN_AT = 10

interface EggsState {
  /** classic blue-screen overlay over the whole OS; any key dismisses */
  bsod: boolean
  /** konami-code "hacker mode" — green phosphor look on the OS root */
  hacker: boolean
  /** clicks on labubu in the 3D room — persisted by the world store,
      mirrored here so it keeps its colour across visits. Field/action
      names below (duckClicks, bumpDuck, clickDuck, and the ledger id
      duck10 in world.ts) are unchanged from when this was a rubber duck:
      they're written to localStorage and the found[] ledger, so renaming
      them would orphan every visitor's saved progress for no real gain. */
  duckClicks: number
  triggerBsod: () => void
  dismissBsod: () => void
  toggleHacker: () => void
  clickDuck: () => void
}

export const useEggs = create<EggsState>((set) => ({
  bsod: false,
  hacker: false,
  duckClicks: useWorld.getState().duckClicks,
  triggerBsod: () => set({ bsod: true }),
  dismissBsod: () => set({ bsod: false }),
  toggleHacker: () => set((s) => ({ hacker: !s.hacker })),
  clickDuck: () => {
    const world = useWorld.getState()
    const n = world.bumpDuck()
    if (n >= DUCK_GOLDEN_AT) world.mark('duck10')
    set({ duckClicks: n })
  },
}))

/* The world is the source of truth for labubu: when it forgets
   (terminal `forget`) or rehydrates, the mirror follows and labubu
   goes back to factory pink. */
useWorld.subscribe((w) => {
  if (w.duckClicks !== useEggs.getState().duckClicks) {
    useEggs.setState({ duckClicks: w.duckClicks })
  }
})
