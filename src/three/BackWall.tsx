import { useEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, Path, Shape, ShapeGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WINDOW } from './layout'
import type { SurfaceMaps } from './textures'

/* =====================================================================
   The back wall — with a real hole in it.

   The window (Window.tsx) is an opening, not a picture: the wall is a
   shape with a rectangular hole cut through it (WINDOW.frameW × frameH),
   the hole has a tunnel `WINDOW.reveal` deep with plaster returns on all
   four sides, and the sky is hung in layers BEHIND it. That is what gives
   the room parallax: move the camera and the sky slides in the frame,
   the reveal's inner face turns toward you, the sill throws a line on it.

   UVs reproduce the old 4.6 × 2.6 m plane (0…1 across it, the surface's
   own repeat does the tiling) so the plaster grain keeps its density,
   and the reveal's returns carry the same grain along their length. The
   plaster surface is passed in from Room.tsx so every wall shares one
   look; its normal map runs at 0.32 here (the side walls' 0.5 reads as
   stucco from the close-ups this wall gets, next to the clock and the
   window).
   ===================================================================== */

const W = 4.6
const H = 2.6
const X0 = 0.1 - W / 2
const HOLE = {
  x0: WINDOW.x - WINDOW.frameW / 2,
  x1: WINDOW.x + WINDOW.frameW / 2,
  y0: WINDOW.y - WINDOW.frameH / 2,
  y1: WINDOW.y + WINDOW.frameH / 2,
}

function buildWall(): BufferGeometry {
  const shape = new Shape()
  shape.moveTo(X0, 0)
  shape.lineTo(X0 + W, 0)
  shape.lineTo(X0 + W, H)
  shape.lineTo(X0, H)
  shape.closePath()
  const hole = new Path()
  hole.moveTo(HOLE.x0, HOLE.y0)
  hole.lineTo(HOLE.x0, HOLE.y1)
  hole.lineTo(HOLE.x1, HOLE.y1)
  hole.lineTo(HOLE.x1, HOLE.y0)
  hole.closePath()
  shape.holes.push(hole)

  const face = new ShapeGeometry(shape)
  // plane-style UVs: 0…1 across the whole 4.6 × 2.6 wall
  const pos = face.getAttribute('position')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - X0) / W
    uv[i * 2 + 1] = pos.getY(i) / H
  }
  face.setAttribute('uv', new Float32BufferAttribute(uv, 2))

  // the tunnel: four returns from the wall face back to `reveal`
  const D = WINDOW.reveal
  const p: number[] = []
  const n: number[] = []
  const t: number[] = []
  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    nrm: [number, number, number],
    ua: [number, number],
    ub: [number, number],
    uc: [number, number],
    ud: [number, number],
  ) => {
    // wind to face `nrm`
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const cr = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ]
    const flip = cr[0] * nrm[0] + cr[1] * nrm[1] + cr[2] * nrm[2] < 0
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]
    const P = [a, b, c, d]
    const U = [ua, ub, uc, ud]
    for (const i of order) {
      p.push(...P[i])
      n.push(...nrm)
      t.push(...U[i])
    }
  }
  const { x0, x1, y0, y1 } = HOLE
  const ux = (x: number) => (x - X0) / W
  const vy = (y: number) => y / H
  // left return (faces +x), right (faces -x), floor (faces +y), head (faces -y)
  quad(
    [x0, y0, 0], [x0, y1, 0], [x0, y1, -D], [x0, y0, -D], [1, 0, 0],
    [0, vy(y0)], [0, vy(y1)], [D / W, vy(y1)], [D / W, vy(y0)],
  )
  quad(
    [x1, y0, 0], [x1, y1, 0], [x1, y1, -D], [x1, y0, -D], [-1, 0, 0],
    [0, vy(y0)], [0, vy(y1)], [D / W, vy(y1)], [D / W, vy(y0)],
  )
  quad(
    [x0, y0, 0], [x1, y0, 0], [x1, y0, -D], [x0, y0, -D], [0, 1, 0],
    [ux(x0), 0], [ux(x1), 0], [ux(x1), D / H], [ux(x0), D / H],
  )
  quad(
    [x0, y1, 0], [x1, y1, 0], [x1, y1, -D], [x0, y1, -D], [0, -1, 0],
    [ux(x0), 0], [ux(x1), 0], [ux(x1), D / H], [ux(x0), D / H],
  )
  const returns = new BufferGeometry()
  returns.setAttribute('position', new Float32BufferAttribute(p, 3))
  returns.setAttribute('normal', new Float32BufferAttribute(n, 3))
  returns.setAttribute('uv', new Float32BufferAttribute(t, 2))

  const flat = face.toNonIndexed()
  face.dispose()
  const out = mergeGeometries([flat, returns], false)
  flat.dispose()
  returns.dispose()
  if (!out) throw new Error('back wall: geometry merge failed')
  out.computeBoundingSphere()
  return out
}

export default function BackWall({ surface }: { surface: SurfaceMaps }) {
  const geometry = useMemo(() => buildWall(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} position={[0, 0, WINDOW.wallZ]} receiveShadow>
      <meshStandardMaterial
        map={surface.map}
        normalMap={surface.normalMap}
        normalScale={[0.32, 0.32]}
        bumpMap={surface.normalMap ? undefined : surface.bumpMap}
        bumpScale={0.003}
        roughnessMap={surface.roughnessMap}
        roughness={1}
      />
    </mesh>
  )
}
