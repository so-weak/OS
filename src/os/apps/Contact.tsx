import { useEffect, useRef, useState } from 'react'
import { identity } from '../../data/resume'
import { AppIcon } from '../icons/AppIcon'
import { playBeep, playClick } from '../sound'
import { MenuGag } from './shared'
import { useToast } from './useToast'
import './apps.css'

/* =====================================================================
   Contact — a retro mail-compose window. Send beeps, "dials out" over a
   56k modem for a moment, then hands off to the visitor's mail client
   via mailto:. Footer buttons: copy address, LinkedIn, GitHub, WhatsApp,
   phone. To: is hard-wired to identity.email (readonly).
   ===================================================================== */

const MODEM_STAGES = [
  'Picking up the handset…',
  `Dialing ${identity.phone}…`,
  'EEEE-AWWW-krrrrshhhhh…',
  'CONNECT 33600 — negotiating politeness protocol…',
  'Handing off to your mail client…',
]

export default function Contact() {
  const { toast, show } = useToast()
  const [from, setFrom] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [stage, setStage] = useState<number | null>(null)

  const timers = useRef<number[]>([])
  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
    },
    [],
  )

  const send = () => {
    if (stage !== null) return
    playBeep()
    setStage(0)
    MODEM_STAGES.forEach((_line, i) => {
      if (i === 0) return
      timers.current.push(
        window.setTimeout(() => setStage(i), i * 620),
      )
    })
    timers.current.push(
      window.setTimeout(() => {
        const subj = subject.trim() || 'Hello from SoubhikOS'
        const lines = [body.trim() || '(compose your message here)']
        if (from.trim()) lines.push('', `— ${from.trim()}`)
        lines.push('', 'Sent via Contact.exe on SoubhikOS (56k, one ring).')
        window.location.href = `mailto:${identity.email}?subject=${encodeURIComponent(
          subj,
        )}&body=${encodeURIComponent(lines.join('\n'))}`
        setStage(null)
        show('Handed off to your mail client. Carrier dropped politely.')
      }, MODEM_STAGES.length * 620),
    )
  }

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(identity.email)
      show('copied — now write something nice')
    } catch {
      show(`clipboard said no — it's ${identity.email}`)
    }
  }

  const openUrl = (url: string) => {
    playClick()
    window.open(url, '_blank', 'noopener')
  }
  const waDigits = identity.whatsapp.replace(/\D/g, '')

  return (
    <div className="app">
      <MenuGag
        onGag={show}
        items={[
          { label: 'File', line: "every option in here is just 'Send'." },
          { label: 'Edit', line: 'typos are period-correct. keep them.' },
          { label: 'Help', line: 'the best help is a strong subject line.' },
        ]}
      />

      <div className="app-toolbar">
        <button
          type="button"
          className="btn primary"
          onClick={send}
          disabled={stage !== null}
        >
          <AppIcon name="mail" size={16} />
          Send
        </button>
        <button type="button" className="btn" onClick={copyEmail}>
          Copy address
        </button>
        <span className="tool-sep" />
        <button
          type="button"
          className="btn"
          onClick={() => openUrl(identity.linkedin)}
        >
          LinkedIn
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => openUrl(identity.github)}
        >
          GitHub
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => openUrl(`https://wa.me/${waDigits}`)}
        >
          WhatsApp
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            window.location.href = `tel:${identity.phone}`
          }}
        >
          Call
        </button>
      </div>

      <div className="ctc-form">
        <div className="ctc-row">
          <label htmlFor="ctc-to">To:</label>
          <input
            id="ctc-to"
            className="field ctc-readonly"
            value={identity.email}
            readOnly
          />
        </div>
        <div className="ctc-row">
          <label htmlFor="ctc-from">From:</label>
          <input
            id="ctc-from"
            className="field"
            value={from}
            placeholder="you@yourcompany.com"
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="ctc-row">
          <label htmlFor="ctc-subj">Subject:</label>
          <input
            id="ctc-subj"
            className="field"
            value={subject}
            placeholder="Re: that role you'd be great for"
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <textarea
          className="field ctc-body"
          value={body}
          placeholder={`Dear ${identity.name.split(' ')[0]},`}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      <div className="app-status">
        <span>{stage !== null ? '56k: OFF-HOOK' : '56k: on-hook, ready'}</span>
        <span className="fit">POP3: {identity.location}</span>
      </div>

      {stage !== null && (
        <div className="ctc-modem">
          <div className="ctc-modem-box">
            <div className="ctc-modem-title">Connecting via 56k modem…</div>
            <div className="ctc-modem-body">
              <div className="ctc-modem-line">{MODEM_STAGES[stage]}</div>
              <div className="ctc-modem-bar">
                {Array.from({ length: 18 }, (_v, i) => (
                  <i key={i} style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {toast}
    </div>
  )
}
