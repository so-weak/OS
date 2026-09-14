import { create } from 'zustand'
import { useWorld } from '../world'

/* =====================================================================
   Easter-egg state shared across modules. The OS shell renders the
   overlays (BSOD, hacker mode); terminal commands, the konami code and
   3D room props trigger them. Final API — compose, don't extend other
   modules' stores.
   ===================================================================== */

interface EggsState {
  /** classic blue-screen overlay over the whole OS; any key dismisses */
  bsod: boolean
  /** konami-code "hacker mode" — green phosphor look on the OS root */
  hacker: boolean
  /** clicks on the rubber duck in the 3D room — persisted by the world
      store, mirrored here so the duck keeps its colour across visits */
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
  clickDuck: () => set({ duckClicks: useWorld.getState().bumpDuck() }),
}))
