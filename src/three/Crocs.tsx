import { useEffect, useMemo } from 'react'
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/* =====================================================================
   A pair of Crocs, kicked off under the desk.

   White clogs with wild pink and purple swirls, like marbled tie-dye
   moulded plastic: a thick moulded sole with a rolled lip, a domed toe
   box with a ring of ventilation holes, an open collar with a shaded
   cream footbed, the heel strap swung back over the heel, and three
   jibbitz charms (a yellow star, a teal heart, an orange disc) in the
   toe-box holes.

   The whole pair is ONE merged geometry and ONE material: a single
   draw call, nothing coplanar (the flip-flops they replace glitched
   against the contact-shadow plane at y = 0.008), so the soles rest
   at 0.0088 — just above it — and the mesh only casts shadows.

   The swirls are not a texture (no UV seams to hide): every vertex
   carries its shoe-local position and a swirl mask (1 on the shell,
   ~0.4 in the footbed, 0 on holes and charms), and the material's
   fragment shader (onBeforeCompile) paints pink and purple ribbons
   over the white base from a 3-D domain-warped noise, with rotational
   twirls so the ribbons curl into real spiral arms. The pattern wraps
   the sole, upper and strap as one piece, and each shoe of the pair is
   seeded differently so they are not a copy.

   Shoe local frame: toe toward +x, up +y, width along z, sole bottom y=0.
   ===================================================================== */

const LF = 0.15 // toe end
const LR = 0.12 // heel end
const BF = 0.056 // half width across the toe box
const BR = 0.046 // half width at the heel
const TS = 0.026 // sole thickness

// the moulded plastic: one white for sole, upper and strap (so no seam),
// shaded to cream where the foot sits, near-black holes
const WHITE = new Color('#faf9f7')
const FOOT_SHADE = new Color('#d8d2c6')
const HOLE = new Color('#1b1422')

// the swirl pigments: pink runs candy -> hot magenta, purple violet -> grape
const PINK_CANDY = '#ff8fd0'
const PINK_HOT = '#f81ea0'
const PURPLE_VIOLET = '#9d5bff'
const PURPLE_GRAPE = '#5a20ab'

// jibbitz: chosen to pop against pink, purple and white
const CHARM_STAR = '#ffc61a'
const CHARM_HEART = '#19d3c5'
const CHARM_DISC = '#ff8a1c'

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Half width of the foot outline at x (a superellipse per end). */
function halfW(x: number): number {
  if (x >= 0) {
    const t = Math.min(1, x / LF)
    return BF * Math.pow(Math.max(0, 1 - Math.pow(t, 2.4)), 1 / 2.4)
  }
  const t = Math.min(1, -x / LR)
  return BR * Math.pow(Math.max(0, 1 - Math.pow(t, 2.2)), 1 / 2.2)
}

/** Height of the upper's crown along the length (before the side roll-off). */
function envelope(x: number): number {
  const H_TOE = 0.064
  const H_HEEL = 0.042
  const base = H_HEEL + (H_TOE - H_HEEL) * smooth(-0.03, 0.07, x)
  const capF = x > 0 ? Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, x / LF), 2.4)), 0.42) : 1
  const capR = x < 0 ? Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, -x / LR), 3)), 0.5) : 1
  return base * capF * capR
}

const XC = -0.03 // centre of the foot opening
const AX = 0.07
const AU = 0.62
const FOOTBED = 0.007

/** Upper surface height above the sole top at (x, u), u in [-1, 1] across. */
function height(x: number, u: number): number {
  const e = envelope(x) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u), 2.6)))
  const d = ((x - XC) / AX) ** 2 + (u / AU) ** 2
  if (d >= 1) return e
  const k = smooth(0.7, 1, d)
  return FOOTBED + (Math.max(e, FOOTBED) - FOOTBED) * k
}

/** Depth of "inside the opening" at (x, u): 0 outside, 1 deep inside. */
function inner(x: number, u: number): number {
  const d = ((x - XC) / AX) ** 2 + (u / AU) ** 2
  return 1 - smooth(0.5, 0.82, d)
}

/** Strip the attributes the merge does not need, pin the colour and the
    swirl mask (1 = fully swirled shell, 0 = plain colour: holes, charms).
    Every part must leave here with the same attribute set, non-indexed. */
function tidy(g: BufferGeometry, color: Color | null, mask = 1): BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g
  out.deleteAttribute('uv')
  const n = out.getAttribute('position').count
  if (color) {
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = color.r
      arr[i * 3 + 1] = color.g
      arr[i * 3 + 2] = color.b
    }
    out.setAttribute('color', new Float32BufferAttribute(arr, 3))
  }
  if (!out.getAttribute('aMask')) {
    out.setAttribute('aMask', new Float32BufferAttribute(new Float32Array(n).fill(mask), 1))
  }
  if (out === g) out = g.clone()
  return out
}

/** The rolled sole: an extruded foot outline with a soft bevel. */
function soleGeometry(): BufferGeometry {
  const N = 44
  const shape = new Shape()
  const xs: number[] = []
  for (let i = 0; i <= N; i++) xs.push(-LR + ((LR + LF) * i) / N)
  shape.moveTo(xs[0], 0)
  for (let i = 1; i < N; i++) shape.lineTo(xs[i], halfW(xs[i]))
  shape.lineTo(xs[N], 0)
  for (let i = N - 1; i > 0; i--) shape.lineTo(xs[i], -halfW(xs[i]))
  shape.closePath()
  const g = new ExtrudeGeometry(shape, {
    depth: TS - 0.006,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
    curveSegments: 1,
  })
  g.rotateX(-Math.PI / 2)
  g.translate(0, 0.003, 0)
  return tidy(g, WHITE)
}

/** The upper: a lofted height field over the foot outline, with the
    foot opening carved into it, the footbed shaded cream and its swirl paler. */
function upperGeometry(): BufferGeometry {
  const NX = 56
  const NZ = 28
  const pos: number[] = []
  const col: number[] = []
  const mask: number[] = []
  const tmp = new Color()
  for (let i = 0; i <= NX; i++) {
    const x = -LR + ((LR + LF) * i) / NX
    const w = halfW(x)
    for (let j = 0; j <= NZ; j++) {
      const u = -1 + (2 * j) / NZ
      pos.push(x, TS + height(x, u), u * w)
      const k = inner(x, u)
      tmp.copy(WHITE).lerp(FOOT_SHADE, k)
      col.push(tmp.r, tmp.g, tmp.b)
      mask.push(1 - 0.6 * k)
    }
  }
  const idx: number[] = []
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NZ; j++) {
      const a = i * (NZ + 1) + j
      const b = (i + 1) * (NZ + 1) + j
      const c = i * (NZ + 1) + j + 1
      const d = (i + 1) * (NZ + 1) + j + 1
      idx.push(a, c, b, b, c, d)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  g.setAttribute('aMask', new Float32BufferAttribute(mask, 1))
  g.setIndex(idx)
  g.computeVertexNormals()
  return tidy(g, null)
}

/** World point and outward normal on the upper at (x, u). */
function surface(x: number, u: number): { p: Vector3; n: Vector3 } {
  const w = Math.max(halfW(x), 1e-4)
  const e = 1e-3
  const y = TS + height(x, u)
  const dydx = (height(x + e, u) - height(x - e, u)) / (2 * e)
  const dydu = (height(x, u + e) - height(x, u - e)) / (2 * e)
  const n = new Vector3(-dydx, 1, -dydu / w).normalize()
  return { p: new Vector3(x, y, u * w), n }
}

/** A flattened part standing on the surface: local +z is the outward normal. */
function onSurface(g: BufferGeometry, x: number, u: number, lift: number): BufferGeometry {
  const { p, n } = surface(x, u)
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n)
  const m = new Matrix4().compose(p.clone().addScaledVector(n, lift), q, new Vector3(1, 1, 1))
  g.applyMatrix4(m)
  return g
}

function starShape(): Shape {
  const s = new Shape()
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? 0.0085 : 0.0038
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  s.closePath()
  return s
}

function heartShape(): Shape {
  const s = new Shape()
  const k = 0.0007
  s.moveTo(0, -6 * k)
  s.bezierCurveTo(-3 * k, -3 * k, -8 * k, 0, -8 * k, 3.5 * k)
  s.bezierCurveTo(-8 * k, 7 * k, -3 * k, 8 * k, 0, 4.5 * k)
  s.bezierCurveTo(3 * k, 8 * k, 8 * k, 7 * k, 8 * k, 3.5 * k)
  s.bezierCurveTo(8 * k, 0, 3 * k, -3 * k, 0, -6 * k)
  return s
}

/** One shoe. `side` flips the charms so the pair is not a copy. */
function shoeGeometry(side: 1 | -1): BufferGeometry {
  const parts: BufferGeometry[] = [soleGeometry(), upperGeometry()]

  // ventilation holes: dark, flattened, half sunk into the toe box
  const holes: [number, number][] = [
    [0.06, -0.58], [0.06, 0.58], [0.085, -0.3], [0.085, 0.3],
    [0.108, 0], [0.108, -0.55], [0.108, 0.55], [0.13, -0.28], [0.13, 0.28],
    [-0.095, -0.86], [-0.095, 0.86], [0.02, -0.9], [0.02, 0.9],
  ]
  for (const [x, u] of holes) {
    const d = ((x - XC) / AX) ** 2 + (u / AU) ** 2
    if (d < 1.25) continue // never inside the opening
    const g = new SphereGeometry(0.0062, 8, 6)
    g.scale(1, 1, 0.3)
    parts.push(tidy(onSurface(g, x, u, -0.0004), HOLE, 0))
  }

  // jibbitz charms
  const charm = (shape: Shape | null, color: string, x: number, u: number): BufferGeometry => {
    const g = shape
      ? new ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false, curveSegments: 6 })
      : new CylinderGeometry(0.0064, 0.0064, 0.004, 14).rotateX(Math.PI / 2)
    return tidy(onSurface(g, x, u * side, 0.0012), new Color(color), 0)
  }
  parts.push(charm(starShape(), CHARM_STAR, 0.085, -0.3))
  parts.push(charm(heartShape(), CHARM_HEART, 0.108, 0))
  parts.push(charm(null, CHARM_DISC, 0.13, 0.28))

  // the heel strap, swung back over the heel
  const strap = new TorusGeometry(0.041, 0.0042, 6, 24, Math.PI)
  strap.rotateY(Math.PI / 2)
  strap.scale(2.6, 1, 1)
  strap.rotateZ(1.2)
  strap.translate(-0.055, TS + 0.026, 0)
  parts.push(tidy(strap, WHITE))

  const merged = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())

  // the swirl's domain: the shoe-local position (before the pair's kicked-off
  // transforms) and a seed so the two shoes get different swirls
  const pos = merged.getAttribute('position')
  const sp = new Float32Array(pos.count * 4)
  for (let i = 0; i < pos.count; i++) {
    sp[i * 4] = pos.getX(i)
    sp[i * 4 + 1] = pos.getY(i)
    sp[i * 4 + 2] = pos.getZ(i)
    sp[i * 4 + 3] = side === 1 ? 0 : 1
  }
  merged.setAttribute('aSP', new Float32BufferAttribute(sp, 4))
  return merged
}

/** The pair, kicked off at angles to each other, sole bottoms at y = 0. */
function pairGeometry(): BufferGeometry {
  const a = shoeGeometry(1)
  a.applyMatrix4(
    new Matrix4().makeTranslation(0, 0, -0.07).multiply(new Matrix4().makeRotationY(0.5)),
  )
  const b = shoeGeometry(-1)
  b.applyMatrix4(
    new Matrix4().makeTranslation(0.03, 0, 0.09).multiply(new Matrix4().makeRotationY(-0.28)),
  )
  const merged = mergeGeometries([a, b], false)
  a.dispose()
  b.dispose()
  return merged
}

/* ---------------------------------------------------------------------
   The swirl: a fragment-shader function of the shoe-local position.

   Two vortices and a soft 3-D domain warp curl the space the pattern is
   read in, so straight noise contours shear into spiral arms. Two
   independent warped fields give the ribbons: one field's contour lines
   are pink (candy to hot magenta), the other's are purple (violet to
   deep grape); a wide ribbon and a thin accent ribbon per field. Most of
   the surface stays the white base. Purple is laid over pink, so where
   they cross they marble into each other. fwidth() keeps thin edges
   antialiased. Gradient noise (not value noise) so no grid shows.
   --------------------------------------------------------------------- */
const v3 = (hex: string): string => {
  const c = new Color(hex) // linear working space, like the vertex colours
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`
}

const SWIRL_GLSL = /* glsl */ `
varying vec3 vSP;
varying float vSeed;
varying float vMask;

const vec3 PINK_CANDY = ${v3(PINK_CANDY)};
const vec3 PINK_HOT = ${v3(PINK_HOT)};
const vec3 PURPLE_VIOLET = ${v3(PURPLE_VIOLET)};
const vec3 PURPLE_GRAPE = ${v3(PURPLE_GRAPE)};

vec3 chash(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return -1.0 + 2.0 * fract((p3.xxy + p3.yxx) * p3.zyx);
}

// 3-D gradient noise, quintic-smoothed, about -0.9..0.9
float cnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(mix(dot(chash(i), f),
            dot(chash(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0)), u.x),
        mix(dot(chash(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0)),
            dot(chash(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(dot(chash(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0)),
            dot(chash(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0)), u.x),
        mix(dot(chash(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0)),
            dot(chash(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0)), u.x), u.y), u.z);
}

// rotate p about the axis through c by turn * a gaussian falloff: a vortex
vec3 cspin(vec3 p, vec3 c, vec3 ax, float turn, float rad) {
  vec3 d = p - c;
  float a = turn * exp(-dot(d, d) / (rad * rad));
  float co = cos(a);
  float si = sin(a);
  return c + d * co + cross(ax, d) * si + ax * dot(ax, d) * (1.0 - co);
}

// a ribbon along the contour f = c: solid core, soft antialiased edge.
// returns the coverage; core is 1 on the centre line, 0 at the rim. A ribbon
// squeezed below a pixel by the swirl fades out instead of shimmering.
float cribbon(float f, float c, float w, out float core) {
  float d = abs(f - c);
  float px = fwidth(f) * 0.75;
  core = 1.0 - smoothstep(0.0, w, d);
  return (1.0 - smoothstep(w * 0.5, w + px, d)) * min(1.0, 2.0 * w / (px * 2.0 + 1e-4));
}

vec3 crocSwirl(vec3 base, vec3 sp, float seed, float mask) {
  float s = step(0.5, seed);
  vec3 p = sp * 17.0;                     // ~6 cm per noise cell
  p.z *= 1.0 - 2.0 * s;                   // the second shoe is mirrored...
  p = cspin(p, vec3( 1.35, 0.70,  0.25), normalize(vec3( 0.2, 0.3, 1.0)),  4.4, 1.2);
  p = cspin(p, vec3(-0.80, 0.60, -0.30), normalize(vec3(-0.3, 1.0, 0.5)), -3.8, 1.1);
  p = cspin(p, vec3( 0.30, 1.15,  0.00), normalize(vec3( 1.0, 0.3, 0.2)),  3.2, 0.9);
  p += s * vec3(7.3, -4.1, 11.9);         // ...and seeded elsewhere in the noise
  p += 0.95 * vec3(cnoise(p * 0.8 + 3.1), cnoise(p * 0.8 + 17.7), cnoise(p * 0.8 + 41.3));
  p += 0.35 * vec3(cnoise(p * 1.9 + 5.2), cnoise(p * 1.9 + 23.9), cnoise(p * 1.9 + 61.1));

  float a = cnoise(p * 0.9) + 0.40 * cnoise(p * 2.1 + 7.0);
  float b = cnoise(p * 0.8 + 11.3) + 0.40 * cnoise(p * 1.9 + 19.0);
  // ribbon thickness wanders along each ribbon
  float wa = 0.5 + 0.5 * smoothstep(-0.3, 0.3, cnoise(p * 0.7 + 4.0));
  float wb = 0.5 + 0.5 * smoothstep(-0.3, 0.3, cnoise(p * 0.6 + 14.0));

  float ka, kb, kc, kd;
  float pc = max(cribbon(a, -0.02, 0.05 + 0.065 * wa, ka), 0.9 * cribbon(a, 0.46, 0.034, kb));
  float vc = max(cribbon(b, 0.05, 0.036 + 0.05 * wb, kc), 0.9 * cribbon(b, -0.46, 0.028, kd));
  float pcore = max(ka, kb);
  float vcore = max(kc, kd);

  // each patch of ribbon leans candy or hot (violet or grape); the core runs deeper
  vec3 pink = mix(PINK_CANDY, PINK_HOT, smoothstep(-0.25, 0.2, cnoise(p * 0.55 + 2.0)) * (0.5 + 0.5 * pcore));
  vec3 grape = mix(PURPLE_VIOLET, PURPLE_GRAPE, smoothstep(-0.25, 0.2, cnoise(p * 0.5 + 8.0)) * (0.5 + 0.5 * vcore));

  vec3 c = mix(base, pink, pc);
  c = mix(c, grape, vc);
  return mix(base, c, mask);
}
`

/** One shared plastic: satin gloss, vertex-colour base, swirl in the shader. */
function crocsMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.4 })
  m.customProgramCacheKey = () => 'crocs-swirl-4'
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        () =>
          '#include <common>\nattribute vec4 aSP;\nattribute float aMask;\nvarying vec3 vSP;\nvarying float vSeed;\nvarying float vMask;',
      )
      .replace(
        '#include <begin_vertex>',
        () => '#include <begin_vertex>\nvSP = aSP.xyz;\nvSeed = aSP.w;\nvMask = aMask;',
      )
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', () => `${SWIRL_GLSL}\nvoid main() {`)
      .replace(
        '#include <color_fragment>',
        () =>
          '#include <color_fragment>\n\tdiffuseColor.rgb = crocSwirl(diffuseColor.rgb, vSP, vSeed, vMask);',
      )
  }
  return m
}

export default function Crocs({ position }: { position: [number, number, number] }) {
  const g = useMemo(() => pairGeometry(), [])
  const mat = useMemo(() => crocsMaterial(), [])
  useEffect(
    () => () => {
      g.dispose()
      mat.dispose()
    },
    [g, mat],
  )
  return <mesh geometry={g} material={mat} position={[position[0], 0.0088, position[2]]} castShadow />
}
