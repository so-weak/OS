import { useEffect, useId, useRef, useState } from 'react'
import { useCursor } from '@react-three/drei'
import { useFrame, useStore, useThree } from '@react-three/fiber'
import type { ThreeElements, ThreeEvent } from '@react-three/fiber'
import { Box3, Sphere, Vector3 } from 'three'
import type { Group, Intersection, Mesh, PerspectiveCamera, Raycaster } from 'three'
import { useDevice } from '../device'
import { reducedMotion } from '../world'
import { useRoom } from './roomState'
import {
  FINGER_PX,
  claimTap,
  consumeTap,
  paintTag,
  primeTap,
  releaseTap,
  useTouch,
  watchTaps,
} from './touch'

type GroupProps = ThreeElements['group']

interface ClickableProps extends Omit<GroupProps, 'onClick'> {
  /** fired on click when enabled */
  onActivate: (e: ThreeEvent<MouseEvent>) => void
  /** tiny Silkscreen tooltip shown near the cursor while hovered */
  label?: string
  enabled?: boolean
}

/** Clear the shared tooltip, but only if we are the one showing it. */
function releaseTooltip(label: string | undefined): void {
  if (!label) return
  const room = useRoom.getState()
  if (room.tooltip === label) room.setTooltip(null)
}

/* =====================================================================
   THE DESK PATH — hover to learn, click to act.

   Everything below this comment down to TouchClickable is the component
   exactly as it was before touch existed, and it is the ONLY code a
   mouse ever runs: Clickable picks a branch by pointer kind and a
   pointer:fine machine never constructs the other one. No touch state,
   no extra group, no hit proxy, no new listeners — the desk scene graph
   and the desk raycast are the same objects they have always been.
   ===================================================================== */

/**
 * Group that turns the cursor into a pointer while hovered, shows an
 * optional room tooltip, and calls onActivate on click. Events stop
 * here so props stacked on the desk don't also trigger whatever is
 * underneath them.
 */
function MouseClickable({
  onActivate,
  label,
  enabled = true,
  children,
  ...rest
}: ClickableProps) {
  const [hovered, setHovered] = useState(false)
  // enabled gates the cursor, so a stale hover while disabled is harmless
  useCursor(hovered && enabled)

  // if the control gets disabled mid-hover, release the tooltip
  useEffect(() => {
    if (!enabled) releaseTooltip(label)
  }, [enabled, label])

  // never leave a stale tooltip behind on unmount
  useEffect(() => () => releaseTooltip(label), [label])

  return (
    <group
      {...rest}
      onPointerOver={(e) => {
        if (!enabled) return
        e.stopPropagation()
        setHovered(true)
        if (label) useRoom.getState().setTooltip(label)
      }}
      onPointerOut={() => {
        setHovered(false)
        releaseTooltip(label)
      }}
      onClick={(e) => {
        if (!enabled) return
        e.stopPropagation()
        onActivate(e)
      }}
    >
      {children}
    </group>
  )
}

/* =====================================================================
   THE FINGER PATH — tap to learn, tap again to act. See touch.ts for
   the interaction model; this half is the scene-graph side of it.
   ===================================================================== */

/** how far a primed prop leans toward the lens, in metres — the same
    2.6 mm whatever the prop is, so the duck grows visibly and the
    window barely twitches */
const LEAN_M = 0.0026
/** clamped only at the extremes: a drawer pull must not double in size
    and a wall must not visibly move */
const LEAN_MIN = 0.001
const LEAN_MAX = 0.085

interface Shape {
  /** half the bounding box diagonal, in world metres */
  r: number
  /** box centre, in the inner group's own space so it survives motion */
  c: Vector3
}

const _box = new Box3()
const _size = new Vector3()
const _at = new Vector3()
const _sphere = new Sphere()

/** Measure a prop once, lazily — after a frame, so matrices are real. */
function shapeOf(g: Group, cache: { current: Shape | null }): Shape | null {
  if (cache.current) return cache.current
  _box.setFromObject(g)
  if (_box.isEmpty()) return null
  const s: Shape = { r: 0, c: new Vector3() }
  _box.getCenter(s.c)
  s.r = Math.max(_box.getSize(_size).length() / 2, 1e-4)
  // a child with an empty geometry poisons the union with ±Infinity; a
  // NaN radius would scale the prop out of existence, so refuse to
  // measure at all rather than guess — the prop just keeps its own
  // hit box and stops leaning, which is exactly the desk behaviour
  if (!Number.isFinite(s.r) || !Number.isFinite(s.c.lengthSq())) return null
  g.worldToLocal(s.c)
  cache.current = s
  return s
}

/**
 * An invisible bubble that grows a too-small prop up to a fingertip.
 *
 * Only mounted off the desk, so the desk raycast is untouched: the
 * harness tier never constructs one. It renders nothing (visible=false,
 * so no draw call and no shadow) and answers raycasts itself. Three
 * rules keep it from changing anything it shouldn't:
 *
 *  - it is the LAST child of the Clickable, and R3F raycasts each
 *    interactive object into its own fresh array, so a non-empty `out`
 *    means this prop's real geometry already answered. Then the bubble
 *    stays out of it entirely. It can only ever add a hit where the
 *    prop would have been missed altogether.
 *  - it is a sphere of exactly one fingertip, pinned to the prop's
 *    CENTRE — so on anything big it is buried inside the prop and
 *    reaches nothing, and only a genuinely small prop gets any wider.
 *  - the hit it reports carries the prop's own depth, never the
 *    bubble's surface, so a prop in front still sorts first and stops
 *    the event before this one is ever consulted.
 */
function HitProxy({
  inner,
  shape,
}: {
  inner: React.RefObject<Group | null>
  shape: { current: Shape | null }
}) {
  const self = useRef<Mesh>(null)
  // the store, not the state: raycasts happen outside render and want
  // the live viewport height, not whatever it was when we last rendered
  const store = useStore()

  const raycast = (ray: Raycaster, out: Intersection[]): void => {
    if (out.length) return // the prop itself answered — stay out of it
    const me = self.current
    const g = inner.current
    if (!me || !g) return
    const cam = ray.camera as PerspectiveCamera | undefined
    if (!cam?.isPerspectiveCamera) return
    const s = shapeOf(g, shape)
    if (!s) return
    _at.copy(s.c).applyMatrix4(g.matrixWorld)
    const d = ray.ray.origin.distanceTo(_at)
    // world size of one CSS pixel at the prop's depth
    const perPx =
      (2 * Math.tan((cam.fov * Math.PI) / 360) * d) /
      Math.max(store.getState().size.height, 1)
    _sphere.set(_at, FINGER_PX * 0.5 * perPx)
    if (!ray.ray.intersectsSphere(_sphere)) return
    out.push({ distance: d, point: _at.clone(), object: me })
  }

  return <mesh ref={self} visible={false} raycast={raycast} />
}

/**
 * While a prop holds the tag: project its tapped point to the screen
 * every frame (so the tag tracks the prop, not the stale touch), and —
 * while it is still armed — let it breathe toward the lens.
 *
 * Only one of these exists at a time, so this is one useFrame for the
 * whole room, and only while a finger is mid-conversation with it.
 */
function TouchTag({
  inner,
  at,
  shape,
  lean,
}: {
  inner: React.RefObject<Group | null>
  at: React.RefObject<Vector3>
  shape: { current: Shape | null }
  lean: boolean
}) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const calm = reducedMotion()

  useFrame(({ clock }) => {
    const g = inner.current
    if (!g) return

    _at.copy(at.current).applyMatrix4(g.matrixWorld).project(camera)
    paintTag(
      size.left + ((_at.x + 1) / 2) * size.width,
      size.top + ((1 - _at.y) / 2) * size.height,
    )

    // the cue: the prop itself swells a hair, about its own centre, so
    // it reads as a thing leaning in rather than a badge stuck on it
    const s = shapeOf(g, shape)
    if (!s) return
    const k = !lean
      ? 0
      : calm
        ? 1
        : 0.55 + 0.45 * Math.sin(clock.elapsedTime * 5)
    const grow =
      1 + Math.min(Math.max(LEAN_M / s.r, LEAN_MIN), LEAN_MAX) * k
    g.scale.setScalar(grow)
    g.position.set(s.c.x * (1 - grow), s.c.y * (1 - grow), s.c.z * (1 - grow))
  })

  // whatever happens next — dismissed, fired, unmounted — sit back down
  useEffect(
    () => () => {
      const g = inner.current
      if (!g) return
      g.scale.setScalar(1)
      g.position.set(0, 0, 0)
    },
    [inner],
  )

  return null
}

function TouchClickable({
  onActivate,
  label,
  enabled = true,
  children,
  ...rest
}: ClickableProps) {
  const id = useId()
  const primed = useTouch((s) => s.primed === id)
  const tagged = useTouch((s) => s.tagged === id)
  // a touchscreen desk machine keeps the desk's hit targets; only the
  // small-screen tiers get the bubbles
  const fat = useDevice((s) => s.tier) !== 'desk'
  const inner = useRef<Group>(null)
  const shape = useRef<Shape | null>(null)
  /** the tapped point, kept in the prop's own space so the tag follows
      the prop when the prop moves (the moth, the spinning duck) */
  const at = useRef(new Vector3())

  useEffect(watchTaps, [])

  // a control that gets disabled mid-conversation drops the floor
  useEffect(() => {
    if (!enabled) releaseTap(id)
  }, [enabled, id])

  // and so does one that goes away entirely
  useEffect(() => () => releaseTap(id), [id])

  // the mouse branch overrides this one; keep touch identical rather
  // than quietly waking up a hover handler that has never once run
  const props: Omit<GroupProps, 'onClick'> = { ...rest }
  delete props.onPointerOut

  return (
    <group
      {...props}
      // No hover model on a finger — but this handler still has to
      // EXIST, for the one thing the desk uses it for besides the
      // tooltip: stopping the pointer-move here. A touch drags a
      // pointermove through every prop along the ray, and props that
      // run their own hover handlers on a group INSIDE a Clickable
      // (the shelf books peek that way) all fired at once without it —
      // two volumes sliding off the shelf under one fingertip. This
      // restores exactly the desk's front-most-only rule, and nothing
      // else: no tooltip, no state, no cursor.
      onPointerOver={(e) => {
        if (!enabled) return
        e.stopPropagation()
      }}
      onPointerDown={(e) => {
        if (!enabled) return
        e.stopPropagation()
        claimTap() // "this tap has an owner" — see touch.ts
      }}
      onClick={(e) => {
        if (!enabled) return
        e.stopPropagation()
        if (useTouch.getState().primed === id) {
          // hand the tag on BEFORE firing: props that rename themselves
          // as they go (the duck's riddles) must have the last word
          consumeTap(id)
          onActivate(e)
          return
        }
        const g = inner.current
        if (g) at.current.copy(g.worldToLocal(e.point.clone()))
        primeTap(id, label)
      }}
    >
      <group ref={inner}>{children}</group>
      {fat && <HitProxy inner={inner} shape={shape} />}
      {tagged && (
        <TouchTag inner={inner} at={at} shape={shape} lean={primed} />
      )}
    </group>
  )
}

/**
 * One prop, two input models. The branch is chosen by pointer kind, not
 * blended into one component, so a mouse runs the pre-touch code and
 * nothing else — see device.ts's desk invariant.
 */
export default function Clickable(props: ClickableProps) {
  const touch = useDevice((s) => s.pointer) === 'touch'
  return touch ? <TouchClickable {...props} /> : <MouseClickable {...props} />
}
