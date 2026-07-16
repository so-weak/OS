# SoubhikOS — architecture contract

A 3D retro-computer portfolio. A low-poly 1990s workstation sits in a dark
room; clicking the CRT zooms the camera in and the machine boots "SoubhikOS",
a Win9x-flavoured desktop whose apps are the resume. **Original work** — the
concept is retro-OS-portfolio, but all geometry, pixels, CSS and copy are ours.

## Hard rules

- All resume facts come from `src/data/resume.ts`. NEVER invent metrics,
  dates, names or projects. Import, don't copy.
- All OS styling composes the kit in `src/styles/win95.css` + tokens in
  `src/styles/tokens.css` (CSS vars like `--face`, `--bevel-out`). New CSS
  files are fine for layout, but colors/fonts MUST come from tokens.
- Fonts: `var(--font-ui)` (DotGothic16) for OS chrome/apps, `var(--font-term)`
  (VT323) for BIOS/terminal, `var(--font-label)` (Silkscreen) for tiny labels.
- Font sizes are grid-locked — these are bitmap-style faces and off-grid
  sizes render as mud (font-smoothing is off): DotGothic16 ONLY at 16px
  (or 32px for big headers; 24px tolerated for mid headers), Silkscreen
  at 8px/16px, VT323 at 16px inside the OS. Small/metadata text (dates,
  badges, counts, fine print) is VT323 16px, not a shrunken DotGothic.
  Never introduce 11–14px or fractional font sizes in OS CSS.
- TypeScript strict; no `any` unless unavoidable. No new npm deps.
- React 19 + three/@react-three/fiber@9 + drei@10 + zustand@5 are installed.
- Keep `npx tsc --noEmit` clean for YOUR files.

## Shared contracts (already written — read them first)

- `src/constants.ts` — SCREEN_W=1024, SCREEN_H=768, GLASS_W/H, HTML_SCALE,
  CAM_FOV. The OS root div is exactly 1024×768 CSS px.
- `src/os/store.ts` — `useSystem` (power/view state machine) and
  `useWindows` (window manager). Read the comments; these are final APIs.
- `src/os/registry.tsx` — `AppDefinition`, list of apps, `getApp(id)`.
  App components receive `{ windowId, props }` (`AppProps`).
- `src/os/icons/AppIcon.tsx` — `<AppIcon name size />`, resolves from
  `src/os/icons/icons.tsx` (`export const icons: Record<string, (p:{size:number})=>JSX.Element>`).
- `src/data/resume.ts` — identity, summary, skills, projects (with `art`
  paths under /projects/), experience, education, awards, certifications.
- `src/os/eggs.ts` — `useEggs` shared easter-egg store (bsod, hacker mode,
  duck clicks). Shell renders the overlays; anyone may trigger them.

## Module ownership (one agent each — do not touch other modules)

1. `src/three/**` — 3D scene. Default export `Scene` from `src/three/Scene.tsx`
   renders the full-viewport R3F `<Canvas>`. Owns camera rig driven by
   `useSystem` view state (room ↔ screen poses; call `zoomArrived()` when a
   tween lands; clicking the monitor calls `powerOn()`). Mounts the OS onto
   the CRT glass via drei `<Html transform occlude="blending"
   scale={HTML_SCALE}>` wrapping `<SoubhikOS />` (default export of
   `src/os/SoubhikOS.tsx`) inside a 1024×768 div.
2. `src/os/SoubhikOS.tsx` + `src/os/wm/**` — OS shell: root component
   (boot/desktop/shutdown switch), window chrome (drag/resize/min/max/close),
   desktop icons, taskbar (Start button, window buttons, clock, mute tray),
   Start menu. Renders apps from registry inside windows via `<Suspense>`.
3. `src/os/boot/**` + `src/os/crt/**` + `src/os/sound.ts` — BIOS POST screen,
   SoubhikOS splash w/ progress bar (skippable, then `bootComplete()`),
   shutdown sequence ("It is now safe…" + CRT power-off collapse, then
   `shutdownComplete()`), CRT overlay (scanlines/flicker/vignette), WebAudio
   synth SFX (no audio files): `playClick()`, `playBeep()`, `playStartup()`,
   `playShutdown()`, all no-ops when `useSystem.muted`.
4. `src/os/apps/**` — the apps (AboutMe, Projects, Experience, Skills,
   Resume, Contact, Awards, Welcome — plus Terminal & Snake owned by agent 5).
   Default exports matching registry imports.
5. `src/os/icons/icons.tsx` + `src/os/apps/Terminal.tsx` +
   `src/os/apps/Snake.tsx` — pixel icon set (16×16 grids, SVG rects,
   crispEdges) for names used in registry + `default`, `os-logo`, `back`,
   `folder`, `doc`; Terminal app; Snake game.

## Cross-module export contracts (pinned)

- `src/os/boot/BootSequence.tsx` — default export. BIOS POST + SoubhikOS
  splash; calls `bootComplete()` when done (skippable).
- `src/os/boot/ShutdownSequence.tsx` — default export. Shutdown screen +
  CRT collapse; calls `shutdownComplete()` when done.
- `src/os/crt/CrtOverlay.tsx` — default export. Always-on scanline/vignette
  overlay, `pointer-events: none`.
- `src/os/sound.ts` — named exports `playClick`, `playBeep`, `playStartup`,
  `playShutdown`. Any module may import them.
- The shell renders the BSOD overlay + konami listener from `useEggs`;
  Terminal's `crash` command calls `triggerBsod()`.

## Easter eggs (mandate: go above and beyond)

Each module ships its assigned eggs — tasteful, discoverable, never
invented resume facts. Room props react to clicks (duck, lamp, tower power
button, floppy). Konami code → hacker mode. Terminal hides gag commands
(`sudo`, `format c:`, `matrix`, `neofetch`, `crash`…). BIOS/BSOD carry
period-correct jokes. Snake keeps a localStorage high score.

## Room interactivity (mandate: the room is a toy box)

User directive: the 3D room must be richly interactive, not a diorama.
Owned by `src/three/**`; may add named exports to `src/os/sound.ts` (the
four pinned ones stay unchanged; everything respects `muted`). Hoverable
props show a tiny Silkscreen tooltip and pointer cursor. Required:

- **Papers**: a desk stack — clicking lifts one to camera as a readable
  mini-doc (copy from resume.ts only); crumpled balls can be tossed at the
  trash bin (arc animation, sink/miss counter, 3-in-a-row celebration).
- **Keyboard**: real keystrokes in room view visibly depress 3D keycaps
  with synth clacks; typing "hire" makes the sticky note glow / spawns a
  hint toast.
- **Mouse**: the 3D mouse glides on its pad, mirroring the user's cursor
  motion (clamped to the pad).
- **Drawers**: desk drawers slide open on click — floppies labelled with
  real project names, a Silver Star badge, an envelope of "secrets"
  ("nice try" note inside).
- **CRT knobs**: brightness/contrast knobs on the bezel actually tweak
  the CrtOverlay intensity (share state via `src/three/roomState.ts` or a
  small exported store — document it here if added).
- **Window (day mode)**: clicking the window toggles `roomState.isDay` —
  the sky art cross-fades to a pixel sun/clouds/daytime skyline, a warm
  sun shaft spotlight kicks in, and `src/three/DayNight.tsx` eases the
  ambient/hemisphere/background through a sunrise (shared `DAY_FADE`
  damping so the whole room transitions as one).
- Plus at least two inventions of the implementer's own (chair spin,
  blinds/moonlight, cork board polaroids, chiptune radio with EQ bars…).
  Everything cleans up listeners and stays cheap per-frame.

## Integration notes

- Apps may import `useWindows` (e.g. Projects opening detail views via
  `setTitle`, Terminal's `open <app>` calling `openApp`).
- Welcome window: shell auto-opens app id `welcome` once per boot.
- The OS must never assume it fills the browser viewport — it lives in a
  1024×768 div scaled in 3D. Use absolute layout within `.os-root`.
- Pointer events: drei Html already forwards DOM events; window dragging uses
  pointer capture on the titlebar.
