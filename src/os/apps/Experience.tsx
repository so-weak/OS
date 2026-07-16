import { useWindows } from '../store'
import { experience, projects } from '../../data/resume'
import { playClick } from '../sound'
import './apps.css'

/* =====================================================================
   Experience — vertical timeline of the jobs in resume.ts. Each era gets
   an LED (green + blinking while "Present"), and jobs with projectIds
   grow chips that deep-link into the Projects app detail view.
   ===================================================================== */

/**
 * Open Projects focused on a specific project. `openApp` ignores new
 * props for an already-open single-instance window, so if a Projects
 * window exists we close it first and reopen with the deep-link.
 */
function openProject(projectId: string) {
  playClick()
  const ws = useWindows.getState()
  const existing = ws.windows.find((w) => w.appId === 'projects')
  if (existing) ws.close(existing.id)
  ws.openApp('projects', { projectId })
}

export default function Experience() {
  return (
    <div className="app">
      <div className="xp-scroll well">
        {experience.map((job, i) => {
          const current = job.period.includes('Present')
          const last = i === experience.length - 1
          return (
            <div key={job.company} className="xp-entry">
              <div className="xp-rail">
                <span
                  className={`xp-led${current ? ' on' : ''}`}
                  title={current ? 'status: shipping' : 'era archived'}
                />
                {!last && <span className="xp-line" />}
              </div>

              <div className="xp-card">
                <div className="xp-head">
                  <span className="xp-company">{job.company}</span>
                  <span className="xp-period">{job.period}</span>
                </div>
                <div className="xp-role">{job.role}</div>
                <div className="xp-loc">{job.location}</div>

                <ul className="xp-bullets">
                  {job.bullets.map((b, bi) => (
                    <li key={bi}>{b}</li>
                  ))}
                </ul>

                {job.projectIds && job.projectIds.length > 0 && (
                  <div className="xp-chips">
                    {job.projectIds.map((pid) => {
                      const p = projects.find((pp) => pp.id === pid)
                      if (!p) return null
                      return (
                        <button
                          key={pid}
                          type="button"
                          className="chip-btn"
                          title={`open ${p.name} in My Work`}
                          onClick={() => openProject(pid)}
                        >
                          {p.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="app-status">
        <span>{experience.length} era(s) logged, zero regressions</span>
        <span className="fit">chips open My Work</span>
      </div>
    </div>
  )
}
