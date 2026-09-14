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

/**
 * Drives the camera between the "room" pose and the "screen" pose using
 * frame-rate-independent smooth damping. Calls zoomArrived() once the
 * tween lands. In room view a gentle mouse parallax keeps the scene
 * alive; it is fully disabled while reading the screen.
 *
 * The library (src/three/Bookcase) is a third pose layered on top of
 * room view: useLibrary.open cross-fades the room pose into LIB_CAM,
 * damping the parallax away as it goes.
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

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const cam = state.camera as PerspectiveCamera
    const zoomedIn = view === 'zooming-in' || view === 'screen'

    // 'zooming-out' counts: the terminal's `library` command pulls back
    // from the screen and walks to the shelf in one move
    const inLibrary =
      (view === 'room' || view === 'zooming-out') && useLibrary.getState().open
    libMix.current = MathUtils.damp(libMix.current, inLibrary ? 1 : 0, 3.2, dt)

    if (zoomedIn) {
      screenCamPose(cam.aspect, wantPos.current, wantTgt.current)
    } else {
      const lib = libMix.current
      wantPos.current.lerpVectors(ROOM_CAM_POS, LIB_CAM_POS, lib)
      wantTgt.current.lerpVectors(ROOM_CAM_TARGET, LIB_CAM_TARGET, lib)
      if (view === 'room') {
        // subtle parallax; never active while zooming or reading, and
        // eased right down at the shelf so spines stay readable
        const sway = 1 - lib * 0.7
        const px = state.pointer.x
        const py = state.pointer.y
        wantPos.current.x += px * 0.085 * sway
        wantPos.current.y += py * 0.05 * sway
        wantTgt.current.x -= px * 0.02 * sway
        wantTgt.current.y -= py * 0.012 * sway
      }
    }

    const tweening = view === 'zooming-in' || view === 'zooming-out'
    const lambda = tweening ? 3.4 : 5.2
    dampV3(pos.current, wantPos.current, lambda, dt)
    dampV3(tgt.current, wantTgt.current, lambda, dt)

    // longer lens at the shelf, wide again everywhere else
    const wantFov = MathUtils.lerp(CAM_FOV_ROOM, LIB_FOV, libMix.current)
    if (Math.abs(cam.fov - wantFov) > 0.01) {
      cam.fov = wantFov
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
