import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type CanvasTexture,
  type Group,
  type MeshStandardMaterial,
} from 'three'
import { useSystem } from '../os/store'
import { DUCK_GOLDEN_AT, useEggs } from '../os/eggs'
import { playLabubuGiggle } from '../os/sound'
import { LEDGER, useWorld } from '../world'
import Clickable from './Clickable'
import { useRoom } from './roomState'
import { DESK_TOP } from './layout'
import { finish, makeCanvas } from './textures'
import {
  at,
  deform,
  fabricSet,
  lathe,
  mergeParts,
  paint,
  smoothstep,
  softBox,
  sweep,
  tint,
} from './tex/furniture'

/* =====================================================================
   Labubu, perched on top of the CRT where the rubber duck used to sit.

   ORIGINAL WORK: this is a hand-modelled low-poly homage built from the
   house furniture toolkit (sweep/lathe/softBox/deform + procedural fur
   maps) — no official art, no logos, no packaging, nothing traced. It is
   Soubhik's take on "mischievous elf-toy with big ears and a grin", not
   a reproduction of any copyrighted design.

   Behaviour is ported click-for-click from the duck: the same underdamped
   squash/hop/spin springs, the same click → useEggs.clickDuck() → world
   pipeline, the same 10th-click triple spin and golden promotion. Those
   internal names (duckClicks, bumpDuck, DUCK_GOLDEN_AT, and the ledger id
   "duck10") are UNCHANGED on purpose: they are persisted in localStorage
   and in the found[] ledger, so renaming them would either orphan every
   visitor's progress or need a migration for a toy swap that isn't worth
   one. The toy changed; the wiring underneath kept its name.
   ===================================================================== */

/* Palette matched to Soubhik's reference photo of a real Labubu: a
   bubblegum-pink fur hood over a pale cream vinyl face, one pink ear and
   one yellow ear, a warm orange nose, and glittery orange-to-red eyes
   over a dark open grin — not the old duck's flat yellow at all. */
const BODY = '#f2add0' // pastel bubblegum pink — not yellow, pops off the beige case
const BODY_DARK = '#dd84ad' // arms/legs, a shade deeper for depth
const CREAM = '#faf1e0' // face patch
const BLUSH = '#efa0ac' // cheeks
const INNER_EAR = '#df6f9b' // contrasting inner ear, dusty rose
const EAR_ALT = '#f6d24e' // the reference's second ear is yellow, not pink
const NOSE = '#f2a13c' // small warm nose, not the flat dark duck bill
const MOUTH_DARK = '#3a1116' // the open grin behind the teeth
const MOUTH_HALF_W = 0.027 // the grin spans most of the lower face, like the photo
const MOUTH_HALF_H = 0.0115 // kept at the proportion the cavity/tooth math was tuned for
const EYE_TOP = '#ffd53f' // eyes are a glittery orange-to-red gradient
const EYE_BOTTOM = '#e02a3c'
const TOOTH = '#fbf8f0'
/** after DUCK_GOLDEN_AT debugging sessions labubu is gold-plated: a real
    metallic-gold fur look isn't possible, so it becomes a solid gold vinyl
    toy variant instead (eyes and teeth stay put). */
const GOLD = '#ddb84f'

/* ---------- the body: one swept shell, torso → head → crown ---------- */

const SPINE: [number, number, number][] = [
  [0, 0.0, 0.0],
  [0, 0.01, 0.005],
  [0, 0.021, 0.002],
  [0, 0.035, 0.005],
  [0, 0.051, 0.014],
  [0, 0.069, 0.022],
  [0, 0.085, 0.017],
  [0, 0.099, 0.007],
]
/** [t, in-plane half-thickness, lateral half-width] — small ankle, a
    pinched waist, then the head (about 60% of the run) swelling out
    into the biggest part of the figure. */
const KEYS: [number, number, number][] = [
  [0.0, 0.0045, 0.0045],
  [0.12, 0.022, 0.023],
  [0.27, 0.016, 0.017],
  [0.4, 0.022, 0.023],
  [0.53, 0.029, 0.03],
  [0.68, 0.036, 0.037],
  [0.84, 0.031, 0.031],
]
function section(t: number): [number, number] {
  const last = KEYS[KEYS.length - 1]
  if (t >= last[0]) {
    // hemispherical crown: the tube pinches to a point at the last
    // SPINE vertex, so that vertex IS the top of the head
    const k = Math.sqrt(Math.max(0, 1 - ((t - last[0]) / (1 - last[0])) ** 2))
    return [last[1] * k, last[2] * k]
  }
  for (let i = 1; i < KEYS.length; i++) {
    if (t <= KEYS[i][0]) {
      const a = KEYS[i - 1]
      const b = KEYS[i]
      const u = smoothstep(a[0], b[0], t)
      return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
    }
  }
  return [last[1], last[2]]
}
/** linear read of the raw spine (not arc-length-exact, but close enough
    to place a face on a stylised toy) — used to seat eyes/nose/teeth/
    cheeks directly on the same profile that shapes the head. */
function spineAt(t: number): { y: number; z: number } {
  const idx = Math.min(1, Math.max(0, t)) * (SPINE.length - 1)
  const i0 = Math.floor(idx)
  const i1 = Math.min(SPINE.length - 1, i0 + 1)
  const f = idx - i0
  const a = SPINE[i0]
  const b = SPINE[i1]
  return { y: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f }
}
/** a point ON the head's surface at height-fraction t, lateral offset x —
    treats the cross-section there as circular (it's close enough near the
    face) so features can be placed by the same numbers that built it. */
function headSurface(t: number, x: number): { y: number; z: number } {
  const c = spineAt(t)
  const [a, b] = section(t)
  const r = (a + b) / 2
  const dz = Math.sqrt(Math.max(0, r * r - x * x))
  return { y: c.y, z: c.z + dz }
}

interface LabubuGeo {
  /** torso, head, ears, arms, legs, face patch, cheeks — one vertex-
      coloured shell, one draw call */
  fur: BufferGeometry
  /** the two eyes: a fixed glossy gradient stare, like the real toy — no eyelid geometry exists to close over them, so there is no blink */
  eyes: BufferGeometry
  /** nose + the nine teeth + eye highlights — static, vertex-coloured */
  face: BufferGeometry
}

function buildLabubu(): LabubuGeo {
  const path = new CatmullRomCurve3(
    SPINE.map((p) => new Vector3(...p)),
    false,
    'centripetal',
  ).getPoints(48)
  const body = sweep({
    path,
    radial: 16,
    size: section,
    ref: new Vector3(1, 0, 0),
    vTile: 0.014,
  })
  // flat-ish underside so it sits on the CRT's curved top instead of rocking
  deform(body, (p) => {
    if (p.y < 0.003) p.y = 0.003 - (0.003 - p.y) * 0.2
  })
  tint(body, BODY)
  // cream face + blush cheeks are PAINTED onto the shell itself (not a
  // separate flat patch) so they hug the head's real curve instead of
  // floating in front of it like a mask
  const creamC = new Color(CREAM)
  const blushC = new Color(BLUSH)
  const cheekL = headSurface(0.63, -0.026)
  const cheekR = headSurface(0.63, 0.026)
  paint(body, (p, n, out) => {
    const faceMask =
      smoothstep(0.12, 0.55, n.z) *
      smoothstep(0.036, 0.05, p.y) *
      (1 - smoothstep(0.092, 0.1, p.y))
    if (faceMask > 0.01) out.lerp(creamC, faceMask)
    const dl = Math.hypot(p.x + 0.026, p.y - cheekL.y, p.z - cheekL.z)
    const dr = Math.hypot(p.x - 0.026, p.y - cheekR.y, p.z - cheekR.z)
    const cheekMask = (1 - smoothstep(0.009, 0.018, Math.min(dl, dr))) * smoothstep(0.15, 0.5, n.z)
    if (cheekMask > 0.01) out.lerp(blushC, cheekMask * 0.55)
  })
  const furParts: BufferGeometry[] = [body]

  // ears: tapered cones with a soft forward bend, each with a coloured
  // inner-ear petal built and tinted BEFORE the ear is placed, so one
  // at() moves the pair together
  for (const s of [-1, 1]) {
    const cone = lathe(
      [
        [0, 0],
        [0.013, 0],
        [0.0135, 0.008],
        [0.012, 0.02],
        [0.009, 0.034],
        [0.005, 0.048],
        [0, 0.058],
      ],
      { segments: 10 },
    )
    deform(cone, (p) => {
      p.z += 0.007 * (p.y / 0.058) ** 2 // gentle forward bend
    })
    // the reference photo's two ears don't match — one pink, one yellow
    tint(cone, s === 1 ? EAR_ALT : BODY)
    const petal = new SphereGeometry(0.007, 8, 6)
    petal.scale(1, 1.5, 0.32)
    petal.translate(0, 0.024, 0.007)
    tint(petal, INNER_EAR)
    const ear = mergeParts([cone, petal], true)
    furParts.push(at(ear, s * 0.026, 0.081, 0.016, -0.14, 0, s * 0.32))
  }

  // stubby arms, drooping out from the shoulders
  for (const s of [-1, 1]) {
    const arm = softBox(0.013, 0.03, 0.015, 0.0055, 0.02, 3)
    furParts.push(tint(at(arm, s * 0.039, 0.033, 0.006, 0, 0, s * 0.4), BODY_DARK))
  }
  // stubby feet, peeking out from under the belly
  for (const s of [-1, 1]) {
    const leg = softBox(0.02, 0.016, 0.024, 0.007, 0.02, 3)
    furParts.push(tint(at(leg, s * 0.017, 0.008, 0.017), BODY))
  }

  const fur = mergeParts(furParts, true)

  // eyes: big, glossy, glittery — a gradient from a golden-yellow crown
  // down to a hot red base (painted in the sphere's own local space,
  // before it is placed) — always wide open, matching the reference
  const eyeTopC = new Color(EYE_TOP)
  const eyeBottomC = new Color(EYE_BOTTOM)
  const eyeParts: BufferGeometry[] = []
  // REVIEW FIX: t=0.74 put the eyes' own bottom rim almost flush against
  // the top tooth row's gumline (under 1mm apart) with nowhere for a
  // nose to sit between them. Raised toward the crown to open real space
  // for the nose below — still well short of the t=0.84 crown pinch.
  for (const s of [-1, 1]) {
    const eye = new SphereGeometry(0.0095, 14, 10)
    paint(eye, (p, _n, out) => {
      out.copy(eyeBottomC).lerp(eyeTopC, smoothstep(-0.008, 0.008, p.y))
    })
    const ref = headSurface(0.8, s * 0.017)
    eyeParts.push(at(eye, s * 0.017, ref.y, ref.z + 0.001))
  }
  const eyes = mergeParts(eyeParts, true)

  // nose + nine small pointed teeth along the grin + eye highlights —
  // static, vertex-coloured (dark for the nose, white for the rest) so
  // they share one glossy material and one draw call
  //
  // REVIEW FIX: the eyes and nose were originally almost the same
  // height, so the nose sphere sat wedged between the two eyes instead
  // of below them — read as a cluttered "three-eyed" mess instead of a
  // face. Eyes moved up (see above) to open a real gap; nose sized to
  // sit in it without touching either. Mouth position
  // (t=0.6) is left alone — it's what the cavity/tooth maths below was
  // proven against, and moving it swallows every tooth but the two at
  // the rim (see the cavity-bulge comment below).
  const detailParts: BufferGeometry[] = []
  const noseRef = headSurface(0.685, 0)
  detailParts.push(
    tint(at(new SphereGeometry(0.0036, 8, 6), 0, noseRef.y, noseRef.z + 0.0008), NOSE),
  )
  // the grin: a wide, flattened dark cavity sitting proud of the face —
  // an explicit mesh, not a paint mask, so it reads regardless of how
  // the swept head's real normals fall near the mouth — ringed with two
  // full rows of small pointed teeth: Soubhik was explicit that the
  // reference photo's mouth needs "multiple white teeth", top and
  // bottom, not a single tidy row.
  const mouthRef = headSurface(0.6, 0)
  // flattened further than it looks like it needs to be: an ellipsoid
  // bulges forward MOST at its own centre, so even a shallow z-scale
  // here was enough to poke past the teeth (proud by a constant offset)
  // right where they matter most — swallowing every centre tooth and
  // leaving only the ones near the tapered rim visible
  const cavity = new SphereGeometry(1, 16, 8)
  cavity.scale(MOUTH_HALF_W, MOUTH_HALF_H, 0.0012)
  detailParts.push(tint(at(cavity, 0, mouthRef.y, mouthRef.z + 0.0016), MOUTH_DARK))

  // the cavity is an ELLIPSOID, so it narrows fast away from its
  // vertical centre — teeth need to sit close to that centre line and
  // well inside the cavity's width, or the outer ones land outside it
  // against bare fur and vanish. TOP_Y is kept at the same fraction of
  // MOUTH_HALF_H that the original two-row version proved visible at.
  const tooth = (x: number, y: number, z: number, pointsDown: boolean): BufferGeometry => {
    const g = new ConeGeometry(0.0026, 0.0075, 6)
    if (pointsDown) g.rotateX(Math.PI) // top-row tooth: apex hangs down from the gum
    g.translate(x, y, z)
    return g
  }
  const ROW_SPREAD = MOUTH_HALF_W * 1.3
  const TOP_Y = MOUTH_HALF_H * 0.4
  const TOP_N = 9
  for (let i = 0; i < TOP_N; i++) {
    const u = i / (TOP_N - 1) - 0.5 // -0.5 .. 0.5
    detailParts.push(
      tint(tooth(u * ROW_SPREAD, mouthRef.y + TOP_Y, mouthRef.z + 0.0075, true), TOOTH),
    )
  }
  const BOTTOM_Y = MOUTH_HALF_H * 0.55
  const BOTTOM_N = 9
  for (let i = 0; i < BOTTOM_N; i++) {
    const u = i / (BOTTOM_N - 1) - 0.5
    detailParts.push(
      tint(tooth(u * ROW_SPREAD * 0.85, mouthRef.y - BOTTOM_Y, mouthRef.z + 0.0045, false), TOOTH),
    )
  }
  // REVIEW FIX: the old second "eye highlight" fleck (a bare white
  // sphere sitting proud near each eye) used to hide mostly behind the
  // eyeball; once the eyes moved up to open room for the nose, it read
  // as a stray white fang floating on the cheek instead. The eyes
  // already carry their own painted gradient + clearcoat specular, so
  // it's cut rather than re-tuned.
  const face = mergeParts(detailParts, true)

  return { fur, eyes, face }
}

/** What the tooltip says for this many clicks and this ledger. */
function labubuLabel(clicks: number, found: readonly string[]): string {
  if (clicks < DUCK_GOLDEN_AT) return 'labubu, my debugging buddy'
  const left = LEDGER.filter((e) => !found.includes(e.id))
  if (!left.length) return 'golden labubu · nothing left to find'
  return `golden labubu · ${left[clicks % left.length].riddle}`
}

/** A soft radial-gradient disc — the tiny contact shadow that keeps
    labubu from reading as if it's floating over the CRT. */
function buildContactShadowTex(): CanvasTexture {
  const S = 48
  const ctx = makeCanvas(S, S)
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(8,8,10,0.4)')
  g.addColorStop(0.7, 'rgba(8,8,10,0.16)')
  g.addColorStop(1, 'rgba(8,8,10,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  return finish(ctx, false)
}

export default function Labubu() {
  const view = useSystem((s) => s.view)
  // clickDuck/duckClicks: see the header comment — persisted names, kept.
  const clickDuck = useEggs((s) => s.clickDuck)
  const clicks = useEggs((s) => s.duckClicks)
  const found = useWorld((s) => s.found)
  const golden = clicks >= DUCK_GOLDEN_AT
  const label = labubuLabel(clicks, found)

  const rig = useRef<Group>(null!)
  const spin = useRef({ x: 0, v: 0, target: 0 })
  const squash = useRef({ s: 0, v: 0 })
  const sparkle = useRef<MeshStandardMaterial>(null!)

  const geo = useMemo(() => buildLabubu(), [])
  const fabric = useMemo(() => fabricSet(BODY, 24, 0.02, 128, 4), [])
  const shadowGeo = useMemo(() => new CircleGeometry(0.044, 24), [])
  const shadowTex = useMemo(() => buildContactShadowTex(), [])
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose())
      fabric.dispose()
      shadowGeo.dispose()
      shadowTex.dispose()
    },
    [geo, fabric, shadowGeo, shadowTex],
  )

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime

    // underdamped yaw spring — overshoots, wobbles, settles (ported as-is)
    const sp = spin.current
    sp.v += (42 * (sp.target - sp.x) - 5.5 * sp.v) * dt
    sp.x += sp.v * dt

    // squash-and-stretch spring
    const sq = squash.current
    sq.v += (-90 * sq.s - 7 * sq.v) * dt
    sq.s += sq.v * dt

    const g = rig.current
    g.rotation.y = -0.4 + sp.x
    g.rotation.z = Math.sin(t * 1.1) * 0.018 // gentle idle sway
    const sy = 1 + sq.s
    const sxz = 1 - sq.s * 0.55
    g.scale.set(sxz, sy, sxz)
    g.position.y = Math.min(0.028, Math.abs(sp.v) * 0.0035) // hop while spinning fast

    // a faint sparkle on the golden variant
    if (golden && sparkle.current) {
      sparkle.current.emissiveIntensity = 0.12 + Math.sin(t * 2.4) * 0.06
    }
  })

  return (
    <group position={[-0.11, DESK_TOP + 0.46, -0.69]}>
      <Clickable
        enabled={view === 'room'}
        label={label}
        onActivate={() => {
          const n = clicks + 1
          // the 10th click earns a triple victory spin and a promotion
          spin.current.target += n === DUCK_GOLDEN_AT ? Math.PI * 6 : Math.PI * 2
          squash.current.v = -1.8
          playLabubuGiggle()
          clickDuck() // the world counts it (and marks duck10 at 10)
          // the label changes under the cursor; Clickable releases the
          // old tag on re-render, so hand it the new riddle right away
          useRoom.getState().setTooltip(labubuLabel(n, useWorld.getState().found))
        }}
      >
        <group ref={rig} rotation-y={-0.4}>
          {/* fur shell: bubblegum pink + fine woven-fuzz maps, or solid gold
              once ascended. A fresh key on toggle avoids reusing a material
              that compiled without a map (see ARCHITECTURE.md's shelf-books
              gotcha) — the two variants are different materials entirely. */}
          <mesh geometry={geo.fur} castShadow>
            {golden ? (
              <meshStandardMaterial
                key="gold"
                ref={sparkle}
                color={GOLD}
                metalness={0.9}
                roughness={0.3}
                emissive={GOLD}
                emissiveIntensity={0.12}
              />
            ) : (
              <meshStandardMaterial
                key="fur"
                vertexColors
                map={fabric.map}
                normalMap={fabric.normalMap}
                normalScale={[0.4, 0.4]}
                roughnessMap={fabric.roughnessMap}
                roughness={1}
              />
            )}
          </mesh>
          {/* eyes: glittery orange-to-red gradient glass, gold or not */}
          <mesh geometry={geo.eyes}>
            <meshPhysicalMaterial
              vertexColors
              roughness={0.06}
              clearcoat={1}
              clearcoatRoughness={0.04}
            />
          </mesh>
          {/* nose + teeth: always in place, gold or not */}
          <mesh geometry={geo.face}>
            <meshPhysicalMaterial
              vertexColors
              roughness={0.15}
              clearcoat={0.8}
              clearcoatRoughness={0.1}
            />
          </mesh>
        </group>
      </Clickable>
      {/* a tiny contact shadow — nothing on this desk gets to float */}
      <mesh geometry={shadowGeo} position={[0, 0.0006, 0.01]} rotation-x={-Math.PI / 2}>
        <meshBasicMaterial map={shadowTex} transparent depthWrite={false} />
      </mesh>
    </group>
  )
}
