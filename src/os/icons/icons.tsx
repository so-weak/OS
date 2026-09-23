import type { JSX } from 'react'

/* =====================================================================
   SoubhikOS pixel icon set — every icon is an original 16×16 pixel
   grid drawn as run-length-merged SVG <rect>s (crispEdges), so they
   stay razor sharp at 16px, 32px and on the CRT texture.

   Art direction: warm chassis beiges, deep-sea blue, amber and
   phosphor green — the same families as tokens.css, expressed as a
   pixel-art micro-palette (hex is intentional here; pixel art needs
   exact ramps, not var() indirection inside SVG).
   ===================================================================== */

/** shared micro-palette — one letter per ink */
const PAL: Record<string, string> = {
  k: '#1a1812', // ink
  K: '#44413a', // charcoal (face-darker)
  d: '#8a857a', // warm grey (face-dark)
  f: '#cdc8bc', // chassis beige (face)
  l: '#f4f1e8', // light beige (face-light)
  w: '#ffffff', // white
  p: '#fdfcf7', // paper
  b: '#0d3f66', // deep-sea blue
  B: '#1786a0', // sea blue
  t: '#16766e', // CRT teal
  a: '#f0a72b', // amber
  A: '#b5720a', // amber deep (leather / shadow)
  Y: '#ffd166', // amber light (highlight)
  g: '#33ff66', // phosphor green
  G: '#12a13d', // phosphor shadow
  r: '#e8483f', // LED red
  z: '#050a06', // terminal black
  s: '#e8b98a', // skin
  h: '#3b2a1c', // hair
}

interface Run {
  x: number
  y: number
  w: number
  fill: string
}

/** merge horizontal runs of identical pixels into single rects */
function toRuns(rows: readonly string[]): Run[] {
  const out: Run[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      const fill = PAL[ch]
      if (fill === undefined) {
        x++
        continue
      }
      let end = x + 1
      while (end < row.length && row[end] === ch) end++
      out.push({ x, y, w: end - x, fill })
      x = end
    }
  })
  return out
}

/* An icon's rects never change — not between sizes, not between mounts,
   not between renders — so they are built once, lazily, and the finished
   <svg> is kept per rendered size. Handing React the IDENTICAL element
   back on a re-render lets it bail out of the whole subtree: the DOM is
   never touched, which is both why it is fast and why the pixels cannot
   move. (Before this, every parent re-render — the taskbar clock ticking,
   a desktop icon being selected — rebuilt ~40 <rect> elements per icon;
   that alone was 470 ms of a throttled boot.) Sizes are the handful of
   grid-locked values the OS uses (16/24/28/32/36/40/64), so the cache is
   bounded by construction. */
function makeIcon(rows: readonly string[]): (p: { size: number }) => JSX.Element {
  let rects: JSX.Element[] | null = null
  const bySize = new Map<number, JSX.Element>()
  return function PixelIcon({ size }: { size: number }): JSX.Element {
    const hit = bySize.get(size)
    if (hit) return hit
    rects ??= toRuns(rows).map((r, i) => (
      <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
    ))
    const el = (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
      >
        {rects}
      </svg>
    )
    bySize.set(size, el)
    return el
  }
}

/* =====================================================================
   The artwork
   ===================================================================== */

/** ID card: photo, amber name line, grey detail lines */
const about = makeIcon([
  '................',
  '................',
  '.kkkkkkkkkkkkkk.',
  '.kbbbbbbbbbbbbk.',
  '.kbbbbbbbbbbbbk.',
  '.kppppppppppppk.',
  '.kphhhhpaaaaapk.',
  '.kphsshpppppppk.',
  '.kpsssspdddddpk.',
  '.kpBBBBpppppppk.',
  '.kpBBBBpdddddpk.',
  '.kppppppppppppk.',
  '.kppppppppppppk.',
  '.kkkkkkkkkkkkkk.',
  '................',
  '................',
])

/** manila folder */
const folder = makeIcon([
  '................',
  '................',
  '................',
  'AAAAA...........',
  'AaaaaAAAAAAAAAA.',
  'AYYYYYYYYYYYYYA.',
  'AaaaaaaaaaaaaaA.',
  'AaaaaaaaaaaaaaA.',
  'AaaaaaaaaaaaaaA.',
  'AaaaaaaaaaaaaaA.',
  'AaaaaaaaaaaaaaA.',
  'AaaaaaaaaaaaaaA.',
  'AAAAAAAAAAAAAAA.',
  '................',
  '................',
  '................',
])

/** work folder: manila folder + deep-blue wrench across the front */
const folderWork = makeIcon([
  '................',
  '................',
  '................',
  'AAAAA...........',
  'AaaaaAAAAAAAAAA.',
  'AYYYYYYYYbYbYYA.',
  'AaaaaaaaabbbaaA.',
  'AaaaaaaaabbaaaA.',
  'AaaaaaaabbaaaaA.',
  'AaaaaaabbaaaaaA.',
  'AaaaaabbaaaaaaA.',
  'AaaabbbaaaaaaaA.',
  'AAAAAAAAAAAAAAA.',
  '................',
  '................',
  '................',
])

/** leather briefcase with bright clasp */
const briefcase = makeIcon([
  '................',
  '................',
  '.....kkkkkk.....',
  '.....kk..kk.....',
  '.KKKKKKKKKKKKKK.',
  '.KaaaaaaaaaaaaK.',
  '.KaaaaaaaaaaaaK.',
  '.KKKKKKKYYKKKKK.',
  '.KAAAAAAYYAAAAK.',
  '.KAAAAAAAAAAAAK.',
  '.KAAAAAAAAAAAAK.',
  '.KAAAAAAAAAAAAK.',
  '.KKKKKKKKKKKKKK.',
  '................',
  '................',
  '................',
])

/** CPU: ceramic body, teal die window, green core, grey pins */
const chip = makeIcon([
  '................',
  '................',
  '....d.d.d.d.....',
  '....d.d.d.d.....',
  '...kkkkkkkkkk...',
  '..dkKKKKKKKKkd..',
  '...kKttttttKk...',
  '..dkKttggttKkd..',
  '...kKttggttKk...',
  '..dkKttttttKkd..',
  '...kKKKKKKKKk...',
  '...kkkkkkkkkk...',
  '....d.d.d.d.....',
  '....d.d.d.d.....',
  '................',
  '................',
])

/** dog-eared sheet with red PDF band */
const pdf = makeIcon([
  '................',
  '...kkkkkkkk.....',
  '...kpppppplk....',
  '...kppppppllk...',
  '...kppppppppk...',
  '...kpddddddpk...',
  '...kppppppppk...',
  '...kpddddddpk...',
  '...kppppppppk...',
  '...krrrrrrrrk...',
  '...kwwrwwrwwk...',
  '...krrrrrrrrk...',
  '...kppppppppk...',
  '...kkkkkkkkkk...',
  '................',
  '................',
])

/** generic dog-eared document */
const doc = makeIcon([
  '................',
  '...kkkkkkkk.....',
  '...kpppppplk....',
  '...kppppppllk...',
  '...kppppppppk...',
  '...kpddddddpk...',
  '...kppppppppk...',
  '...kpddddddpk...',
  '...kppppppppk...',
  '...kpddddddpk...',
  '...kppppppppk...',
  '...kpddddpppk...',
  '...kppppppppk...',
  '...kkkkkkkkkk...',
  '................',
  '................',
])

/** envelope with V flap */
const mail = makeIcon([
  '................',
  '................',
  '................',
  '................',
  '..kkkkkkkkkkkk..',
  '..kkllllllllkk..',
  '..klkllllllklk..',
  '..kllkllllkllk..',
  '..klllkkkklllk..',
  '..kllllllllllk..',
  '..kllllllllllk..',
  '..kllllllllllk..',
  '..kkkkkkkkkkkk..',
  '................',
  '................',
  '................',
])

/** amber cup, engraved 1, plinth */
const trophy = makeIcon([
  '................',
  '....AAAAAAAA....',
  '...AaaYaaaaaA...',
  '..A.aaYakaaa.A..',
  '..A.aaYkkaaa.A..',
  '..A.aaaakaaa.A..',
  '...AaaakkkaaA...',
  '.....aaaaaa.....',
  '......aaaa......',
  '.......AA.......',
  '.......AA.......',
  '.....AAAAAA.....',
  '....AAAaaAAA....',
  '....AAAAAAAA....',
  '................',
  '................',
])

/** beige CRT with green prompt — the MS-DOS-box of SoubhikOS */
const terminal = makeIcon([
  '................',
  '................',
  '.dddddddddddddd.',
  '.dffffffffffffd.',
  '.dfzzzzzzzzzzfd.',
  '.dfzgzzzzzzzzfd.',
  '.dfzzgzzzzzzzfd.',
  '.dfzzzgzzzzzzfd.',
  '.dfzzgzzzzzzzfd.',
  '.dfzgzzzgggzzfd.',
  '.dfzzzzzzzzzzfd.',
  '.dffffffffffffd.',
  '.dddddddddddddd.',
  '.....dddddd.....',
  '...dddddddddd...',
  '................',
])

/** phosphor snake winding toward an amber apple */
const snake = makeIcon([
  '................',
  '................',
  '...gggggggggg...',
  '...GGGGGGGGGG...',
  '...........gG...',
  '...........gG...',
  '...gggggggggg...',
  '...GGGGGGGGGG...',
  '...gG...........',
  '...gG....ggg..g.',
  '...gggggggkg.aa.',
  '...GGGGGGgggraA.',
  '................',
  '................',
  '................',
  '................',
])

/** SoubhikOS mark: amber bolt-S on a deep-sea badge with CRT sheen */
const osLogo = makeIcon([
  '................',
  '................',
  '...kkkkkkkkkk...',
  '..kBBBBBBBBBBk..',
  '..kbbbYYYYYbbk..',
  '..kbbaabbbbbbk..',
  '..kbbaabbbbbbk..',
  '..kbbbaaaabbbk..',
  '..kbbbbbbaabbk..',
  '..kbbbbbbaabbk..',
  '..kbbaaaaabbbk..',
  '..kbbbbbbbbbbk..',
  '..kbbbbbbbbbbk..',
  '...kkkkkkkkkk...',
  '................',
  '................',
])

/** generic window */
const def = makeIcon([
  '................',
  '................',
  '................',
  '..kkkkkkkkkkkk..',
  '..kbbbbbbbbbwk..',
  '..kffffffffffk..',
  '..kfddddddfffk..',
  '..kffffffffffk..',
  '..kfddddddddfk..',
  '..kffffffffffk..',
  '..kfddddfffffk..',
  '..kffffffffffk..',
  '..kkkkkkkkkkkk..',
  '................',
  '................',
  '................',
])

/** chunky back arrow */
const back = makeIcon([
  '................',
  '................',
  '................',
  '.......b........',
  '......bb........',
  '.....bbb........',
  '....bbbbbbbbbbb.',
  '...bbbbbbbbbbbb.',
  '..bbbbbbbbbbbbb.',
  '...bbbbbbbbbbbb.',
  '....bbbbbbbbbbb.',
  '.....bbb........',
  '......bb........',
  '.......b........',
  '................',
  '................',
])

/** speaker + phosphor sound waves */
const soundOn = makeIcon([
  '................',
  '................',
  '................',
  '........k.......',
  '.......kk...g...',
  '......kkk....g..',
  '..kkkkkkk.g..g..',
  '..kkkkkkk..g.g..',
  '..kkkkkkk..g.g..',
  '..kkkkkkk.g..g..',
  '......kkk....g..',
  '.......kk...g...',
  '........k.......',
  '................',
  '................',
  '................',
])

/** speaker + red mute cross */
const soundOff = makeIcon([
  '................',
  '................',
  '................',
  '........k.......',
  '.......kk.......',
  '......kkk.r...r.',
  '..kkkkkkk..r.r..',
  '..kkkkkkk...r...',
  '..kkkkkkk..r.r..',
  '..kkkkkkk.r...r.',
  '......kkk.......',
  '.......kk.......',
  '........k.......',
  '................',
  '................',
  '................',
])

export const icons: Record<string, (p: { size: number }) => JSX.Element> = {
  about,
  'folder-work': folderWork,
  briefcase,
  chip,
  pdf,
  mail,
  trophy,
  terminal,
  snake,
  'os-logo': osLogo,
  default: def,
  back,
  folder,
  doc,
  'sound-on': soundOn,
  'sound-off': soundOff,
}
