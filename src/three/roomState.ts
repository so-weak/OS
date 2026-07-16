import { create } from 'zustand'

/* =====================================================================
   Room-local interactive state (owned by the 3D module).

   Cross-module contract: the CRT bezel knobs live here. The 3D monitor
   applies KNOB_LEVELS[brightIdx] / KNOB_LEVELS[contrastIdx] as a CSS
   brightness()/contrast() filter on the OS plane, so the knobs always
   work. `src/os/crt/CrtOverlay.tsx` MAY additionally import { useRoom,
   KNOB_LEVELS } from here to scale its scanline/vignette strength —
   optional, read-only.
   ===================================================================== */

/** Detent values shared by both CRT knobs (index 2 = neutral). */
export const KNOB_LEVELS = [0.76, 0.88, 1, 1.12, 1.24] as const

interface RoomState {
  /** day/night — toggled by clicking the window ("let the sun in") */
  isDay: boolean
  toggleDay: () => void
  /** desk lamp on/off — toggled by clicking the lamp (easter egg) */
  lampOn: boolean
  toggleLamp: () => void
  /** floppy disk ejected/inserted (easter egg) */
  floppyOut: boolean
  toggleFloppy: () => void
  /** Silkscreen hover tooltip over room props (null = hidden) */
  tooltip: string | null
  setTooltip: (t: string | null) => void
  /** a desk paper is lifted to the camera — HUD hint hides behind it */
  paperUp: boolean
  setPaperUp: (up: boolean) => void
  /** CRT bezel knob detents — indexes into KNOB_LEVELS */
  brightIdx: number
  contrastIdx: number
  cycleBright: () => void
  cycleContrast: () => void
  /** typing "hire" on the room keyboard lights the sticky note */
  hireActive: boolean
  /** bumps every time "hire" is typed, so repeats re-arm the timer */
  hirePing: number
  pingHire: () => void
  endHire: () => void
}

export const useRoom = create<RoomState>((set) => ({
  isDay: false,
  toggleDay: () => set((s) => ({ isDay: !s.isDay })),
  lampOn: true,
  toggleLamp: () => set((s) => ({ lampOn: !s.lampOn })),
  floppyOut: false,
  toggleFloppy: () => set((s) => ({ floppyOut: !s.floppyOut })),
  tooltip: null,
  setTooltip: (t) => set({ tooltip: t }),
  paperUp: false,
  setPaperUp: (up) => set({ paperUp: up }),
  brightIdx: 2,
  contrastIdx: 2,
  cycleBright: () =>
    set((s) => ({ brightIdx: (s.brightIdx + 1) % KNOB_LEVELS.length })),
  cycleContrast: () =>
    set((s) => ({ contrastIdx: (s.contrastIdx + 1) % KNOB_LEVELS.length })),
  hireActive: false,
  hirePing: 0,
  pingHire: () =>
    set((s) => ({ hireActive: true, hirePing: s.hirePing + 1 })),
  endHire: () => set({ hireActive: false }),
}))
