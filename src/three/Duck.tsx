import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  CatmullRomCurve3,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Group,
} from 'three'
import { useSystem } from '../os/store'
import { DUCK_GOLDEN_AT, useEggs } from '../os/eggs'
import { playBeep } from '../os/sound'
import { LEDGER, useWorld } from '../world'
import Clickable from './Clickable'
import { useRoom } from './roomState'
import { DESK_TOP, P } from './layout'
import {
  at,
  deform,
  mergeParts,
  slab,
  smoothstep,
  sweep,
} from './tex/furniture'

/* =====================================================================
   The debugging duck, perched on top of the CRT. Clicking it squashes,
   hops and spins it on an underdamped spring (so it wobbles as it
   settles) and reports the click to the shared easter-egg store.

   The click count lives in the world, so the duck keeps its colour
   across visits — and once golden it starts whispering: its tooltip
   carries one riddle from the ledger for something not yet found, and
   every click turns the page.
   ===================================================================== */

const BODY = '#f6c832'
const BODY_DARK = '#dca81f'
/** after DUCK_GOLDEN_AT debugging sessions the duck ascends */
const GOLD = '#ffe066'
const GOLD_DARK = '#e6b93c'

/* ---------- the duck, modelled as one moulded vinyl shell ---------- */

/** body + neck + head as ONE swept shell: a spine that runs tail → chest →
    neck → crown, with an elliptical section that swells and pinches. Duck
    faces +z, sits on y = 0. */
const SPINE: [number, number, number][] = [
  [0, 0.044, -0.041],
  [0, 0.034, -0.03],
  [0, 0.0265, -0.014],
  [0, 0.0255, 0.006],
  [0, 0.03, 0.022],
  [0, 0.046, 0.026],
  [0, 0.062, 0.018],
  [0, 0.0815, 0.0145],
]
/** [t, in-plane half-thickness, lateral half-width] */
const KEYS: [number, number, number][] = [
  [0, 0.0012, 0.0012],
  [0.143, 0.0085, 0.0105],
  [0.286, 0.0215, 0.0265],
  [0.429, 0.0252, 0.0292],
  [0.571, 0.0225, 0.0262],
  [0.714, 0.0128, 0.0138],
  [0.857, 0.0196, 0.0188],
]
function section(t: number): [number, number] {
  const last = KEYS[KEYS.length - 1]
  if (t >= last[0]) {
    // hemispherical crown
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

interface DuckGeo {
  body: BufferGeometry
  wings: BufferGeometry
  beak: BufferGeometry
  eyes: BufferGeometry
}

function buildDuck(): DuckGeo {
  const path = new CatmullRomCurve3(
    SPINE.map((p) => new Vector3(...p)),
    false,
    'centripetal',
  ).getPoints(48)
  const body = sweep({
    path,
    radial: 20,
    size: section,
    ref: new Vector3(1, 0, 0),
    vTile: 0.03,
  })
  // a flat-ish underside so it sits instead of rocking
  deform(body, (p) => {
    if (p.y < 0.0038) p.y = 0.0038 - (0.0038 - p.y) * 0.25
  })

  // wings: flattened leaf shapes swept back and up
  const wingParts: BufferGeometry[] = []
  for (const s of [-1, 1]) {
    const w = new SphereGeometry(0.0135, 10, 8)
    w.scale(0.34, 0.6, 1.15)
    deform(w, (p) => {
      p.y += 0.006 * smoothstep(0, -0.014, p.z)
      p.x *= 1 - 0.3 * smoothstep(-0.005, -0.016, p.z)
    })
    wingParts.push(at(w, s * 0.0275, 0.0285, -0.004))
  }

  // bill: a soft flat slab, tapered and lifted at the tip
  const bill = slab({
    hx: 0.0088,
    hz: 0.0095,
    h: 0.0046,
    rc: 0.0045,
    rt: 0.0022,
    rbot: 0.002,
    tile: 0.03,
    rings: 1,
    bottomRings: 1,
    arc: 3,
    straight: 1,
    bevel: 2,
  })
  deform(bill, (p) => {
    const f = smoothstep(-0.002, 0.0095, p.z)
    p.x *= 1 - 0.32 * f
    p.y += 0.0022 * f * f
  })
  at(bill, 0, 0.0533, 0.0355)

  const eyeParts: BufferGeometry[] = []
  for (const s of [-1, 1]) {
    eyeParts.push(
      at(new SphereGeometry(0.0028, 8, 6), s * 0.0088, 0.0688, 0.0336),
    )
  }
  return {
    body,
    wings: mergeParts(wingParts),
    beak: bill,
    eyes: mergeParts(eyeParts),
  }
}

/** What the tooltip says for this many clicks and this ledger. */
function duckLabel(clicks: number, found: readonly string[]): string {
  if (clicks < DUCK_GOLDEN_AT) return 'rubber duck debugger'
  const left = LEDGER.filter((e) => !found.includes(e.id))
  if (!left.length) return 'the golden debugger · nothing left to find'
  return `the golden debugger · ${left[clicks % left.length].riddle}`
}

export default function Duck() {
  const view = useSystem((s) => s.view)
  const clickDuck = useEggs((s) => s.clickDuck)
  const clicks = useEggs((s) => s.duckClicks)
  const found = useWorld((s) => s.found)
  const golden = clicks >= DUCK_GOLDEN_AT
  const body = golden ? GOLD : BODY
  const bodyDark = golden ? GOLD_DARK : BODY_DARK
  const label = duckLabel(clicks, found)

  const rig = useRef<Group>(null!)
  const spin = useRef({ x: 0, v: 0, target: 0 })
  const squash = useRef({ s: 0, v: 0 })
  const geo = useMemo(() => buildDuck(), [])
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose())
    },
    [geo],
  )

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime

    // underdamped yaw spring — overshoots, wobbles, settles
    const sp = spin.current
    sp.v += (42 * (sp.target - sp.x) - 5.5 * sp.v) * dt
    sp.x += sp.v * dt

    // squash-and-stretch spring
    const sq = squash.current
    sq.v += (-90 * sq.s - 7 * sq.v) * dt
    sq.s += sq.v * dt

    const g = rig.current
    g.rotation.y = -0.5 + sp.x
    g.rotation.z = Math.sin(t * 1.3) * 0.02 // idle sway
    const sy = 1 + sq.s
    const sxz = 1 - sq.s * 0.55
    g.scale.set(sxz, sy, sxz)
    // hop while spinning fast
    g.position.y = Math.min(0.03, Math.abs(sp.v) * 0.004)
  })

  return (
    <group position={[-0.11, DESK_TOP + 0.46, -0.69]}>
      <Clickable
        enabled={view === 'room'}
        label={label}
        onActivate={() => {
          const n = clicks + 1
          // the 10th click earns a triple victory spin and a promotion
          spin.current.target +=
            n === DUCK_GOLDEN_AT ? Math.PI * 6 : Math.PI * 2
          squash.current.v = -1.8
          playBeep()
          clickDuck() // the world counts it (and marks duck10 at 10)
          // the label changes under the cursor; Clickable releases the
          // old tag on re-render, so hand it the new riddle right away
          useRoom.getState().setTooltip(duckLabel(n, useWorld.getState().found))
        }}
      >
        <group ref={rig} rotation-y={-0.5}>
          {/* body, neck and head: one glossy vinyl shell */}
          <mesh geometry={geo.body} castShadow>
            <meshPhysicalMaterial
              color={body}
              roughness={0.3}
              clearcoat={0.7}
              clearcoatRoughness={0.18}
            />
          </mesh>
          {/* embossed wings, a shade deeper */}
          <mesh geometry={geo.wings}>
            <meshPhysicalMaterial
              color={bodyDark}
              roughness={0.34}
              clearcoat={0.6}
              clearcoatRoughness={0.2}
            />
          </mesh>
          {/* bill */}
          <mesh geometry={geo.beak}>
            <meshPhysicalMaterial
              color={P.amber}
              roughness={0.32}
              clearcoat={0.6}
              clearcoatRoughness={0.2}
            />
          </mesh>
          {/* glossy bead eyes */}
          <mesh geometry={geo.eyes}>
            <meshPhysicalMaterial
              color={P.ink}
              roughness={0.06}
              clearcoat={1}
              clearcoatRoughness={0.03}
            />
          </mesh>
        </group>
      </Clickable>
    </group>
  )
}
