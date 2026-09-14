import { create } from 'zustand'

/* =====================================================================
   The Stacks — state for the 3D shelf in the room.

   Searching, filtering and browsing all live on the catalogue page
   (src/library); the shelf is the doorway to it. So this store holds
   only what the room needs: whether the camera has walked over, which
   volume is in your hands, and two bits of furniture state.

   Cross-module contract: CameraRig imports `open` to cross-fade to
   LIB_CAM_POS and the longer LIB_FOV; Keyboard.tsx reads it to stand
   down; Terminal's `library` command calls openLibrary().
   ===================================================================== */

interface LibraryState {
  /** camera is parked at the bookcase */
  open: boolean
  /** book pulled off the shelf and held up to the camera */
  selectedId: string | null
  /** the held book is turned over, showing the bookplate */
  flipped: boolean
  /** the brass picture light under the cornice */
  lampOn: boolean
  /** SOUBHIK.SYS has been pulled — the case swings open (easter egg) */
  secret: boolean

  openLibrary: () => void
  closeLibrary: () => void
  select: (id: string | null) => void
  flip: () => void
  toggleLamp: () => void
  toggleSecret: () => void
}

export const useLibrary = create<LibraryState>((set, get) => ({
  open: false,
  selectedId: null,
  flipped: false,
  lampOn: true,
  secret: false,

  openLibrary: () => set({ open: true, selectedId: null, flipped: false }),
  closeLibrary: () => set({ open: false, selectedId: null, flipped: false }),
  select: (id) => set({ selectedId: id, flipped: false }),
  flip: () => set((s) => ({ flipped: !s.flipped })),
  toggleLamp: () => set((s) => ({ lampOn: !s.lampOn })),
  toggleSecret: () => set({ secret: !get().secret }),
}))
