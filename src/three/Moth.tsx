import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  MathUtils,
  Vector3,
  type Group,
  type Sprite,
  type SpriteMaterial,
} from 'three'
import { useSystem } from '../os/store'
import { reducedMotion, useWorld } from '../world'
import Clickable from './Clickable'
import { live } from './live'
import { makeSoftCircle } from './textures'

/* =====================================================================
   The moth — the one thing that only happens when nobody is watching.
   A single soft sprite on a jittered Lissajous around the lamp head,
   fading in over ~2 s once the world says idle (night, lamp on), gone
   within 2 s of any input. Click it and it darts off; it comes back
   the next time you stop moving. No timers of its own: idle is the
   world's, the fade is a damp in useFrame.
   ===================================================================== */

/* lamp head in world space: Lamp.tsx group (-0.55, DESK_TOP, -0.78)
   rotated -0.4 about y, HEAD (0.305, 0.205, 0) → about here */
const HEAD = new Vector3(-0.27, 0.95, -0.66)
const DART = new Vector3(0.22, 0.34, 0.26)

export default function Moth() {
  const view = useSystem((s) => s.view)
  const [shown, setShown] = useState(false)
  const grp = useRef<Group>(null!)
  const sprite = useRef<Sprite>(null!)
  const mat = useRef<SpriteMaterial>(null!)
  const tex = useMemo(() => makeSoftCircle(), [])
  useEffect(() => () => tex.dispose(), [tex])
  const still = useMemo(() => reducedMotion(), [])

  const stRef = useRef({ level: 0, dart: -1, phase: -1, shown: false })

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const st = stRef.current
    // seed the flight path from the clock, so two tabs never share a moth
    if (st.phase < 0) st.phase = (state.clock.elapsedTime * 7.31) % 20
    const world = useWorld.getState()
    const darting = st.dart >= 0
    const want =
      !still && !darting && world.idle && live.day < 0.2 && live.lamp > 0.5
    // in over ~2 s, out within 2 s
    st.level = MathUtils.damp(st.level, want ? 1 : 0, want ? 2 : 4, dt)

    const vis = st.level > 0.02
    if (vis !== st.shown) {
      st.shown = vis
      grp.current.visible = vis
      setShown(vis)
    }
    if (!vis) return

    const t = state.clock.elapsedTime + st.phase
    const p = grp.current.position
    // a loose figure around the shade, plus the nervous high-frequency jitter
    p.set(
      HEAD.x + 0.085 * Math.sin(t * 1.3) + 0.006 * Math.sin(t * 23),
      HEAD.y + 0.045 * Math.sin(t * 2.1 + 1.0) + 0.05 + 0.005 * Math.sin(t * 31),
      HEAD.z + 0.08 * Math.sin(t * 1.7 + 2.0) + 0.006 * Math.cos(t * 27),
    )
    if (darting) {
      st.dart += dt
      const k = 1 - Math.exp(-st.dart * 3)
      p.addScaledVector(DART, k)
      if (st.dart > 3) st.dart = -1
    }
    // wingbeat: the sprite squashes sideways ~19 times a second
    const beat = 0.55 + 0.45 * Math.abs(Math.sin(t * 60))
    sprite.current.scale.set(0.03 * beat, 0.021, 1)
    mat.current.opacity = st.level * (0.75 + 0.25 * beat)
  })

  return (
    <group ref={grp} visible={false}>
      <Clickable
        enabled={shown && view === 'room'}
        label="it flutters off. it comes back."
        onActivate={() => {
          useWorld.getState().mark('moth')
          stRef.current.dart = 0
        }}
      >
        <sprite ref={sprite} scale={[0.03, 0.021, 1]}>
          <spriteMaterial
            ref={mat}
            map={tex}
            color="#ffe2b0"
            transparent
            opacity={0}
            depthWrite={false}
          />
        </sprite>
        {/* invisible hit pad — a moth is a very small click target */}
        <mesh>
          <sphereGeometry args={[0.045, 8, 6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </Clickable>
    </group>
  )
}
