import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MathUtils, Vector3, type PerspectiveCamera } from 'three'
import { useSystem } from '../os/store'
import {
  CAM_FOV_ROOM,
  INTRO_CAM_POS,
  LIB_CAM_POS,
  LIB_CAM_TARGET,
  LIB_FOV,
  ROOM_CAM_POS,
  ROOM_CAM_TARGET,
  screenCamPose,
} from './layout'
import { useLibrary } from './libraryState'
import { BOARD_FOV, boardCamPose, pinFlight, usePins } from './pinState'
import { reducedMotion } from '../world'

/* ---------- dev photo mode ----------
   `window.__photo = { pos:[x,y,z], target:[x,y,z], fov? }` parks the
   camera anywhere (no damping, no parallax) so close-ups of the props can
   be checked; `window.__photo = null` gives the camera back. Dev builds
   only — nothing here reaches production. */
declare global {
  interface Window {
    __photo?: {
      pos: [number, number, number]
      target: [number, number, number]
      fov?: number
    } | null
  }
}

/**
 * Drives the camera between the "room" pose and the "screen" pose using
 * frame-rate-independent smooth damping. Calls zoomArrived() once the
 * tween lands. In room view a gentle mouse parallax keeps the scene
 * alive; it is fully disabled while reading the screen.
 *
 * The library (src/three/Bookcase) is a third pose layered on top of
 * room view: useLibrary.open cross-fades the room pose into LIB_CAM,
 * damping the parallax away as it goes. The pin-up board is a fourth:
 * usePins.open glides to a straight-on close-up of the cork board
 * (boardCamPose, aspect-aware, on a longer lens).
 */
export default function CameraRig() {
  const view = useSystem((s) => s.view)
  const zoomArrived = useSystem((s) => s.zoomArrived)

  const pos = useRef(INTRO_CAM_POS.clone())
  const tgt = useRef(ROOM_CAM_TARGET.clone())
  const wantPos = useRef(new Vector3())
  const wantTgt = useRef(new Vector3())
  /** 0 = room, 1 = parked at the bookcase */
  const libMix = useRef(0)
  /** 0 = room, 1 = parked at the pin-up board */
  const boardMix = useRef(0)
  const boardPos = useRef(new Vector3())
  const boardTgt = useRef(new Vector3())
  /** the camera's normal near plane, read once so the board close-up can
      restore it exactly */
  const baseNear = useRef<number | null>(null)
  /** the opening dolly: slow, like a camera settling on a tripod; any
      click (view change) or arrival ends it */
  const intro = useRef(true)
  /** prefers-reduced-motion: the room holds still under the pointer */
  const still = useRef(reducedMotion())

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const cam = state.camera as PerspectiveCamera
    if (import.meta.env.DEV && window.__photo) {
      const ph = window.__photo
      cam.position.set(ph.pos[0], ph.pos[1], ph.pos[2])
      cam.lookAt(ph.target[0], ph.target[1], ph.target[2])
      if (ph.fov && Math.abs(cam.fov - ph.fov) > 0.01) {
        cam.fov = ph.fov
        cam.updateProjectionMatrix()
      }
      return
    }
    const zoomedIn = view === 'zooming-in' || view === 'screen'

    // 'zooming-out' counts: the terminal's `library` command pulls back
    // from the screen and walks to the shelf in one move
    const inLibrary =
      (view === 'room' || view === 'zooming-out') && useLibrary.getState().open
    libMix.current = MathUtils.damp(libMix.current, inLibrary ? 1 : 0, 3.2, dt)

    // same rule for the board (the terminal's `pinboard` also opens it
    // while pulling back from the screen); reduced motion cuts, no glide
    const { open: boardOpen, heldId } = usePins.getState()
    const inBoard = (view === 'room' || view === 'zooming-out') && boardOpen
    boardMix.current = MathUtils.damp(
      boardMix.current,
      inBoard ? 1 : 0,
      still.current ? 60 : 3.2,
      dt,
    )
    const bm = boardMix.current

    if (zoomedIn) {
      screenCamPose(cam.aspect, wantPos.current, wantTgt.current)
    } else {
      const lib = libMix.current
      wantPos.current.lerpVectors(ROOM_CAM_POS, LIB_CAM_POS, lib)
      wantTgt.current.lerpVectors(ROOM_CAM_TARGET, LIB_CAM_TARGET, lib)
      if (bm > 0.0005) {
        boardCamPose(cam.aspect, boardPos.current, boardTgt.current)
        wantPos.current.lerp(boardPos.current, bm)
        wantTgt.current.lerp(boardTgt.current, bm)
      }
      if (view === 'room' && !still.current) {
        // subtle parallax; never active while zooming or reading, and
        // eased right down at the shelf (and the board) so spines and
        // faces stay put under the pointer
        const sway = (1 - lib * 0.7) * (1 - bm * 0.92)
        const px = state.pointer.x
        const py = state.pointer.y
        wantPos.current.x += px * 0.085 * sway
        wantPos.current.y += py * 0.05 * sway
        wantTgt.current.x -= px * 0.02 * sway
        wantTgt.current.y -= py * 0.012 * sway
      }
    }

    const tweening = view === 'zooming-in' || view === 'zooming-out'
    if (
      intro.current &&
      (view !== 'room' || boardOpen || pos.current.distanceToSquared(ROOM_CAM_POS) < 1e-4)
    )
      intro.current = false
    let lambda = intro.current ? 1.8 : tweening ? 3.4 : 5.2
    if (still.current && (boardOpen || bm > 0.0005)) lambda = 60
    dampV3(pos.current, wantPos.current, lambda, dt)
    dampV3(tgt.current, wantTgt.current, lambda, dt)

    // longer lens at the shelf, wide again everywhere else
    const wantFov = MathUtils.lerp(
      MathUtils.lerp(CAM_FOV_ROOM, LIB_FOV, libMix.current),
      BOARD_FOV,
      bm,
    )
    if (Math.abs(cam.fov - wantFov) > 0.01) {
      cam.fov = wantFov
      cam.updateProjectionMatrix()
    }

    // Once the camera has actually settled on the board — nothing held or
    // mid-flight (pinFlight: a held photo also dims everything behind its
    // scrim anyway, so there is nothing to gain, and a print easing back
    // to the cork passes through this same depth range and must not be
    // clipped mid-flight) — pull the near plane in to just short of the
    // board itself. The desk's pen cup sits well off to the side but close
    // to the wall, and at this lens length its tip pokes into the bottom
    // of an otherwise clean close-up; a near plane a hair inside the
    // board's own depth clips it without touching anything on the board
    // (the frame, cork and pins all sit at `dist`).
    if (baseNear.current === null) baseNear.current = cam.near
    const settled = !zoomedIn && bm > 0.995 && heldId === null && !pinFlight.active
    const wantNear = settled
      ? Math.max(baseNear.current, boardPos.current.distanceTo(boardTgt.current) - 0.1)
      : baseNear.current
    if (Math.abs(cam.near - wantNear) > 1e-4) {
      cam.near = wantNear
      cam.updateProjectionMatrix()
    }

    cam.position.copy(pos.current)
    cam.lookAt(tgt.current)

    if (
      tweening &&
      pos.current.distanceToSquared(wantPos.current) < 3.6e-5 &&
      tgt.current.distanceToSquared(wantTgt.current) < 3.6e-5
    ) {
      zoomArrived()
    }
  })

  return null
}

function dampV3(cur: Vector3, target: Vector3, lambda: number, dt: number) {
  cur.x = MathUtils.damp(cur.x, target.x, lambda, dt)
  cur.y = MathUtils.damp(cur.y, target.y, lambda, dt)
  cur.z = MathUtils.damp(cur.z, target.z, lambda, dt)
}
