import { useRef, useState } from 'react'
import { awards, certifications } from '../../data/resume'
import { AppIcon } from '../icons/AppIcon'
import { playClick } from '../sound'
import { useToast } from './useToast'
import './apps.css'

/* =====================================================================
   Awards — a trophy case. Every trophy and certificate string comes
   verbatim from resume.ts; only the shelf is fictional.
   EGG: trophies can be polished (clicked) — the shine sweep replays,
   and after enough buffing the OS asks you to stop.
   ===================================================================== */

export default function Awards() {
  const { toast, show } = useToast()
  /* bumping a card's counter remounts it with .polish → sweep replays */
  const [polish, setPolish] = useState<Record<string, number>>({})
  const buffs = useRef(0)

  const buff = (title: string) => {
    playClick()
    setPolish((p) => ({ ...p, [title]: (p[title] ?? 0) + 1 }))
    buffs.current += 1
    if (buffs.current === 3) show('polished. still shiny.')
    if (buffs.current === 7)
      show('that is enough buffing — the shine is load-bearing.')
  }

  return (
    <div className="app">
      <div className="awd-banner">
        <AppIcon name="trophy" size={28} />
        <span className="awd-banner-title">Trophy Case</span>
        <span className="awd-banner-sub t-label">
          achievements unlocked: {awards.length}/{awards.length}
        </span>
      </div>

      <div className="awd-scroll">
        <div className="awd-grid">
          {awards.map((a) => (
            <div
              key={`${a.title}#${polish[a.title] ?? 0}`}
              className={`awd-card${polish[a.title] ? ' polish' : ''}`}
              onClick={() => buff(a.title)}
              title="click to polish"
            >
              <AppIcon name="trophy" size={36} />
              <div className="awd-title">{a.title}</div>
              <div className="awd-detail">{a.detail}</div>
            </div>
          ))}
        </div>

        <div className="awd-certs">
          <div className="awd-certs-head t-label">also certified in</div>
          <div>
            {certifications.map((c) => (
              <span key={c} className="chip">
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="app-status">
        <span>
          {awards.length} trophy object(s) · dusted daily by a scheduled task
        </span>
      </div>

      {toast}
    </div>
  )
}
