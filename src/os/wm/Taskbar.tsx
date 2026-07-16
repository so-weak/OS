import { useEffect, useState } from 'react'
import { useSystem, useWindows, useActiveWindowId } from '../store'
import { getApp } from '../registry'
import { AppIcon } from '../icons/AppIcon'
import { playClick } from '../sound'
import { GlyphSpeaker, GlyphSpeakerMuted } from './glyphs'

/* =====================================================================
   Taskbar: Start button, one button per window (pressed = active),
   system tray with mute toggle + live clock.
   Easter egg: clicking the clock toggles seconds display.
   ===================================================================== */

export default function Taskbar() {
  const windows = useWindows((s) => s.windows)
  const startOpen = useWindows((s) => s.startOpen)
  const activeId = useActiveWindowId()
  const muted = useSystem((s) => s.muted)

  const onStartPointerDown = () => {
    // Opening happens on pointerdown; when the menu is open its backdrop
    // sits above the taskbar and swallows this event (closing the menu),
    // exactly like the real thing.
    playClick()
    useWindows.getState().setStartOpen(true)
  }

  const onWindowButton = (id: string) => {
    playClick()
    const wm = useWindows.getState()
    const win = wm.windows.find((w) => w.id === id)
    if (!win) return
    if (id === activeId && !win.minimized) wm.minimize(id)
    else wm.focus(id)
  }

  const onToggleMute = () => {
    useSystem.getState().toggleMuted()
    playClick() // audible only when the result is unmuted
  }

  return (
    <div className="taskbar">
      <button
        className={`btn start-btn${startOpen ? ' pressed' : ''}`}
        onPointerDown={onStartPointerDown}
        aria-haspopup="menu"
        aria-expanded={startOpen}
      >
        <AppIcon name="os-logo" size={16} />
        <b>Start</b>
      </button>

      <div className="tb-divider" />

      <div className="tb-wins">
        {windows.map((w) => {
          const app = getApp(w.appId)
          const pressed = w.id === activeId && !w.minimized
          return (
            <button
              key={w.id}
              className={`tb-win${pressed ? ' pressed' : ''}`}
              onClick={() => onWindowButton(w.id)}
            >
              <AppIcon name={app?.icon ?? 'default'} size={16} />
              <span>{w.title}</span>
            </button>
          )
        })}
      </div>

      <div className="tray">
        <button
          className="tray-btn"
          onClick={onToggleMute}
          title={muted ? 'Unmute' : 'Mute'}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <GlyphSpeakerMuted /> : <GlyphSpeaker />}
        </button>
        <Clock />
      </div>
    </div>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  const [showSeconds, setShowSeconds] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const p = (n: number) => String(n).padStart(2, '0')
  const label = showSeconds
    ? `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
    : `${p(now.getHours())}:${p(now.getMinutes())}`

  return (
    <span
      className="tb-clock"
      title="click for seconds"
      onClick={() => {
        playClick()
        setShowSeconds((s) => !s)
      }}
    >
      {label}
    </span>
  )
}
