import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  Color,
  MathUtils,
  type BufferAttribute,
  type PointsMaterial,
} from 'three'
import { useSystem } from '../os/store'
import { live } from './live'

/* =====================================================================
   Faint dust motes drifting through the lamplight — pure room
   atmosphere. They fade out entirely while reading the screen so
   nothing floats between the camera and the OS.
   ===================================================================== */

const COUNT = 110
const Y_MIN = 0.1
const Y_RANGE = 2.1

/* moonlit blue by night, sunlit gold by day */
const NIGHT_TINT = new Color('#aebfe0')
const DAY_TINT = new Color('#ffe3b3')

/* tiny deterministic PRNG (StrictMode-stable) */
function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export default function DustMotes() {
  const mat = useRef<PointsMaterial>(null!)
  const attr = useRef<BufferAttribute>(null!)

  const { initial, base, speed, phase } = useMemo(() => {
    const rand = mulberry(1997)
    const base = new Float32Array(COUNT * 3)
    const speed = new Float32Array(COUNT)
    const phase = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      base[i * 3] = -1.5 + rand() * 3.2
      base[i * 3 + 1] = Y_MIN + rand() * Y_RANGE
      base[i * 3 + 2] = -1.0 + rand() * 2.1
      speed[i] = 0.008 + rand() * 0.02
      phase[i] = rand() * Math.PI * 2
    }
    return { initial: base.slice(), base, speed, phase }
  }, [])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const view = useSystem.getState().view
    const inRoom = view === 'room' || view === 'zooming-out'
    const day = live.day
    mat.current.color.copy(NIGHT_TINT).lerp(DAY_TINT, day)
    mat.current.opacity = MathUtils.damp(
      mat.current.opacity,
      inRoom ? 0.3 + day * 0.12 : 0,
      3,
      dt,
    )
    const a = attr.current
    if (!a || mat.current.opacity < 0.01) return

    const t = state.clock.elapsedTime
    for (let i = 0; i < COUNT; i++) {
      const y = base[i * 3 + 1] + t * speed[i]
      a.setXYZ(
        i,
        base[i * 3] + Math.sin(t * 0.22 + phase[i]) * 0.06,
        Y_MIN + ((y - Y_MIN) % Y_RANGE),
        base[i * 3 + 2] + Math.cos(t * 0.17 + phase[i]) * 0.05,
      )
    }
    a.needsUpdate = true
  })

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          ref={attr}
          attach="attributes-position"
          args={[initial, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        ref={mat}
        size={0.0065}
        sizeAttenuation
        color="#aebfe0"
        transparent
        opacity={0.3}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  )
}
