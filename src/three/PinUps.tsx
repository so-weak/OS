import { useEffect, useMemo, useRef, useState } from 'react'
import { useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import {
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  MathUtils,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Vector3,
  type BufferAttribute,
  type CanvasTexture,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type PerspectiveCamera,
  type Ray,
} from 'three'
import { playClick } from '../os/sound'
import { useSystem } from '../os/store'
import { reducedMotion } from '../world'
import { useLibrary } from './libraryState'
import { BOARD, PIN_INSET, PRINTS, pinFlight, pinHover, pinRegistry, usePins, type PrintId } from './pinState'
import { PHOTOS, PrintSet, buildShadowGeo, loadImage, printGeo, type ShadowRect } from './pinParts'
import type { CardSpec } from './tex/room'

/* =====================================================================
   The pin-up board's photographs and the close-up's controls.

   PinPrints  (inside the board)  the four prints, their contact shadows,
              the lift-off / hover animation and the lazy image loading
   PinFocus   (world level)       the dimming scrim behind a held photo,
              the input layer that owns the pointer while the board is
              focused, and the Esc / arrow keys

   While the board is focused a see-through plane sits just in front of the
   lens and takes every pointer event, so no other prop in the frame can
   hover or click; it hit-tests the prints itself. That is also how "a
   click on the empty wall" is told from "a click on the cork".
   ===================================================================== */

/** how far in front of the lens a held photo hangs (metres) */
const HOLD_DIST = 0.42
/** a hovered print hangs from its pin: the bottom swings out this far
    (radians) and the sheet grows a touch, so it reads as lifted */
const HOVER_TILT = 0.12
const HOVER_GROW = 0.035
const UP = new Vector3(0, 0, 1)
const RIGHT = new Vector3(1, 0, 0)

/* ---------------------------------------------------------------------
   The prints
   --------------------------------------------------------------------- */

interface Anim {
  /** 0 on the cork ... 1 held up to the lens */
  prog: number[]
  /** hover lift, 0..1 */
  hv: number[]
  /** written off the cork last frame: one more pass puts it back exactly */
  dirty: boolean[]
  /** last alpha written to each print's contact shadow */
  alpha: number[]
  swayX: number
  swayY: number
  dir: Vector3
  pos: Vector3
  p1: Vector3
  p2: Vector3
  pq: Quaternion
  hq: Quaternion
  sq: Quaternion
  rq: Quaternion
  rx: Quaternion
  tq: Quaternion
  eu: Euler
}

function makeAnim(): Anim {
  return {
    prog: PRINTS.map(() => 0),
    hv: PRINTS.map(() => 0),
    dirty: PRINTS.map(() => false),
    alpha: PRINTS.map(() => 1),
    swayX: 0,
    swayY: 0,
    dir: new Vector3(),
    pos: new Vector3(),
    p1: new Vector3(),
    p2: new Vector3(),
    pq: new Quaternion(),
    hq: new Quaternion(),
    sq: new Quaternion(),
    rq: new Quaternion(),
    rx: new Quaternion(),
    tq: new Quaternion(),
    eu: new Euler(),
  }
}

export function PinPrints({ cards, blob }: { cards: readonly CardSpec[]; blob: CanvasTexture }) {
  const set = useMemo(() => new PrintSet(), [])
  const geos = useMemo(() => PRINTS.map((p) => printGeo(p)), [])
  const rects = useMemo<ShadowRect[]>(() => [...cards, ...PRINTS], [cards])
  const shadows = useMemo(() => buildShadowGeo(rects), [rects])
  const still = useMemo(() => reducedMotion(), [])
  const open = usePins((s) => s.open)

  const groups = useRef<(Group | null)[]>([])
  const meshes = useRef<(Mesh | null)[]>([])
  /** the bright, unlit copy of each print that fades in as it is held up */
  const overlays = useRef<(Mesh | null)[]>([])
  const boardBox = useRef<Mesh>(null)

  const shadowMesh = useRef<Mesh>(null)
  /** per-print animation state, plus the scratch objects the loop reuses
      (made on the first frame, so render stays pure) */
  const anim = useRef<Anim | null>(null)

  /* the thumbnails, straight away; a print with no picture (yet, or ever)
     is just paper */
  useEffect(() => {
    let dead = false
    PRINTS.forEach((p, i) => {
      loadImage(PHOTOS[p.id].thumb).then((img) => {
        if (!dead) set.apply(i, img, 1)
      })
    })
    return () => {
      dead = true
    }
  }, [set])

  /* the full-size files, the first time the close-up opens */
  const fullStarted = useRef(false)
  useEffect(() => {
    if (!open || fullStarted.current) return
    fullStarted.current = true
    PRINTS.forEach((p, i) => {
      loadImage(PHOTOS[p.id].full).then((img) => {
        set.apply(i, img, 2)
      })
    })
  }, [open, set])

  /* let the input layer hit-test the prints and the board */
  useEffect(() => {
    PRINTS.forEach((p, i) => {
      const m = meshes.current[i]
      if (m) pinRegistry.prints.set(p.id, m)
    })
    pinRegistry.board = boardBox.current
    return () => {
      pinRegistry.prints.clear()
      pinRegistry.board = null
    }
  }, [])

  useEffect(
    () => () => {
      set.dispose()
      geos.forEach((g) => g.dispose())
      shadows.dispose()
    },
    [set, geos, shadows],
  )

  useFrame((rs, delta) => {
    const dt = Math.min(delta, 0.05)
    const { open: focused, heldId } = usePins.getState()
    const hover = focused ? pinHover.id : null
    const cam = rs.camera as PerspectiveCamera
    const a = (anim.current ??= makeAnim())
    let camReady = false
    let fitH = 0
    let fitW = 0
    // any print between the cork and the lens (held, or still easing back
    // after a release) — CameraRig must not pull the near plane in then
    let anyFlight = false

    for (let i = 0; i < PRINTS.length; i++) {
      const spec = PRINTS[i]
      const g = groups.current[i]
      const m = meshes.current[i]
      if (!g || !m) continue

      const held = heldId === spec.id
      const lift = hover === spec.id && !held
      a.prog[i] = MathUtils.damp(a.prog[i], held ? 1 : 0, still ? 90 : 7, dt)
      a.hv[i] = MathUtils.damp(a.hv[i], lift ? 1 : 0, still ? 90 : 14, dt)
      if (!held && a.prog[i] < 0.001) a.prog[i] = 0
      if (!lift && a.hv[i] < 0.001) a.hv[i] = 0
      const p = a.prog[i]
      const hv = a.hv[i]
      if (held || p !== 0) anyFlight = true
      // at rest and already written back to the cork: nothing to do
      if (p === 0 && hv === 0 && !a.dirty[i]) continue
      a.dirty[i] = p !== 0 || hv !== 0

      const e = p * p * (3 - 2 * p)

      /* on the cork, a finger under it: the pin keeps the top edge where it
         is and the bottom of the sheet swings out toward the viewer */
      const s0 = 1 + hv * HOVER_GROW
      a.rq.setFromAxisAngle(UP, spec.rot)
      a.rx.setFromAxisAngle(RIGHT, -hv * HOVER_TILT)
      a.tq.copy(a.rq).multiply(a.rx)
      a.p1.set(0, spec.h / 2 - PIN_INSET, 0).applyQuaternion(a.rq)
      a.p2.set(0, spec.h / 2 - PIN_INSET, 0).applyQuaternion(a.tq).multiplyScalar(s0)
      g.position.set(spec.x, spec.y, spec.z).add(a.p1).sub(a.p2)
      g.quaternion.copy(a.tq)
      g.scale.setScalar(s0)

      if (p > 0) {
        if (!camReady) {
          camReady = true
          cam.getWorldDirection(a.dir)
          const visH = 2 * HOLD_DIST * Math.tan(MathUtils.degToRad(cam.fov) / 2)
          fitH = visH * 0.8
          fitW = visH * cam.aspect * 0.9
          // a little pointer sway, damped, none for reduced motion
          a.swayX = MathUtils.damp(a.swayX, still ? 0 : rs.pointer.x, 4, dt)
          a.swayY = MathUtils.damp(a.swayY, still ? 0 : rs.pointer.y, 4, dt)
          a.sq.setFromEuler(a.eu.set(-a.swayY * 0.07, a.swayX * 0.1, -a.swayX * 0.02))
          g.parent?.getWorldQuaternion(a.pq).invert()
        }
        // where the print is held, in the board's own space
        a.pos.copy(cam.position).addScaledVector(a.dir, HOLD_DIST)
        g.parent?.worldToLocal(a.pos)
        g.position.lerp(a.pos, e)
        a.hq.copy(cam.quaternion).multiply(a.sq).premultiply(a.pq)
        g.quaternion.slerp(a.hq, e)
        g.scale.setScalar(MathUtils.lerp(s0, Math.min(fitH / spec.h, fitW / spec.w), e))
      }

      /* Held up to the lens it is a plain, bright print over everything: an
         unlit copy that FADES in over the lit one as the sheet leaves the
         cork (and out again as it lands), so nothing pops, and the pin and
         the yarn are never painted over once the print is home. */
      const ov = overlays.current[i]
      const showOv = e > 0.004
      if (ov) {
        if (ov.visible !== showOv) ov.visible = showOv
        if (showOv) {
          ;(ov.material as MeshBasicMaterial).opacity = e
          ov.renderOrder = held ? 51 : 50
        }
      }

      // its shadow leaves the cork with it
      const want = 1 - e
      if (Math.abs(a.alpha[i] - want) > 0.004 || (want === 1 && a.alpha[i] !== 1)) {
        a.alpha[i] = want
        const col = shadowMesh.current?.geometry.attributes.color as BufferAttribute | undefined
        if (col) {
          const base = (cards.length + i) * 6
          for (let v = 0; v < 6; v++) col.setW(base + v, want)
          col.needsUpdate = true
        }
      }
    }
    pinFlight.active = anyFlight
  })

  return (
    <>
      <mesh ref={shadowMesh} geometry={shadows} renderOrder={2}>
        <meshBasicMaterial
          map={blob}
          transparent
          vertexColors
          opacity={0.64}
          depthWrite={false}
        />
      </mesh>
      {PRINTS.map((p, i) => (
        <group
          key={p.id}
          ref={(g) => {
            groups.current[i] = g
          }}
          position={[p.x, p.y, p.z]}
          rotation-z={p.rot}
        >
          <mesh
            ref={(m) => {
              meshes.current[i] = m
            }}
            geometry={geos[i]}
            material={set.board[i]}
          />
          <mesh
            ref={(m) => {
              overlays.current[i] = m
            }}
            geometry={geos[i]}
            material={set.held[i]}
            visible={false}
          />
        </group>
      ))}
      {/* the board itself, unseen: what the input layer hit-tests to tell
          the cork from the bare wall */}
      <mesh ref={boardBox} visible={false} position={[0, 0, 0.002]}>
        <planeGeometry args={[BOARD.w, BOARD.h]} />
        <meshBasicMaterial side={DoubleSide} />
      </mesh>
    </>
  )
}

/* ---------------------------------------------------------------------
   World-level focus layer
   --------------------------------------------------------------------- */

export function PinFocus() {
  const open = usePins((s) => s.open)
  const view = useSystem((s) => s.view)

  /* leaning into the CRT (or anything that is not the room) puts the board
     away; zooming OUT may be the terminal's `pinboard` command on its way
     here, so leave that be */
  useEffect(() => {
    if ((view === 'zooming-in' || view === 'screen') && open) usePins.getState().closeBoard()
  }, [view, open])

  /* the board and the library are exclusive: the shelf opening wins */
  useEffect(
    () =>
      useLibrary.subscribe((s) => {
        if (s.open) usePins.getState().closeBoard()
      }),
    [],
  )

  /* The `pinboard` terminal command leaves the desk from inside the
     terminal, whose hidden input still holds keyboard focus: let go of it,
     or stray typing (and Enter) would land in a window nobody can see. */
  useEffect(() => {
    if (!open) return
    const el = document.activeElement as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
      el.blur()
    }
  }, [open])

  /* Esc unwinds one level (held photo, then board); arrows step. One
     listener, capture phase, and it swallows the event, so the same
     keystroke can never also reach the library, the monitor zoom or the
     desk keyboard. There is no text field on this screen, so unlike the
     desk keys it does not stand down for one: a stale, hidden terminal
     input must not be able to eat the way back. */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const isEsc = e.key === 'Escape'
      const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
      if (!isEsc && !isArrow) return
      const s = usePins.getState()
      if (!s.open) return
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      playClick()
      if (isEsc) {
        if (s.heldId) s.release()
        else s.closeBoard()
      } else {
        s.step(e.key === 'ArrowRight' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  return (
    <>
      <PinScrim />
      {open && <BoardInput />}
    </>
  )
}

/** A dark, soft-edged plane hung in front of the lens while a photo is
    held; drawn under the photo, over the rest of the room. */
function PinScrim() {
  const mesh = useRef<Mesh>(null)
  const mat = useRef<MeshBasicMaterial>(null)
  const still = useMemo(() => reducedMotion(), [])
  const level = useRef(0)
  const dir = useMemo(() => new Vector3(), [])
  const geo = useMemo(() => {
    // 5x5 vertices, alpha from the corner (heavy) to the middle (lighter):
    // a soft vignette without a texture
    const g = new PlaneGeometry(1, 1, 4, 4)
    const p = g.attributes.position
    const col = new Float32Array(p.count * 4)
    for (let i = 0; i < p.count; i++) {
      const r = Math.min(1, Math.hypot(p.getX(i), p.getY(i)) / 0.7)
      col[i * 4] = 0.012
      col[i * 4 + 1] = 0.014
      col[i * 4 + 2] = 0.022
      col[i * 4 + 3] = MathUtils.lerp(0.96, 1, r * r)
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 4))
    return g
  }, [])
  useEffect(() => () => geo.dispose(), [geo])

  useFrame((rs, delta) => {
    const m = mesh.current
    if (!m) return
    const dt = Math.min(delta, 0.05)
    // opaque enough that the desk behind the lens (pen cup, ruler) never
    // bleeds through a held photo's scrim — see the near-plane note in
    // CameraRig.tsx, which only clips that clutter while nothing is held
    const want = usePins.getState().heldId !== null ? 0.995 : 0
    level.current = MathUtils.damp(level.current, want, still ? 90 : 6, dt)
    if (level.current < 0.004) {
      if (m.visible) m.visible = false
      return
    }
    const cam = rs.camera as PerspectiveCamera
    cam.getWorldDirection(dir)
    const d = 0.25
    m.visible = true
    m.position.copy(cam.position).addScaledVector(dir, d)
    m.quaternion.copy(cam.quaternion)
    const h = 2 * d * Math.tan(MathUtils.degToRad(cam.fov) / 2) * 1.15
    m.scale.set(h * cam.aspect, h, 1)
    if (mat.current) mat.current.opacity = level.current
  })

  return (
    <mesh ref={mesh} visible={false} geometry={geo} renderOrder={49} frustumCulled={false}>
      <meshBasicMaterial
        ref={mat}
        transparent
        vertexColors
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

/** The see-through plane that owns the pointer while the board is focused. */
function BoardInput() {
  const mesh = useRef<Mesh>(null)
  const dir = useMemo(() => new Vector3(), [])
  const [pointing, setPointing] = useState(false)
  useCursor(pointing)
  const caster = useMemo(() => new Raycaster(), [])

  useEffect(
    () => () => {
      pinHover.id = null
    },
    [],
  )

  useFrame((rs) => {
    const m = mesh.current
    if (!m) return
    const cam = rs.camera as PerspectiveCamera
    cam.getWorldDirection(dir)
    const d = 0.1
    m.position.copy(cam.position).addScaledVector(dir, d)
    m.quaternion.copy(cam.quaternion)
    const h = 2 * d * Math.tan(MathUtils.degToRad(cam.fov) / 2) * 1.6
    m.scale.set(h * cam.aspect, h, 1)
  })

  /** the print under the pointer (the nearest: a held one is in front) */
  const pick = (ray: Ray): PrintId | null => {
    const objs = [...pinRegistry.prints.values()]
    if (!objs.length) return null
    caster.ray.copy(ray)
    const hit = caster.intersectObjects(objs, false)[0]
    if (!hit) return null
    for (const [id, o] of pinRegistry.prints) if (o === hit.object) return id
    return null
  }

  return (
    <mesh
      ref={mesh}
      visible={false}
      onPointerMove={(e) => {
        e.stopPropagation()
        const id = pick(e.ray)
        pinHover.id = id
        setPointing(id !== null)
      }}
      onPointerOut={() => {
        pinHover.id = null
        setPointing(false)
      }}
      onClick={(e) => {
        e.stopPropagation()
        const s = usePins.getState()
        const id = pick(e.ray)
        if (id) {
          playClick()
          if (s.heldId === id) s.release()
          else s.hold(id)
          return
        }
        // anywhere else with a photo in hand: put it back (one level)
        if (s.heldId) {
          playClick()
          s.release()
          return
        }
        // the cork and its frame are inert; the bare wall leaves
        const board = pinRegistry.board
        if (board) {
          caster.ray.copy(e.ray)
          if (caster.intersectObject(board, false).length > 0) return
        }
        playClick()
        s.closeBoard()
      }}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial side={DoubleSide} />
    </mesh>
  )
}
