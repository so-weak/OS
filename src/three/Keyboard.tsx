import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  MathUtils,
  MeshStandardMaterial,
  Object3D,
  type Mesh,
} from 'three'
import { useSystem } from '../os/store'
import { playBeep, playClick } from '../os/sound'
import { useRoom } from './roomState'
import { DESK_TOP, P } from './layout'

/* =====================================================================
   Beige mechanical keyboard. Every keycap is a hinted instance — one
   draw call for ~60 keys, each with its own footprint, colour and a
   hair of hand-placed wonk so the board reads as used, not minted.

   It is ALIVE: while you are in room view, real keystrokes depress the
   matching 3D keycap with a clack. Typing "hire" makes the sticky note
   on the monitor glow and pops a hint toast. (Easter egg mandate.)
   ===================================================================== */

const PITCH = 0.0292
const CAP = 0.025 // keycap footprint
const CAP_H = 0.0105
const BOARD_W = 0.45
const BOARD_D = 0.164
const TRAVEL = 0.0048 // key press depth

interface KeySpec {
  x: number
  z: number
  w: number // width in key units
  mod: boolean // modifier keys get the darker two-tone cap
  code: string | null // KeyboardEvent.code that presses this cap
}

interface RowKey {
  code: string | null
  w?: number
  mod?: boolean
}

/* physical rows with real key codes so live typing lands correctly */
const ROWS: RowKey[][] = [
  [
    { code: 'Escape', mod: true },
    ...['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].map(
      (code) => ({ code }),
    ),
  ],
  [
    { code: 'Backquote' },
    ...['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'].map(
      (code) => ({ code }),
    ),
    { code: 'Minus' },
    { code: 'Backspace', w: 1.6, mod: true },
  ],
  [
    { code: 'Tab', w: 1.4, mod: true },
    ...['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'].map(
      (code) => ({ code }),
    ),
    { code: 'BracketLeft' },
  ],
  [
    { code: 'CapsLock', w: 1.7, mod: true },
    ...['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL'].map(
      (code) => ({ code }),
    ),
    { code: 'Semicolon' },
    { code: 'Enter', w: 1.8, mod: true },
  ],
  [
    { code: 'ShiftLeft', w: 2.1, mod: true },
    ...['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM'].map((code) => ({
      code,
    })),
    { code: 'Comma' },
    { code: 'Period' },
    { code: 'ShiftRight', w: 2.0, mod: true },
  ],
]

function planKeys(): KeySpec[] {
  const keys: KeySpec[] = []
  const originZ = -BOARD_D / 2 + 0.022

  ROWS.forEach((row, r) => {
    const totalUnits = row.reduce((a, k) => a + (k.w ?? 1), 0)
    let cursor = -(totalUnits * PITCH) / 2
    row.forEach((k) => {
      const w = k.w ?? 1
      keys.push({
        x: cursor + (w * PITCH) / 2,
        z: originZ + r * PITCH,
        w,
        mod: k.mod ?? false,
        code: k.code,
      })
      cursor += w * PITCH
    })
  })

  // bottom row: ctrl / alt — space — alt / ctrl (space is its own mesh)
  const zB = originZ + 5 * PITCH
  const bottom: [number, string][] = [
    [-0.185, 'ControlLeft'],
    [-0.152, 'AltLeft'],
    [0.152, 'AltRight'],
    [0.185, 'ControlRight'],
  ]
  bottom.forEach(([x, code]) =>
    keys.push({ x, z: zB, w: 1.05, mod: true, code }),
  )
  return keys
}

/* deterministic tiny wobble so StrictMode renders identically */
function wonk(i: number, salt: number): number {
  return (Math.sin(i * 127.1 + salt * 311.7) % 1) * 0.5
}

/** Write a keycap's transform (press = 0..1 travel) into `dummy`. */
function specTransform(
  spec: KeySpec,
  i: number,
  dummy: Object3D,
  press: number,
): void {
  dummy.position.set(
    spec.x + wonk(i, 1) * 0.0006,
    CAP_H / 2 + 0.001 + wonk(i, 2) * 0.0008 - press * TRAVEL,
    spec.z,
  )
  dummy.rotation.set(0, wonk(i, 3) * 0.05, 0)
  dummy.scale.set(CAP * spec.w + (spec.w > 1 ? 0.004 : 0), CAP_H, CAP)
  dummy.updateMatrix()
}

function buildKeys(specs: KeySpec[]): InstancedMesh {
  const geo = new BoxGeometry(1, 1, 1)
  const mat = new MeshStandardMaterial({ roughness: 0.62 })
  const mesh = new InstancedMesh(geo, mat, specs.length)
  const dummy = new Object3D()
  const color = new Color()
  specs.forEach((k, i) => {
    specTransform(k, i, dummy, 0)
    mesh.setMatrixAt(i, dummy.matrix)
    color.set(k.mod ? P.chassisDark : '#e9e5d8')
    // faint per-key patina
    color.offsetHSL(0, 0, wonk(i, 4) * 0.02)
    mesh.setColorAt(i, color)
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = true
  return mesh
}

export default function Keyboard() {
  const powered = useSystem((s) => s.power !== 'off')
  const specs = useMemo(() => planKeys(), [])
  const keys = useMemo(() => buildKeys(specs), [specs])
  /* useFrame mutates the instances through this ref alias */
  const keysRef = useRef<InstancedMesh>(null)
  const codeIndex = useMemo(() => {
    const m = new Map<string, number>()
    specs.forEach((s, i) => {
      if (s.code) m.set(s.code, i)
    })
    return m
  }, [specs])

  useEffect(
    () => () => {
      keys.geometry.dispose()
      ;(keys.material as MeshStandardMaterial).dispose()
    },
    [keys],
  )

  const press = useRef(new Float32Array(specs.length))
  const target = useRef(new Float32Array(specs.length))
  const active = useRef(new Set<number>())
  const space = useRef({ p: 0, t: 0 })
  const spaceMesh = useRef<Mesh>(null!)
  const typed = useRef('')
  const dummy = useMemo(() => new Object3D(), [])

  /* real keystrokes press the 3D caps (room view only) */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (useSystem.getState().view !== 'room') return
      const idx = codeIndex.get(e.code)
      if (idx !== undefined) {
        target.current[idx] = 1
        active.current.add(idx)
      }
      if (e.code === 'Space') space.current.t = 1
      if ((idx !== undefined || e.code === 'Space') && !e.repeat) playClick()
      // rolling buffer — typing "hire" pings the sticky note
      if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
        typed.current = (typed.current + e.key.toLowerCase()).slice(-6)
        if (typed.current.endsWith('hire')) {
          typed.current = ''
          useRoom.getState().pingHire()
          playBeep()
        }
      }
    }
    const up = (e: KeyboardEvent) => {
      const idx = codeIndex.get(e.code)
      if (idx !== undefined) target.current[idx] = 0
      if (e.code === 'Space') space.current.t = 0
    }
    const blur = () => {
      target.current.fill(0)
      space.current.t = 0
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [codeIndex])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const mesh = keysRef.current
    if (!mesh) return
    let dirty = false
    for (const i of active.current) {
      const p = MathUtils.damp(press.current[i], target.current[i], 34, dt)
      press.current[i] = p
      specTransform(specs[i], i, dummy, p)
      mesh.setMatrixAt(i, dummy.matrix)
      dirty = true
      if (target.current[i] === 0 && p < 0.002) {
        press.current[i] = 0
        specTransform(specs[i], i, dummy, 0)
        mesh.setMatrixAt(i, dummy.matrix)
        active.current.delete(i)
      }
    }
    if (dirty) mesh.instanceMatrix.needsUpdate = true

    const sp = space.current
    if (sp.p !== sp.t) {
      sp.p = MathUtils.damp(sp.p, sp.t, 34, dt)
      if (Math.abs(sp.p - sp.t) < 0.002) sp.p = sp.t
      spaceMesh.current.position.y = CAP_H / 2 + 0.001 - sp.p * TRAVEL
    }
  })

  const zSpace = -BOARD_D / 2 + 0.022 + 5 * PITCH

  return (
    <group
      position={[0.12, DESK_TOP + 0.014, -0.44]}
      rotation={[-0.05, 0.05, 0]}
    >
      {/* case */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[BOARD_W, 0.022, BOARD_D]} />
        <meshStandardMaterial color={P.chassis} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.0115, 0]}>
        <boxGeometry args={[BOARD_W - 0.014, 0.002, BOARD_D - 0.014]} />
        <meshStandardMaterial color={P.chassisDark} roughness={0.85} />
      </mesh>

      <group position={[0, 0.0125, 0]}>
        <primitive ref={keysRef} object={keys} />
        {/* spacebar */}
        <mesh
          ref={spaceMesh}
          position={[0, CAP_H / 2 + 0.001, zSpace]}
          castShadow
        >
          <boxGeometry args={[0.148, CAP_H, CAP]} />
          <meshStandardMaterial color="#e9e5d8" roughness={0.62} />
        </mesh>
      </group>

      {/* lock LEDs, lit while the machine runs */}
      {[0.155, 0.175, 0.195].map((x) => (
        <mesh key={x} position={[x, 0.0125, -BOARD_D / 2 + 0.009]}>
          <boxGeometry args={[0.007, 0.002, 0.004]} />
          <meshStandardMaterial
            color="#1c2f14"
            emissive={P.ledGreen}
            emissiveIntensity={powered ? 1.1 : 0}
          />
        </mesh>
      ))}
    </group>
  )
}
