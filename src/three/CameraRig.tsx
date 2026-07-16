import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MathUtils, Vector3, type PerspectiveCamera } from 'three'
import { useSystem } from '../os/store'
import {
  INTRO_CAM_POS,
  ROOM_CAM_POS,
  ROOM_CAM_TARGET,
  screenCamPose,
} from './layout'

/**
 * Drives the camera between the "room" pose and the "screen" pose using
 * frame-rate-independent smooth damping. Calls zoomArrived() once the
 * tween lands. In room view a gentle mouse parallax keeps the scene
 * alive; it is fully disabled while reading the screen.
 */
export default function CameraRig() {
  const view = useSystem((s) => s.view)
  const zoomArrived = useSystem((s) => s.zoomArrived)

  const pos = useRef(INTRO_CAM_POS.clone())
  const tgt = useRef(ROOM_CAM_TARGET.clone())
  const wantPos = useRef(new Vector3())
  const wantTgt = useRef(new Vector3())

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const cam = state.camera as PerspectiveCamera
    const zoomedIn = view === 'zooming-in' || view === 'screen'

    if (zoomedIn) {
      screenCamPose(cam.aspect, wantPos.current, wantTgt.current)
    } else {
      wantPos.current.copy(ROOM_CAM_POS)
      wantTgt.current.copy(ROOM_CAM_TARGET)
      if (view === 'room') {
        // subtle parallax; never active while zooming or reading
        const px = state.pointer.x
        const py = state.pointer.y
        wantPos.current.x += px * 0.085
        wantPos.current.y += py * 0.05
        wantTgt.current.x -= px * 0.02
        wantTgt.current.y -= py * 0.012
      }
    }

    const tweening = view === 'zooming-in' || view === 'zooming-out'
    const lambda = tweening ? 3.4 : 5.2
    dampV3(pos.current, wantPos.current, lambda, dt)
    dampV3(tgt.current, wantTgt.current, lambda, dt)

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
