import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  MathUtils,
  Shape,
  type BufferGeometry,
  type Group,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { certifications } from '../data/resume'
import { useSystem } from '../os/store'
import { playClick } from '../os/sound'
import { useWorld } from '../world'
import Clickable from './Clickable'
import Halo from './Halo'
import { P, TOWER_POS, TOWER_SIZE, TOWER_YAW } from './layout'
import { useRoom } from './roomState'
import { makeLabel } from './textures'
import { rb } from './rbox'
import { grimeTexture } from './tex/noise'
import {
  clamp01,
  drawSpaced,
  lathe,
  makeDecal,
  mergeParts,
  noise3,
  part,
  sharedPlastic,
  roundedSlab,
  screwHead,
  smooth,
  tintGeo,
} from './tex/electronics'
import Staged from './Staged'
import { useStagedSteps } from './stage'

/* =====================================================================
   The beige AT tower, built like one: a painted-steel cover under a
   moulded plastic bezel that stands 1.5 cm proud all round, four 5.25" bays
   (two slatted blanks, the floppy, the CD-ROM), an LED strip, a hinged
   lower door line over a fan grille, rubber feet, seam and screws.
   Front panel behaviour: the floppy drive is clickable — the disk ejects
   with a springy pop; the LED cluster glows with a lit MHz readout; the
   power button boots the machine just like clicking the monitor; the
   intake fan spins while powered. The power LED breathes amber on standby
   and burns green once running — the room's pulse.

   All the passive detail is ONE merged mesh; the moving and glowing
   parts are their own small meshes.
   ===================================================================== */

const HALF_W = TOWER_SIZE.w / 2
const FRONT = TOWER_SIZE.d / 2 // front plane of the steel cover
const Y_TOP = TOWER_SIZE.h / 2
const Y_BOT = -Y_TOP + 0.012 // the case rides on 12 mm feet
const PANEL_FACE = FRONT + 0.015 // the moulded bezel's face
/** bay centres (5.25" bays are 43 mm on a 46 mm pitch) */
const BAY = { blank1: 0.198, floppy: 0.152, cd: 0.106, blank2: 0.06 }
const STRIP_Y = 0.012
const DOOR_TOP = -0.062
const FAN = { x: 0, y: -0.14, r: 0.05 }
const POWER = { x: 0.062, y: -0.031 }


/* ---------------------------------------------------------------------
   Shell geometry
   --------------------------------------------------------------------- */
/** The shell in steps: each `yield` lets a staged first load (stage.ts)
    hand the main thread back — it is the tower's heaviest build. */
function* buildShellSteps(): Generator<void, BufferGeometry, void> {
  const parts: BufferGeometry[] = []
  const add = (g: BufferGeometry, o: Parameters<typeof part>[1] = {}) =>
    parts.push(part(g, { color: '#ffffff', tile: 0.04, ...o }))
  /** a rounded slab whose FRONT face is at `zf`, centred at (x, y) */
  const slab = (
    w: number,
    h: number,
    depth: number,
    x: number,
    y: number,
    zf: number,
    corner: number,
    bevel: number,
    color: string,
    hole?: Parameters<typeof roundedSlab>[6],
  ) =>
    add(roundedSlab(w, h, depth, corner, bevel, 2, hole), {
      pos: [x, y, zf - depth / 2],
      color,
      tile: 0.04,
    })

  const bodyH = Y_TOP - Y_BOT
  const bodyY = (Y_TOP + Y_BOT) / 2

  // steel cover, with a rounded fold
  add(new RoundedBoxGeometry(TOWER_SIZE.w - 0.006, bodyH - 0.002, FRONT + 0.222, 4, 0.006), {
    pos: [0, bodyY, (0.222 - FRONT) / 2],
    color: '#d3ccb7',
    crease: 1.1,
  })
  // moulded front bezel, proud of the cover
  slab(TOWER_SIZE.w, bodyH, 0.034, 0, bodyY, PANEL_FACE, 0.013, 0.008, '#ddd6c1')
  yield

  /* --- four bays --- */
  const bay = (y: number, hole?: Parameters<typeof roundedSlab>[6]) => {
    slab(0.1535, 0.0465, 0.0009, 0, y, PANEL_FACE + 0.0006, 0.004, 0.0003, '#141312')
    slab(0.15, 0.043, 0.0028, 0, y, PANEL_FACE + 0.0026, 0.003, 0.0007, '#e2dbc6', hole)
  }
  // blank covers: slatted
  for (const y of [BAY.blank1, BAY.blank2]) {
    bay(y)
    for (let i = 0; i < 8; i++) {
      slab(0.136, 0.0026, 0.0012, 0, y - 0.0154 + i * 0.0044, PANEL_FACE + 0.0038, 0.001, 0.0005, '#d6cfba')
    }
  }
  // floppy: plate with the slot cut through it, LED window, eject seat
  bay(BAY.floppy + 0.0, { w: 0.0938, h: 0.0052, corner: 0.0018, y: 0.0075, x: 0 })
  slab(0.011, 0.006, 0.0006, -0.056, BAY.floppy - 0.0105, PANEL_FACE + 0.0033, 0.001, 0.0002, '#1d1c1a')
  slab(0.018, 0.0085, 0.0006, 0.056, BAY.floppy - 0.0105, PANEL_FACE + 0.0033, 0.0015, 0.0002, '#bdb6a1')
  slab(0.0098, 0.004, 0.0009, 0.056, BAY.floppy - 0.0105, PANEL_FACE + 0.0037, 0.001, 0.0003, '#1d1c1a')
  // CD-ROM: tray, seam, jack, volume wheel, pinhole, eject
  bay(BAY.cd)
  slab(0.13, 0.0012, 0.0008, 0, BAY.cd - 0.0035, PANEL_FACE + 0.0033, 0.0005, 0.0002, '#121110')
  slab(0.128, 0.0165, 0.0008, 0, BAY.cd + 0.0052, PANEL_FACE + 0.0036, 0.0018, 0.0003, '#d9d2bd')
  add(lathe([[0.0001, 0], [0.0033, 0], [0.0033, 0.0004], [0.0021, 0.0009], [0.0001, 0.0009]], 12), {
    pos: [-0.058, BAY.cd - 0.0125, PANEL_FACE + 0.0033],
    rot: [Math.PI / 2, 0, 0],
    color: '#1b1a18',
    tile: 0,
  })
  slab(0.0085, 0.0028, 0.0008, -0.04, BAY.cd - 0.0125, PANEL_FACE + 0.0034, 0.0012, 0.0002, '#22211e')
  add(lathe([[0.0001, 0], [0.0011, 0], [0.0011, 0.0005], [0.0001, 0.0005]], 8), {
    pos: [0.024, BAY.cd - 0.0125, PANEL_FACE + 0.0033],
    rot: [Math.PI / 2, 0, 0],
    color: '#111',
    tile: 0,
  })
  slab(0.016, 0.0065, 0.0016, 0.056, BAY.cd - 0.0125, PANEL_FACE + 0.0041, 0.0015, 0.0005, '#d0c9b3')
  // LED socket for the CD's busy light
  slab(0.006, 0.006, 0.0007, 0.038, BAY.cd - 0.0125, PANEL_FACE + 0.0033, 0.002, 0.0002, '#1d1c1a')

  yield

  /* --- LED / MHz strip --- */
  slab(0.156, 0.0255, 0.0008, 0, STRIP_Y, PANEL_FACE + 0.0006, 0.003, 0.0003, '#c9c2ad')
  slab(0.011, 0.0075, 0.0009, -0.07, STRIP_Y, PANEL_FACE + 0.0011, 0.0015, 0.0003, '#1d1c1a')
  slab(0.011, 0.0075, 0.0009, -0.045, STRIP_Y, PANEL_FACE + 0.0011, 0.0015, 0.0003, '#1d1c1a')
  slab(0.066, 0.0225, 0.0015, 0.045, STRIP_Y, PANEL_FACE + 0.0016, 0.002, 0.0004, '#0d0f0d')
  // turbo button
  slab(0.014, 0.0075, 0.0022, -0.014, STRIP_Y, PANEL_FACE + 0.0026, 0.0018, 0.0006, '#d2cbb5')

  /* --- power housing --- */
  slab(0.05, 0.036, 0.0016, POWER.x, POWER.y, PANEL_FACE + 0.0012, 0.005, 0.0008, '#b9b29d')
  slab(0.042, 0.028, 0.0012, POWER.x, POWER.y, PANEL_FACE + 0.0024, 0.004, 0.0006, '#161513')

  /* --- lower door: outline groove, handle notch, fan bezel, grille --- */
  slab(0.198, 0.164, 0.0007, 0, (DOOR_TOP + Y_BOT + 0.012) / 2, PANEL_FACE + 0.0004, 0.006, 0.0002, '#141312', {
    w: 0.196,
    h: 0.162,
    corner: 0.0052,
  })
  slab(0.06, 0.0052, 0.0012, 0, DOOR_TOP - 0.009, PANEL_FACE + 0.0004, 0.0024, 0.0004, '#171614')
  // dark fan well
  add(lathe([[0.0001, 0], [FAN.r + 0.004, 0], [FAN.r + 0.004, 0.0014], [FAN.r, 0.0026], [0.0001, 0.0026]], 40), {
    pos: [FAN.x, FAN.y, PANEL_FACE + 0.0002],
    rot: [Math.PI / 2, 0, 0],
    color: '#101010',
    tile: 0,
  })
  // grille: concentric rings and two spokes standing 4 mm off the well
  for (const r of [0.012, 0.024, 0.036, 0.047]) {
    add(lathe([[r - 0.0008, 0], [r + 0.0008, 0], [r + 0.0008, 0.0046], [r - 0.0008, 0.0046]], 36), {
      pos: [FAN.x, FAN.y, PANEL_FACE + 0.0014],
      rot: [Math.PI / 2, 0, 0],
      color: '#d7d0bb',
    })
  }
  for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
    add(new BoxGeometry(0.0968, 0.0016, 0.0044), {
      pos: [FAN.x, FAN.y, PANEL_FACE + 0.0036],
      rot: [0, 0, a],
      color: '#d7d0bb',
      crease: 0.6,
    })
  }

  yield

  /* --- feet, seams and screws --- */
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(new CylinderGeometry(0.0135, 0.0155, 0.0125, 14), {
        pos: [sx * 0.078, Y_BOT - 0.0058, sz * 0.19 + 0.01],
        color: '#1b1b1c',
      })
    }
  }
  // rear cover seam, both flanks, with four screws each
  for (const sx of [-1, 1]) {
    add(new BoxGeometry(0.0009, bodyH - 0.012, 0.0012), {
      pos: [sx * (HALF_W - 0.0033), bodyY, -FRONT + 0.03],
      color: '#7d7768',
      crease: 0.6,
    })
    for (const sy of [-0.19, -0.065, 0.065, 0.19]) {
      add(screwHead(0.0032), {
        pos: [sx * (HALF_W - 0.0031), sy, -FRONT + 0.016],
        rot: [0, sx * (Math.PI / 2), 0],
        tile: 0,
      })
    }
    // a louvre bank near the power supply
    for (let i = 0; i < 7; i++) {
      add(new BoxGeometry(0.0012, 0.0032, 0.084), {
        pos: [sx * (HALF_W - 0.0032), 0.2 - i * 0.0095, -0.115],
        color: '#22211e',
        crease: 0.6,
      })
    }
  }

  yield
  const merged = mergeParts(parts)
  // yellowing toward the top and back, plus low-frequency blotches
  tintGeo(merged, (x, y, z, out) => {
    const n = noise3(x * 9, y * 9, z * 9, 3)
    const amt = clamp01(0.08 + 0.22 * smooth(0.1, 0.25, y) + 0.12 * smooth(0.1, -0.24, z) + (n - 0.5) * 0.2)
    out.r *= 1 - amt * 0.03
    out.g *= 1 - amt * 0.11
    out.b *= 1 - amt * 0.36
  })
  return merged
}

/** A 3.5" disk, lying flat: leading (shutter) edge toward -z, label toward +z. */
function buildDisk(): BufferGeometry {
  const t = 0.0033
  const w = 0.09
  const l = 0.094
  const s = new Shape()
  const c = 0.0025
  const cut = 0.008
  s.moveTo(-w / 2 + c, -l / 2)
  s.lineTo(w / 2 - c, -l / 2)
  s.lineTo(w / 2, -l / 2 + c)
  s.lineTo(w / 2, l / 2 - cut)
  s.lineTo(w / 2 - cut, l / 2)
  s.lineTo(-w / 2 + c, l / 2)
  s.lineTo(-w / 2, l / 2 - c)
  s.lineTo(-w / 2, -l / 2 + c)
  s.closePath()
  const body = new ExtrudeGeometry(s, {
    depth: t - 0.0008,
    bevelEnabled: true,
    bevelThickness: 0.0004,
    bevelSize: 0.0004,
    bevelSegments: 1,
    curveSegments: 3,
  })
  body.translate(0, 0, -(t - 0.0008) / 2)
  // plan (x, y) -> (x, -z): plan +y is the leading edge, so flip to put it at -z
  body.rotateX(-Math.PI / 2)
  const shutter = new BoxGeometry(0.034, 0.0011, 0.03)
  const slot = new BoxGeometry(0.0125, 0.0013, 0.022)
  const wp = new BoxGeometry(0.0045, 0.0012, 0.0045)
  return mergeParts([
    part(body, { color: '#243a93', tile: 0.03, crease: 0.9 }),
    part(shutter, { pos: [0.01, t / 2 + 0.0002, -l / 2 + 0.018], color: '#c3c6ce', tile: 0.03, crease: 0.6 }),
    part(slot, { pos: [0.014, t / 2 + 0.0005, -l / 2 + 0.019], color: '#23252b', tile: 0, crease: 0.6 }),
    part(wp, { pos: [w / 2 - 0.007, 0, l / 2 - 0.006], color: '#0b0b0d', tile: 0, crease: 0.6 }),
  ])
}

/** the boot disk's label: marker on a paper label. The lines sit in the
    bottom third — the strip that still shows when the disk is seated. */
function floppyLabel() {
  return makeDecal(512, 300, (ctx, w, h) => {
    ctx.fillStyle = '#efece0'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#b8342c'
    ctx.fillRect(0, 0, w, 30)
    ctx.strokeStyle = 'rgba(70,90,150,0.2)'
    ctx.lineWidth = 2
    for (let y = 70; y < 190; y += 40) {
      ctx.beginPath()
      ctx.moveTo(18, y)
      ctx.lineTo(w - 18, y)
      ctx.stroke()
    }
    drawSpaced(ctx, 'HD  1.44MB', 22, 152, "600 22px 'Helvetica Neue', Arial, sans-serif", '#6b6a63', 2)
    ctx.fillStyle = '#1d2f7c'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = "700 60px 'Marker Felt', 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive"
    ctx.fillText('SOUBHIKOS 4.01', w / 2, 218)
    ctx.font = "700 76px 'Marker Felt', 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive"
    ctx.fillText('BOOT', w / 2, 270)
  })
}

/** SOUBHIK SYSTEMS on a small satin plate */
function badgeDecal() {
  return makeDecal(768, 96, (ctx, w, h) => {
    ctx.fillStyle = '#b9b7ae'
    ctx.fillRect(0, 0, w, h)
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, 'rgba(255,255,255,0.35)')
    g.addColorStop(1, 'rgba(0,0,0,0.12)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    drawSpaced(ctx, 'SOUBHIK SYSTEMS', w / 2, h / 2 + 2, "700 50px 'Helvetica Neue', Arial, sans-serif", '#3f3c35', 8, 'center')
  })
}

function TowerBody() {
  const view = useSystem((s) => s.view)
  const powerOn = useSystem((s) => s.powerOn)

  // the case shell is the heaviest build in the tower: its own turn of
  // the staged first load (stage.ts)
  const shell = useStagedSteps('tower.shell', buildShellSteps)
  const plastic = useMemo(() => sharedPlastic(), [])
  const mhzTex = useMemo(
    () => makeLabel('486 66', P.termGreen, '#071009', 6, 6),
    [],
  )
  const floppyTex = useMemo(() => floppyLabel(), [])
  const cdTex = useMemo(
    () => makeLabel(CD_LABEL, '#1a1812', '#eceadf', 4, 3),
    [],
  )
  const badgeTex = useMemo(() => badgeDecal(), [])
  const dust = useMemo(() => grimeTexture(41, 512, 0.6), [])
  useEffect(() => () => shell?.dispose(), [shell])
  useEffect(
    () => () => {
      plastic.dispose()
      mhzTex.dispose()
      floppyTex.dispose()
      cdTex.dispose()
      badgeTex.dispose()
      dust.dispose()
    },
    [plastic, mhzTex, floppyTex, cdTex, badgeTex, dust],
  )

  if (!shell) return null
  return (
    <group position={TOWER_POS} rotation-y={TOWER_YAW}>
      {/* chassis + bezel — the whole case is a power switch (the dedicated
          button is tiny from across the room) */}
      <Clickable
        enabled={view === 'room'}
        label="power"
        onActivate={() => {
          playClick()
          powerOn()
        }}
      >
        <mesh geometry={shell} castShadow receiveShadow>
          <meshStandardMaterial
            color="#e0d8c2"
            roughness={0.66}
            vertexColors
            normalMap={plastic.normalMap}
            normalScale={[0.4, 0.4]}
            roughnessMap={plastic.roughnessMap}
          />
        </mesh>
      </Clickable>

      {/* a film of dust and hand oil on the top plate */}
      <mesh
        position={[0, Y_TOP + 0.0003, -0.005]}
        rotation-x={-Math.PI / 2}
        renderOrder={3}
      >
        <planeGeometry args={[TOWER_SIZE.w - 0.012, FRONT * 2 - 0.02]} />
        <meshStandardMaterial
          map={dust}
          transparent
          opacity={0.5}
          roughness={1}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>

      <FloppyDrive enabled={view === 'room'} labelTex={floppyTex} />
      <CdTray labelTex={cdTex} />

      <LedCluster mhzTex={mhzTex} />
      <PowerButton enabled={view === 'room'} onPower={powerOn} />
      <Fan />

      {/* badge */}
      <mesh position={[0, -0.212, PANEL_FACE + 0.0012]}>
        <planeGeometry args={[0.08, 0.01]} />
        <meshStandardMaterial map={badgeTex} roughness={0.4} metalness={0.5} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
    </group>
  )
}

/* ---------- second bay: a CD-ROM drive, its disc labelled (E-5) ----------
   The sticker is a real line from the resume — the shortest
   certification, so it stays readable on a 4 cm tray. */
const CD_LABEL = [...certifications]
  .map((c) => c.replace(/\s*\(.*$/, '').toUpperCase())
  .sort((a, b) => a.length - b.length)[0]

function CdTray({ labelTex }: { labelTex: ReturnType<typeof makeLabel> }) {
  const led = useRef<MeshStandardMaterial>(null!)
  useFrame((_, delta) => {
    const powered = useSystem.getState().power !== 'off'
    led.current.emissiveIntensity = MathUtils.damp(
      led.current.emissiveIntensity,
      powered ? 0.35 : 0,
      6,
      Math.min(delta, 0.05),
    )
  })
  return (
    <group position={[0, BAY.cd, PANEL_FACE]}>
      {/* the sticker on the tray front */}
      <mesh position={[-0.004, 0.0052, 0.00415]}>
        <planeGeometry args={[0.052, 0.0105]} />
        <meshBasicMaterial map={labelTex} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      {/* busy light */}
      <mesh position={[0.038, -0.0125, 0.0041]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.0016, 0.0016, 0.0008, 10]} />
        <meshStandardMaterial ref={led} color="#1c3a12" emissive={P.ledGreen} emissiveIntensity={0} />
      </mesh>
    </group>
  )
}

/* ---------- floppy drive + springy disk (easter egg) ---------- */
function FloppyDrive({
  enabled,
  labelTex,
}: {
  enabled: boolean
  labelTex: ReturnType<typeof makeLabel>
}) {
  const powered = useSystem((s) => s.power !== 'off')
  const floppyOut = useRoom((s) => s.floppyOut)
  const toggleFloppy = useRoom((s) => s.toggleFloppy)

  const disk = useRef<Group>(null!)
  const spring = useRef({ z: 0.012, v: 0 })
  const driveLed = useRef<MeshStandardMaterial>(null!)
  const diskGeo = useMemo(() => buildDisk(), [])
  useEffect(() => () => diskGeo.dispose(), [diskGeo])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    // underdamped spring so ejecting pops and settles with a wobble
    const target = floppyOut ? 0.062 : 0.012
    const s = spring.current
    const accel = 260 * (target - s.z) - 14 * s.v
    s.v += accel * dt
    s.z += s.v * dt
    // 2 cm of the label end shows when seated; the pop lifts it to ~5 cm
    disk.current.position.z = PANEL_FACE - 0.027 + (s.z - 0.012) * 0.6
    driveLed.current.emissiveIntensity = MathUtils.damp(
      driveLed.current.emissiveIntensity,
      powered && !floppyOut ? 1.4 : 0,
      8,
      dt,
    )
  })

  const slotY = BAY.floppy + 0.0075
  return (
    <Clickable
      enabled={enabled}
      label="the a: drive"
      onActivate={() => {
        playClick()
        if (!useRoom.getState().floppyOut) useWorld.getState().mark('floppy')
        toggleFloppy()
      }}
    >
      {/* invisible hit plate over the whole 5.25" bay */}
      <mesh position={[0, BAY.floppy, PANEL_FACE + 0.004]} visible={false}>
        <planeGeometry args={[0.15, 0.043]} />
      </mesh>
      {/* the disk itself, label end poking from the slot */}
      <group ref={disk} position={[0, slotY, PANEL_FACE - 0.027]}>
        <mesh geometry={diskGeo} castShadow>
          <meshStandardMaterial vertexColors roughness={0.5} />
        </mesh>
        {/* label: the boot disk */}
        <mesh position={[0, 0.00185, 0.024]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.062, 0.036]} />
          <meshStandardMaterial map={labelTex} roughness={0.9} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      </group>
      {/* eject button */}
      <mesh position={[0.056, BAY.floppy - 0.0105, PANEL_FACE + 0.0044]}>
        <roundedBoxGeometry args={rb(0.0098, 0.004, 0.0016, 0.0008, 2)} />
        <meshStandardMaterial color="#d6cfb9" roughness={0.6} />
      </mesh>
      {/* drive activity LED */}
      <mesh position={[-0.056, BAY.floppy - 0.0105, PANEL_FACE + 0.0038]}>
        <roundedBoxGeometry args={rb(0.0072, 0.0036, 0.0016, 0.0007, 2)} />
        <meshStandardMaterial
          ref={driveLed}
          color="#1c2f14"
          emissive={P.ledGreen}
          emissiveIntensity={0}
        />
      </mesh>
      <Halo
        source={driveLed}
        color={P.ledGreen}
        size={0.02}
        intensity={0}
        position={[-0.056, BAY.floppy - 0.0105, PANEL_FACE + 0.0062]}
      />
    </Clickable>
  )
}

/* ---------- LED cluster + MHz display ---------- */
function LedCluster({ mhzTex }: { mhzTex: ReturnType<typeof makeLabel> }) {
  const powerLed = useRef<MeshStandardMaterial>(null!)
  const hddLed = useRef<MeshStandardMaterial>(null!)
  const mhzMat = useRef<MeshBasicMaterial>(null!)

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    const powered = useSystem.getState().power !== 'off'

    if (powered) {
      powerLed.current.emissive.set(P.ledGreen)
      powerLed.current.emissiveIntensity = 1.8
      // pseudo-random disk chatter
      const n = Math.sin(Math.floor(t * 12.7) * 947.31) * 0.5 + 0.5
      hddLed.current.emissiveIntensity = n > 0.62 ? 1.6 : 0.04
    } else {
      // standby heartbeat — the blink that keeps the dark room alive
      powerLed.current.emissive.set(P.amber)
      powerLed.current.emissiveIntensity =
        0.25 + Math.max(0, Math.sin(t * 2.1)) ** 6 * 1.3
      hddLed.current.emissiveIntensity = 0
    }
    mhzMat.current.opacity = MathUtils.damp(
      mhzMat.current.opacity,
      powered ? 1 : 0.08,
      6,
      dt,
    )
  })

  return (
    <group position={[0, STRIP_Y, PANEL_FACE]}>
      {/* power + hdd LED lenses */}
      <mesh position={[-0.07, 0, 0.0021]}>
        <roundedBoxGeometry args={rb(0.008, 0.0042, 0.0018, 0.0008, 2)} />
        <meshStandardMaterial
          ref={powerLed}
          color="#2e2416"
          emissive={P.amber}
          emissiveIntensity={0.3}
        />
      </mesh>
      <mesh position={[-0.045, 0, 0.0021]}>
        <roundedBoxGeometry args={rb(0.008, 0.0042, 0.0018, 0.0008, 2)} />
        <meshStandardMaterial
          ref={hddLed}
          color="#33150f"
          emissive={P.ledRed}
          emissiveIntensity={0}
        />
      </mesh>
      <Halo
        source={powerLed}
        color={P.amber}
        size={0.02}
        intensity={0.1}
        position={[-0.07, 0, 0.0038]}
      />
      <Halo
        source={hddLed}
        color={P.ledRed}
        size={0.017}
        intensity={0}
        position={[-0.045, 0, 0.0038]}
      />
      {/* the lit MHz readout in its recessed window */}
      <mesh position={[0.045, 0, 0.0025]}>
        <planeGeometry args={[0.056, 0.0146]} />
        <meshBasicMaterial
          ref={mhzMat}
          map={mhzTex}
          transparent
          opacity={0.08}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

/* ---------- power button (easter egg: boots the machine) ---------- */
function PowerButton({
  enabled,
  onPower,
}: {
  enabled: boolean
  onPower: () => void
}) {
  const btn = useRef<Group>(null!)
  const pressed = useRef(0)
  const icon = useMemo(
    () =>
      makeDecal(128, 128, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h)
        ctx.strokeStyle = '#3d3a32'
        ctx.lineWidth = 11
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.arc(w / 2, h / 2 + 4, 34, -Math.PI / 2 + 0.6, -Math.PI / 2 - 0.6 + Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(w / 2, h / 2 - 44)
        ctx.lineTo(w / 2, h / 2 - 6)
        ctx.stroke()
      }),
    [],
  )
  useEffect(() => () => icon.dispose(), [icon])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    pressed.current = MathUtils.damp(pressed.current, 0, 10, dt)
    btn.current.position.z = PANEL_FACE + 0.0058 - pressed.current * 0.004
  })

  return (
    <Clickable
      enabled={enabled}
      label="power"
      onActivate={() => {
        pressed.current = 1
        playClick()
        onPower()
      }}
    >
      <group ref={btn} position={[POWER.x, POWER.y, PANEL_FACE + 0.0058]}>
        <mesh castShadow>
          <roundedBoxGeometry args={rb(0.036, 0.022, 0.008, 0.003, 3)} />
          <meshStandardMaterial color="#e3dcc7" roughness={0.55} />
        </mesh>
        <mesh position={[0, 0, 0.0041]}>
          <planeGeometry args={[0.014, 0.014]} />
          <meshBasicMaterial map={icon} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      </group>
    </Clickable>
  )
}

/* ---------- intake fan, spins while powered ---------- */
function Fan() {
  const blades = useRef<Group>(null!)
  const speed = useRef(0)
  const geo = useMemo(() => {
    const parts: BufferGeometry[] = []
    parts.push(part(new CylinderGeometry(0.0085, 0.0085, 0.004, 16), { rot: [Math.PI / 2, 0, 0], color: '#5b5d62' }))
    for (let i = 0; i < 7; i++) {
      // a pitched blade: twist about its own radial axis, then swing round the hub
      const blade = new BoxGeometry(0.012, 0.03, 0.0012)
      blade.rotateY(0.5)
      blade.translate(0, 0.0215, 0)
      blade.rotateZ((i / 7) * Math.PI * 2)
      parts.push(part(blade, { color: '#4b4d52', crease: 0.6 }))
    }
    return mergeParts(parts)
  }, [])
  useEffect(() => () => geo.dispose(), [geo])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const powered = useSystem.getState().power !== 'off'
    speed.current = MathUtils.damp(speed.current, powered ? 16 : 0, 1.6, dt)
    blades.current.rotation.z -= speed.current * dt
  })

  return (
    <group ref={blades} position={[FAN.x, FAN.y, PANEL_FACE + 0.0022]}>
      <mesh geometry={geo}>
        <meshStandardMaterial vertexColors roughness={0.7} />
      </mesh>
    </group>
  )
}

/* first load: mounted in its own turn of the staged build (stage.ts) */
export default function Tower() {
  return (
    <Staged id="tower">
      <TowerBody />
    </Staged>
  )
}
