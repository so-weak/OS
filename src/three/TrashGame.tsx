import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  DoubleSide,
  IcosahedronGeometry,
  MathUtils,
  Vector3,
  type BufferAttribute,
  type Group,
  type PointsMaterial,
} from 'three'
import { useSystem } from '../os/store'
import { playBeep, playClick } from '../os/sound'
import { useWorld } from '../world'
import Clickable from './Clickable'
import { DESK_TOP, P } from './layout'
import { makeScoreboard, makeSoftCircle } from './textures'

/* =====================================================================
   Wastepaper basketball. Three crumpled spec sheets sit on the desk;
   clicking one lobs it at the bin in a slow arc. ~4 in 5 sink, the rest
   clang off the rim and roll onto the floor. A little scoreboard on the
   bin keeps the tally, and three sinks in a row make the bin dance and
   throw amber sparks. Balls respawn on the desk after a beat.

   All mutable game state lives in a ref and is stepped by module-level
   functions from useFrame; React state only mirrors the scoreboard.
   ===================================================================== */

const BIN = new Vector3(-1.05, 0, -0.2)
const BIN_H = 0.27
const BIN_R = 0.105
const SPOTS: [number, number, number][] = [
  [-0.31, DESK_TOP + 0.015, -0.45],
  [-0.22, DESK_TOP + 0.015, -0.55],
  [-0.4, DESK_TOP + 0.015, -0.56],
]

const SPARKS = 18

type Phase = 'idle' | 'fly' | 'sink' | 'miss' | 'rest' | 'gone'

interface Ball {
  phase: Phase
  t: number
  dur: number
  from: Vector3
  ctrl: Vector3
  to: Vector3
  sink: boolean
  spinX: number
  spinZ: number
  scale: number
}

interface Game {
  balls: Ball[]
  stats: { sunk: number; missed: number; streak: number }
  dance: number
  sparkLife: number
  sparkVel: Float32Array
  timeouts: number[]
}

function newBall(spot: [number, number, number]): Ball {
  return {
    phase: 'idle',
    t: 0,
    dur: 1,
    from: new Vector3(...spot),
    ctrl: new Vector3(),
    to: new Vector3(),
    sink: false,
    spinX: 0,
    spinZ: 0,
    scale: 1,
  }
}

function newGame(): Game {
  return {
    balls: SPOTS.map(newBall),
    stats: { sunk: 0, missed: 0, streak: 0 },
    dance: 0,
    sparkLife: 0,
    sparkVel: new Float32Array(SPARKS * 3),
    timeouts: [],
  }
}

/** Deterministically crumple an icosahedron (StrictMode-stable). */
function crumple(seed: number): IcosahedronGeometry {
  const geo = new IcosahedronGeometry(0.017, 1)
  const pos = geo.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const n = Math.sin(i * 91.7 + seed * 47.9) * 0.5 + 0.5
    const s = 0.8 + n * 0.38
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s, pos.getZ(i) * s)
  }
  geo.computeVertexNormals()
  return geo
}

function quadBezier(
  a: Vector3,
  c: Vector3,
  b: Vector3,
  t: number,
  out: Vector3,
): void {
  const u = 1 - t
  out.set(
    u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  )
}

/** Click handler: launch ball `i` toward the bin (no-op mid-flight). */
function tossBall(game: Game, i: number): void {
  const b = game.balls[i]
  if (b.phase !== 'idle') return
  playClick()
  b.sink = Math.random() < 0.8
  b.phase = 'fly'
  b.t = 0
  b.dur = 0.85
  b.from.set(...SPOTS[i])
  const err = b.sink ? 0.015 : BIN_R + 0.015 + Math.random() * 0.03
  const ang = Math.random() * Math.PI * 2
  b.to.set(
    BIN.x + Math.cos(ang) * err,
    BIN_H + 0.03,
    BIN.z + Math.sin(ang) * err,
  )
  b.ctrl.copy(b.from).add(b.to).multiplyScalar(0.5)
  b.ctrl.y = Math.max(b.from.y, BIN_H) + 0.42
  b.spinX = 6 + Math.random() * 5
  b.spinZ = 3 + Math.random() * 4
}

/** Three in a row: arm the bin dance, the sparks and a beep fanfare. */
function celebrate(game: Game, sparkAttr: BufferAttribute): void {
  useWorld.getState().mark('streak3')
  game.dance = 1
  game.sparkLife = 1
  for (let i = 0; i < SPARKS; i++) {
    const a = (i / SPARKS) * Math.PI * 2
    const r = 0.24 + Math.random() * 0.22
    game.sparkVel[i * 3] = Math.cos(a) * r
    game.sparkVel[i * 3 + 1] = 0.55 + Math.random() * 0.5
    game.sparkVel[i * 3 + 2] = Math.sin(a) * r
    sparkAttr.setXYZ(i, 0, 0, 0)
  }
  sparkAttr.needsUpdate = true
  playBeep()
  game.timeouts.push(
    window.setTimeout(playBeep, 140),
    window.setTimeout(playBeep, 300),
  )
}

/** Advance one ball; returns true when the scoreboard changed. */
function stepBall(
  game: Game,
  i: number,
  m: Group,
  dt: number,
  sparkAttr: BufferAttribute,
): boolean {
  const b = game.balls[i]
  switch (b.phase) {
    case 'idle': {
      b.scale = MathUtils.damp(b.scale, 1, 10, dt)
      m.scale.setScalar(Math.max(0.001, b.scale))
      return false
    }
    case 'fly': {
      b.t += dt
      const p = Math.min(b.t / b.dur, 1)
      quadBezier(b.from, b.ctrl, b.to, p, m.position)
      m.rotation.x += b.spinX * dt
      m.rotation.z += b.spinZ * dt
      if (p < 1) return false
      b.t = 0
      if (b.sink) {
        b.phase = 'sink'
        game.stats.sunk++
        game.stats.streak++
        if (game.stats.streak % 3 === 0) celebrate(game, sparkAttr)
      } else {
        // clang off the rim: short bounce arc onto the floor
        b.phase = 'miss'
        b.dur = 0.55
        b.from.copy(m.position)
        const dx = m.position.x - BIN.x
        const dz = m.position.z - BIN.z
        const len = Math.max(Math.hypot(dx, dz), 1e-4)
        b.to.set(
          BIN.x + (dx / len) * (BIN_R + 0.22),
          0.014,
          BIN.z + (dz / len) * (BIN_R + 0.26),
        )
        b.ctrl.copy(b.from).add(b.to).multiplyScalar(0.5)
        b.ctrl.y = b.from.y + 0.09
        game.stats.missed++
        game.stats.streak = 0
      }
      return true
    }
    case 'sink': {
      b.t += dt
      const p = Math.min(b.t / 0.35, 1)
      m.position.x = MathUtils.damp(m.position.x, BIN.x, 12, dt)
      m.position.z = MathUtils.damp(m.position.z, BIN.z, 12, dt)
      m.position.y = MathUtils.lerp(BIN_H + 0.03, 0.06, p * p)
      if (p >= 1) {
        b.phase = 'gone'
        b.t = 0
        b.dur = 1.5 // respawn delay
        b.scale = 0
        m.scale.setScalar(0.001)
      }
      return false
    }
    case 'miss': {
      b.t += dt
      const p = Math.min(b.t / b.dur, 1)
      quadBezier(b.from, b.ctrl, b.to, p, m.position)
      m.rotation.x += b.spinX * 0.6 * dt
      if (p >= 1) {
        b.phase = 'rest'
        b.t = 0
      }
      return false
    }
    case 'rest': {
      b.t += dt
      // a moment of shame on the floor, then it dissolves
      if (b.t > 1.3) {
        b.scale = MathUtils.damp(b.scale, 0, 9, dt)
        m.scale.setScalar(Math.max(0.001, b.scale))
        if (b.scale < 0.02) {
          b.phase = 'gone'
          b.t = 0
          b.dur = 0.7
        }
      }
      return false
    }
    case 'gone': {
      b.t += dt
      if (b.t >= b.dur) {
        b.phase = 'idle'
        b.t = 0
        b.scale = 0
        m.position.set(...SPOTS[i])
        m.rotation.set(0, 0, 0)
      }
      return false
    }
  }
}

/** Per-frame world step; returns true when the scoreboard changed. */
function stepGame(
  game: Game,
  dt: number,
  t: number,
  meshes: (Group | null)[],
  binRig: Group | null,
  sparkAttr: BufferAttribute | null,
  sparkMat: PointsMaterial | null,
): boolean {
  if (!binRig || !sparkAttr || !sparkMat) return false
  let changed = false
  game.balls.forEach((_, i) => {
    const m = meshes[i]
    if (m && stepBall(game, i, m, dt, sparkAttr)) changed = true
  })

  // celebration: the bin does a happy hop
  if (game.dance > 0.001) {
    game.dance = MathUtils.damp(game.dance, 0, 1.6, dt)
    binRig.position.y = Math.abs(Math.sin(t * 9)) * 0.045 * game.dance
    binRig.rotation.z = Math.sin(t * 9) * 0.09 * game.dance
  } else if (binRig.position.y !== 0) {
    binRig.position.y = 0
    binRig.rotation.z = 0
  }

  // sparks
  if (game.sparkLife > 0) {
    game.sparkLife = Math.max(0, game.sparkLife - dt / 0.9)
    const vel = game.sparkVel
    for (let i = 0; i < SPARKS; i++) {
      vel[i * 3 + 1] -= 1.6 * dt // gravity
      sparkAttr.setXYZ(
        i,
        sparkAttr.getX(i) + vel[i * 3] * dt,
        sparkAttr.getY(i) + vel[i * 3 + 1] * dt,
        sparkAttr.getZ(i) + vel[i * 3 + 2] * dt,
      )
    }
    sparkAttr.needsUpdate = true
    sparkMat.opacity = game.sparkLife
  } else if (sparkMat.opacity !== 0) {
    sparkMat.opacity = 0
  }
  return changed
}

export default function TrashGame() {
  const view = useSystem((s) => s.view)
  const [score, setScore] = useState({ sunk: 0, missed: 0, streak: 0 })

  const game = useRef<Game | null>(null)
  const meshes = useRef<(Group | null)[]>(SPOTS.map(() => null))
  const binRig = useRef<Group>(null)
  const sparkAttr = useRef<BufferAttribute>(null)
  const sparkMat = useRef<PointsMaterial>(null)

  const geos = useMemo(() => [crumple(1), crumple(2), crumple(3)], [])
  const sparkTex = useMemo(() => makeSoftCircle(), [])
  const sparkInit = useMemo(() => new Float32Array(SPARKS * 3), [])

  const boardTex = useMemo(
    () => makeScoreboard(score.sunk, score.missed, score.streak),
    [score],
  )
  useEffect(() => () => boardTex.dispose(), [boardTex])
  useEffect(
    () => () => {
      geos.forEach((g) => g.dispose())
      sparkTex.dispose()
    },
    [geos, sparkTex],
  )
  useEffect(() => {
    return () => {
      game.current?.timeouts.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  useFrame((state, delta) => {
    if (!game.current) game.current = newGame()
    const changed = stepGame(
      game.current,
      Math.min(delta, 0.05),
      state.clock.elapsedTime,
      meshes.current,
      binRig.current,
      sparkAttr.current,
      sparkMat.current,
    )
    if (changed) setScore({ ...game.current.stats })
  })

  return (
    <group>
      {/* the bin */}
      <group ref={binRig} position={BIN}>
        <Clickable
          enabled={view === 'room'}
          label="regulation height"
          onActivate={() => {
            if (game.current) game.current.dance = Math.max(game.current.dance, 0.45)
            playClick()
          }}
        >
          <mesh position={[0, BIN_H / 2 + 0.004, 0]} castShadow>
            <cylinderGeometry args={[BIN_R, 0.082, BIN_H, 14, 1, true]} />
            <meshStandardMaterial
              color="#2e3238"
              metalness={0.55}
              roughness={0.5}
              side={DoubleSide}
            />
          </mesh>
          <mesh position={[0, 0.005, 0]} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[0.082, 14]} />
            <meshStandardMaterial color="#1b1e22" roughness={0.8} />
          </mesh>
          <mesh position={[0, BIN_H + 0.004, 0]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[BIN_R, 0.005, 8, 18]} />
            <meshStandardMaterial
              color="#41464e"
              metalness={0.6}
              roughness={0.4}
            />
          </mesh>
          {/* pressed ridges */}
          {[0.09, 0.18].map((y) => (
            <mesh key={y} position={[0, y, 0]} rotation-x={Math.PI / 2}>
              <torusGeometry
                args={[0.082 + (y / BIN_H) * (BIN_R - 0.082), 0.0022, 6, 18]}
              />
              <meshStandardMaterial
                color="#23262b"
                metalness={0.5}
                roughness={0.55}
              />
            </mesh>
          ))}
          {/* scoreboard riveted to the front (tilted to hug the taper) */}
          <mesh position={[0.002, 0.165, 0.0975]} rotation-x={0.085}>
            <planeGeometry args={[0.105, 0.059]} />
            <meshBasicMaterial map={boardTex} toneMapped={false} />
          </mesh>
        </Clickable>
      </group>

      {/* crumpled balls on the desk */}
      {SPOTS.map((s, i) => (
        <Clickable
          key={i}
          enabled={view === 'room'}
          label="toss it"
          onActivate={() => {
            if (game.current) tossBall(game.current, i)
          }}
        >
          <group
            ref={(el) => {
              meshes.current[i] = el
            }}
            position={s}
          >
            <mesh geometry={geos[i]} castShadow>
              <meshStandardMaterial color="#e6e2d4" roughness={0.95} />
            </mesh>
          </group>
        </Clickable>
      ))}

      {/* celebration sparks */}
      <points position={[BIN.x, BIN_H + 0.04, BIN.z]} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            ref={sparkAttr}
            attach="attributes-position"
            args={[sparkInit, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          ref={sparkMat}
          map={sparkTex}
          color={P.amber}
          size={0.028}
          sizeAttenuation
          transparent
          opacity={0}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </points>
    </group>
  )
}
