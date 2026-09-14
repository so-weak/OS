# SoubhikOS

An interactive 3D retro-computer portfolio. A low-poly 1990s workstation sits
in a dark room; clicking the CRT boots "SoubhikOS", a Win9x-flavoured desktop
whose apps are the resume. In the corner of the same room stands **The
Stacks** — a bookcase you can walk to, pull a book off and turn over — and
its catalogue lives at [`/library`](#the-stacks--the-library).

Everything is original: all geometry, textures, pixel art, CSS and copy are
generated in code. No 3D assets, no image files, no fonts beyond three
bitmap-ish webfaces, no backend.

```bash
npm install
npm run dev      # the site
npm run scan     # the ISBN intake console (development only)
npm run build    # -> dist/, deployed to GitHub Pages by .github/workflows
```

Architecture and module contracts: [ARCHITECTURE.md](ARCHITECTURE.md).

## The Stacks — the library

Two halves, each doing what it is good at.

**The bookcase, in the room.** Click it (or type `library` in the SoubhikOS
terminal) and the camera walks over. The spines are real: every title is
stamped on a canvas drawn from that book's own metadata. Click one and the
volume lifts out; click it again to turn it over and read the bookplate — the
note, the stars, the date you finished it. `SOUBHIK.SYS` on the top shelf is
not a book. Unread volumes puff dust when you lift them. Whatever is being
read right now wears a ribbon.

There is deliberately **no search, no filter and no tab strip on the case**.
A shelf makes a bad search box, and controls built out of brass and card stock
end up looking like a toolbar in costume. The brass plate on the plinth —
`CONSULT THE CATALOGUE` — opens the real thing.

**The catalogue, at `/library`.** A page in its own right: a real search field,
genre chips, an author list, sort orders, and the five shelves (all, latest,
picks, reading, unread) as guide-card tabs. Two views — a wooden **shelf** of
spines at their true relative proportions, which reflows into more shelves as
the window narrows, and a **card** grid of cloth boards. Click any volume for
its spread: the front board on the left, the bookplate on the right, with
prev/next through whatever shelf you were looking at.

Every filter lives in the URL, so a shelf is shareable
(`/library?shelf=picks&genre=Fiction`), and each volume has its own address
(`/library/dune`). GitHub Pages has no server-side routing, so the build emits
`library/index.html` and a `404.html` fallback — see `tools/spa-pages.ts`.

The two halves share one set of drawings (`src/library/art.ts`): the same
canvas that becomes a texture on a 3D book becomes an `<img>`-shaped canvas on
the page. Landing on `/library` loads no three.js at all; the room and the
catalogue are separate chunks.

## Layout

```
src/router.tsx  where you are: the room (/) or the catalogue (/library)
src/three/      the room, the camera rig, the bookcase
src/os/         SoubhikOS: shell, window manager, apps, boot, sound
src/library/    the catalogue page + the book art both halves share
src/data/       resume.ts (the resume) and library/ (the catalogue data)
src/dev/        the ISBN intake console — dev only, never built
tools/          dev-server plugin that writes books.ts, build plugin that
                emits the static entry points for /library
```
