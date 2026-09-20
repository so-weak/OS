import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { useSystem } from '../os/store'
import { DUCK_GOLDEN_AT, useEggs } from '../os/eggs'
import { playBeep } from '../os/sound'
import { LEDGER, useWorld } from '../world'
import Clickable from './Clickable'
import { useRoom } from './roomState'
import { DESK_TOP, P } from './layout'
import { rb } from './rbox'

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
          spin.current.target += n === DUCK_GOLDEN_AT ? Math.PI * 6 : Math.PI * 2
          squash.current.v = -1.8
          playBeep()
          clickDuck() // the world counts it (and marks duck10 at 10)
          // the label changes under the cursor; Clickable releases the
          // old tag on re-render, so hand it the new riddle right away
          useRoom.getState().setTooltip(duckLabel(n, useWorld.getState().found))
        }}
      >
        <group ref={rig} rotation-y={-0.5}>
          {/* body */}
          <mesh position={[0, 0.026, 0]} scale={[1, 0.82, 1.15]} castShadow>
            <sphereGeometry args={[0.03, 16, 12]} />
            <meshStandardMaterial color={body} roughness={0.5} />
          </mesh>
          {/* tail flick */}
          <mesh
            position={[0, 0.042, -0.032]}
            rotation-x={-0.85}
            scale={[0.65, 1, 0.75]}
          >
            <sphereGeometry args={[0.013, 10, 8]} />
            <meshStandardMaterial color={body} roughness={0.5} />
          </mesh>
          {/* wings */}
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              position={[s * 0.026, 0.028, -0.002]}
              scale={[0.35, 0.62, 1]}
            >
              <sphereGeometry args={[0.0135, 10, 8]} />
              <meshStandardMaterial color={bodyDark} roughness={0.55} />
            </mesh>
          ))}
          {/* head */}
          <mesh position={[0, 0.062, 0.014]} castShadow>
            <sphereGeometry args={[0.02, 16, 12]} />
            <meshStandardMaterial color={body} roughness={0.5} />
          </mesh>
          {/* beak */}
          <mesh position={[0, 0.057, 0.036]}>
            <roundedBoxGeometry args={rb(0.017, 0.007, 0.014)} />
            <meshStandardMaterial color={P.amber} roughness={0.45} />
          </mesh>
          {/* eyes */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.009, 0.068, 0.028]}>
              <sphereGeometry args={[0.0027, 8, 6]} />
              <meshStandardMaterial color={P.ink} roughness={0.3} />
            </mesh>
          ))}
        </group>
      </Clickable>
    </group>
  )
}
