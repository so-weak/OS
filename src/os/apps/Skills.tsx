import { useEffect, useRef, useState } from 'react'
import { identity, skills } from '../../data/resume'
import { AppIcon } from '../icons/AppIcon'
import { playClick } from '../sound'
import { hashString } from './helpers'
import { useToast } from './useToast'
import './apps.css'

/* =====================================================================
   Skill Manager — a Device-Manager-style tree over resume.ts skills.
   Groups expand/collapse; selecting a leaf reports "This skill is
   working properly." with a deterministic fake driver readout. All
   jokes are OS-flavored; every skill name comes verbatim from resume.ts.
   ===================================================================== */

const RESOURCE_GAGS = [
  'no conflicts.',
  'sharing nicely with adjacent skills.',
  'DMA channel clear.',
  'no reboot required.',
  'hot-swappable.',
]

function driverInfo(name: string) {
  const h = hashString(name)
  const slug = name
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 8)
    .padEnd(3, 'X')
  return {
    file: `${slug}.SYS`,
    version: `4.${h % 10}.${100 + ((h >>> 3) % 900)}`,
    irq: h % 16,
    gag: RESOURCE_GAGS[(h >>> 7) % RESOURCE_GAGS.length],
  }
}

export default function Skills() {
  const { toast, show } = useToast()
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const first = skills[0]
    return first ? { [first.label]: true } : {}
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const scanTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (scanTimer.current !== null) window.clearTimeout(scanTimer.current)
    },
    [],
  )

  const totalSkills = skills.reduce((n, g) => n + g.items.length, 0)

  const scan = () => {
    if (scanning) return
    setScanning(true)
    scanTimer.current = window.setTimeout(() => {
      setScanning(false)
      setExpanded(Object.fromEntries(skills.map((g) => [g.label, true])))
      show('No new skills found. Recruiter drivers already up to date.')
    }, 1400)
  }

  const info = selected ? driverInfo(selected) : null

  return (
    <div className="app">
      <div className="app-toolbar">
        <button type="button" className="btn" onClick={scan}>
          <AppIcon name="chip" size={16} />
          {scanning ? 'Scanning…' : 'Scan for new skills'}
        </button>
        <span className="tool-spring" />
        <span className="t-label t-soft">{totalSkills} devices detected</span>
      </div>

      <div className="skl-tree well">
        <div className="skl-root">
          <AppIcon name="chip" size={16} />
          SOUBHIK-WORKSTATION
        </div>

        {skills.map((group) => {
          const open = !!expanded[group.label]
          return (
            <div key={group.label}>
              <button
                type="button"
                className="skl-row group"
                onClick={() => {
                  playClick()
                  setExpanded((e) => ({ ...e, [group.label]: !open }))
                }}
              >
                <span className="skl-toggle">{open ? '−' : '+'}</span>
                <AppIcon name="chip" size={16} />
                {group.label}
                <span className="skl-count">({group.items.length})</span>
              </button>

              {open &&
                group.items.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`skl-row leaf${
                      selected === item ? ' selected' : ''
                    }`}
                    onClick={() => {
                      if (selected !== item) playClick()
                      setSelected(item)
                    }}
                  >
                    <span className="skl-leaf-dot" />
                    {item}
                  </button>
                ))}
            </div>
          )
        })}
      </div>

      <div className="skl-status">
        <div className="t-label t-soft">device status</div>
        {scanning ? (
          <>
            <div className="skl-status-ok">Probing expansion slots…</div>
            <div className="skl-scanbar">
              <i />
            </div>
          </>
        ) : info && selected ? (
          <>
            <div className="skl-status-name">{selected}</div>
            <div className="skl-status-ok">
              This skill is working properly.
            </div>
            <div className="skl-status-meta">
              Driver: {info.file} · v{info.version} · Provider: {identity.name}
              <br />
              Resources: IRQ {info.irq} — {info.gag}
            </div>
            <div className="skl-status-btns">
              <button
                type="button"
                className="btn"
                onClick={() => show('Already at the bleeding edge.')}
              >
                Update Driver…
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  show('Access denied: this skill is load-bearing.')
                }
              >
                Disable
              </button>
            </div>
          </>
        ) : (
          <div className="skl-empty">
            Select a skill to query its driver. They all pass POST.
          </div>
        )}
      </div>

      <div className="app-status">
        <span>
          {skills.length} device classes · {totalSkills} skills · 0 conflicts
        </span>
      </div>

      {toast}
    </div>
  )
}
