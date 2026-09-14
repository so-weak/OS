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
- Fonts: `var(--font-ui)` (IBM Plex Mono — what is actually installed;
  DotGothic16 never was) for OS chrome/apps, `var(--font-term)` (VT323)
  for BIOS/terminal, `var(--font-label)` (Silkscreen) for tiny labels.
- Font sizes are grid-locked for the bitmap faces — off-grid sizes render
  as mud with font-smoothing off: Plex Mono at 16px (32px big headers,
  24px mid headers), Silkscreen at 8px/16px, VT323 at 16px inside the OS
  (18–22px allowed for the room HUD). Small/metadata text (dates, badges,
  counts, fine print) is VT323 16px. Never introduce 9–14px or fractional
  font sizes anywhere — OS CSS, HUD, tooltips included.
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
- `src/world.ts` — THE memory, clock and idle detector (see "The world"
  below). The only file that touches localStorage.
- `src/three/live.ts` — the per-frame damped light values the whole room
  reads (`live.day/dusk/lamp/crt/rain/flash/idle`), `canTransition()`
  and `strike()`.

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
6. **The Stacks** — the library. Data in `src/data/library/**`, shared
   book art in `src/library/art.ts`, the catalogue page in
   `src/library/**`, the bookcase in `src/three/{Bookcase,CaseFittings,
   LibraryHud}.tsx` + `libraryState.ts` + `libraryTextures.ts`, routing
   in `src/router.tsx`. See the section below.
7. **The world** — `src/world.ts`, `src/WorldClock.tsx`, `src/three/live.ts`,
   `src/three/WorldFrame.tsx`. Memory, clock, idle, the per-frame light
   values. See "The world" below.

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

## The Stacks — the library (module 6)

Two halves. The bookcase in the room is the doorway; the catalogue is a
page at `/library`. Controls that are UI in costume were tried on the
case and removed: a shelf is a bad search box.

- `src/router.tsx` — the whole router. `/` is the room, `/library` and
  `/library/<book-id>` are the catalogue. `navigate()` pushes state and
  fires a popstate so `useRoute()` re-reads. `App.tsx` lazily loads
  either side, so the catalogue costs no three.js and vice versa.
- `tools/spa-pages.ts` — build-only. GitHub Pages has no server routing,
  so after the bundle it copies `index.html` to `dist/library/index.html`
  (a 200 for the catalogue) and `dist/404.html` (the fallback that
  serves `/library/<id>`). Asset URLs are absolute under `base: '/OS/'`,
  so a copy works from any depth.
- `src/data/library/**` — THE catalogue. Static content, authored in
  code. `types.ts` has the `Book` shape; `index.ts` has the queries
  (`selectBooks`, `genres`, `authors`, `genreStyle`, …). Nothing in the
  running site may add, edit or delete a volume. The array ends with a
  `/* @library:insert` marker — the dev-only ISBN scanner writes new
  entries directly above it.
- `src/library/art.ts` — the bookbinding, shared by both halves: spines,
  cloth boards, bookplates and EAN-13 barcodes, drawn on canvas from
  each book's own metadata. **Imports nothing from three.js on purpose**,
  so the catalogue chunk stays free of the 3D bundle; every drawing
  takes a `scale` so the same art serves a 30px spine and a full board.
  Callers must wait for `useFontsReady` (`src/useFontsReady.ts`) — a
  canvas rasterises with whatever face is loaded and never repaints.
- `src/library/LibraryPage.tsx` + `BookSpread.tsx` + `pieces.tsx` +
  `catalogue.css` — the page. Paper and oak, its own language rather
  than the Win9x kit. Query state lives in the URL so a shelf is
  shareable; `pieces.tsx` mounts the canvases into the DOM (detach on
  cleanup, never zero the backing store — StrictMode remounts).
- `src/three/Bookcase.tsx` — the case in the room: four shelves packed
  from the catalogue newest-first, hover peek, the held volume (same
  `depthTest:false` + `renderOrder` trick as Papers.tsx, for the same
  blending reason), dust on unread books, and the secret volume that
  swings the case open. `src/three/CaseFittings.tsx` adds the placard,
  the picture light and the brass plate that navigates to `/library`.
- `src/three/libraryState.ts` — `useLibrary`, now only what the room
  needs (open / selected / flipped / lamp / secret). **Cross-module
  contract:** `CameraRig` reads `open` to cross-fade to `LIB_CAM_POS`
  and the longer `LIB_FOV`; `Keyboard.tsx` reads it to stand down;
  Terminal's `library` command calls `openLibrary()`.
- `src/three/LibraryHud.tsx` — the only DOM the shelf owns (a way back,
  and the door to the catalogue). **Portalled to `<body>`, not `#root`**:
  R3F is wired to `#root` as its event source and raycasts on every
  pointer event regardless of which DOM element was hit, so an overlay
  inside `#root` would fire its button *and* pull a book off the shelf.
- Layout constants (`BOOKCASE_POS/YAW`, `CASE`, `SHELF_Y`, `LIB_CAM_*`,
  `LIB_FOV`, `caseToWorld`) live in `src/three/layout.ts` with the rest
  of the room's spatial contract. `SHELF_Y[0]` doubles as the base
  board — do not add a second one, they end up coplanar.
- `scan.html` + `src/dev/**` + `tools/library-writer.ts` — the ISBN
  intake console and the dev-server middleware that writes `books.ts`.
  `vite build` only ever builds `index.html` (pinned in
  `vite.config.ts`) and the plugin is `apply: 'serve'`, so none of it
  can reach production.

Gotcha worth keeping: a three.js material compiles map support at
creation, so a material that starts without a `map` ignores one attached
later. The shelf books key their material on whether the spine texture
has been drawn yet.

## The world — memory, clock, idle (module 7)

`src/world.ts` is top-level like `constants.ts`: both `src/os` and
`src/three` import it, so it imports neither.

- **Persistence.** `useWorld` (zustand `persist`, key `soubhikos-world`,
  versioned) is the ONLY code allowed to touch localStorage. It keeps:
  `visits/firstAt/lastAt`, `found` (the ledger), `duckClicks`, `snakeHi`
  (migrated from the old Snake key), `muted`, `windowTouched`, `blinds`.
  Writes go through named actions (`mark`, `bumpDuck`, `setSnakeHi`,
  `setMuted`, `setDayOverride`, `setBlinds`, `forget`). `useSystem.muted`
  and `useRoom.isDay` are seeded from it; `useEggs.duckClicks` mirrors it.
- **The ledger.** `LEDGER` lists every secret (id, riddle, done-line).
  The file that owns a moment calls `useWorld.getState().mark('<id>')`.
  Payoffs render inside the fiction only (terminal, dialog, drawer note,
  About box) — never a toast or HUD over the room.
- **Clock.** The desk is in Bengaluru and the LIGHT follows Bengaluru
  time (`hour`, refreshed by `<WorldClock/>` in App every 30 s); the
  visitor's own clock (`localHour`) is for greetings and the taskbar.
  Rule: a FIRST visit is always the night hero shot; from the second
  visit, or once the window has been clicked, `wantsDay()` follows the
  desk's clock. A window click is a session override (`dayOverride`).
  `weather` is chosen once per calendar day (`weatherForDay`); a first
  visit never opens on a storm.
- **Idle.** `<WorldClock/>` runs the one idle detector (40 s without
  pointer/key/wheel, paused while hidden). Moth, screensaver and burn-in
  read `useWorld.idle`; none run their own timers.
- **`live` (src/three/live.ts).** `<WorldFrame/>` (priority -1, first in
  Scene) damps `live.day/dusk/lamp/crt/rain/flash/idle` once per frame
  with `DAY_FADE`; every other useFrame reads them. `live.settling` is
  true while anything is still moving (drei Environment re-bake cue).
  Nobody else writes to `live`. `canTransition()` = view is 'room', no
  paper lifted, bookcase closed — the gate for every scenery change the
  world makes on its own (clock crossing dusk, lightning, moth). The
  clock never moves the light while someone is reading.
- **Scenery rules (agreed in review).** Discrete events (lightning) only
  via `strike()`: room view only, never in the first 60 s, never on a
  first visit, honour `prefers-reduced-motion` (`reducedMotion()`).
  `document.hidden` pauses every scenery timer. Slow drift is fine.
- **Sound.** Everything audible goes through `src/os/sound.ts` and obeys
  `muted`. No auto-playing ambient beds. New one-shots: named exports.
- **Lights budget.** The room already carries ~10 lights per lit fragment.
  A new light must retire one. drei `<Environment>` re-bakes by remount
  (`key`) on discrete states, never `frames={Infinity}`; `ContactShadows`
  bake with `frames={1}` (+ a `key` bump on events), never `Infinity`.
- **Window.** `src/three/Window.tsx` owns everything that comes through
  the glass — sky art, moon/sun spill, sun shaft, dusk, blinds, lightning.

## Easter eggs (mandate: go above and beyond)

Each module ships its assigned eggs — tasteful, discoverable, never
invented resume facts. Room props react to clicks (duck, lamp, tower power
button, floppy). Konami code → hacker mode. Terminal hides gag commands
(`sudo`, `format c:`, `matrix`, `neofetch`, `crash`, `library`…).
BIOS/BSOD carry period-correct jokes. Snake keeps a localStorage high
score. On the shelf: `SOUBHIK.SYS` is not a book (pull it and the case
swings open), unread volumes puff dust when you lift them, whatever is
being read right now wears a ribbon, and the catalogue page keeps the
ribbon as a bookmark poking out of the same volume.

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
