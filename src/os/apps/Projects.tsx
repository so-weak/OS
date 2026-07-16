import { useEffect, useState } from 'react'
import type { AppProps } from '../registry'
import { useWindows } from '../store'
import { projects } from '../../data/resume'
import type { Project } from '../../data/resume'
import { AppIcon } from '../icons/AppIcon'
import { playClick } from '../sound'
import { CATEGORY_LABEL, CATEGORY_ORDER } from './helpers'
import { PixelPattern, ProjectArt } from './shared'
import { useToast } from './useToast'
import './apps.css'

/* =====================================================================
   My Work — explorer-style browser over every project in resume.ts.
   List view: category sidebar + icon grid. Clicking a project swaps the
   same window into a detail view (window title follows via setTitle).
   Accepts props.projectId to deep-link straight into a detail view.
   ===================================================================== */

type Filter = 'all' | Project['category']

const APP_TITLE = 'My Work'

export default function Projects({ windowId, props }: AppProps) {
  const setTitle = useWindows((s) => s.setTitle)
  const { toast, show } = useToast()

  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const pid = props?.projectId
    return typeof pid === 'string' && projects.some((p) => p.id === pid)
      ? pid
      : null
  })

  const selected = selectedId
    ? (projects.find((p) => p.id === selectedId) ?? null)
    : null

  useEffect(() => {
    setTitle(windowId, selected ? selected.name : APP_TITLE)
  }, [selected, setTitle, windowId])

  const visible =
    filter === 'all' ? projects : projects.filter((p) => p.category === filter)

  const path = selected
    ? `C:\\SoubhikOS\\Work\\${selected.id}.prj`
    : `C:\\SoubhikOS\\Work\\${filter === 'all' ? '*' : filter}`

  return (
    <div className="app">
      <div className="app-toolbar">
        <button
          type="button"
          className="btn"
          disabled={!selected}
          style={selected ? undefined : { color: 'var(--face-dark)' }}
          onClick={() => {
            playClick()
            setSelectedId(null)
          }}
        >
          <AppIcon name="back" size={16} />
          Back
        </button>
        <span className="tool-sep" />
        <span className="prj-address" title={path}>
          <AppIcon name="folder" size={16} />
          {path}
        </span>
      </div>

      {selected ? (
        <DetailView project={selected} onOpenLink={show} />
      ) : (
        <div className="prj-body">
          <div className="prj-side">
            <div className="prj-side-label t-label">folders</div>
            <button
              type="button"
              className={`prj-cat${filter === 'all' ? ' active' : ''}`}
              onClick={() => {
                if (filter !== 'all') playClick()
                setFilter('all')
              }}
            >
              <AppIcon name="folder-work" size={16} />
              All Projects
              <span className="count">{projects.length}</span>
            </button>
            {CATEGORY_ORDER.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`prj-cat${filter === cat ? ' active' : ''}`}
                onClick={() => {
                  if (filter !== cat) playClick()
                  setFilter(cat)
                }}
              >
                <AppIcon name="folder" size={16} />
                {CATEGORY_LABEL[cat]}
                <span className="count">
                  {projects.filter((p) => p.category === cat).length}
                </span>
              </button>
            ))}
          </div>

          <div className="prj-main well">
            {(filter === 'all' ? CATEGORY_ORDER : [filter]).map((cat) => {
              const group = projects.filter((p) => p.category === cat)
              if (!group.length) return null
              return (
                <div key={cat}>
                  <div className="prj-group-head t-label">
                    {CATEGORY_LABEL[cat]}
                  </div>
                  <div className="prj-grid">
                    {group.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="prj-item"
                        onClick={() => {
                          playClick()
                          setSelectedId(p.id)
                        }}
                        title={p.tagline}
                      >
                        <span className="prj-item-thumb">
                          <PixelPattern seed={p.id} category={p.category} />
                        </span>
                        <span className="prj-item-label">{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="app-status">
        <span>
          {selected
            ? `${selected.stack.length} component(s) loaded`
            : `${visible.length} object(s)`}
        </span>
        <span className="fit">
          {selected ? selected.org : 'zero vaporware detected'}
        </span>
      </div>

      {toast}
    </div>
  )
}

/* ---------- detail view ---------- */

function DetailView({
  project,
  onOpenLink,
}: {
  project: Project
  onOpenLink: (msg: string) => void
}) {
  return (
    <div className="prj-detail well">
      <div className="prj-hero">
        <ProjectArt project={project} />
      </div>

      <div className="prj-name">{project.name}</div>
      <div className="prj-tagline">{project.tagline}</div>

      <div className="prj-badges">
        <span
          className={`prj-badge${project.org === 'Open Source' ? ' oss' : ''}`}
        >
          {project.org}
        </span>
        {CATEGORY_LABEL[project.category] !== project.org && (
          <span className="chip">{CATEGORY_LABEL[project.category]}</span>
        )}
      </div>

      <div className="prj-section t-label">stack</div>
      <div>
        {project.stack.map((s) => (
          <span key={s} className="chip">
            {s}
          </span>
        ))}
      </div>

      <div className="prj-section t-label">what shipped</div>
      <ul className="prj-bullets">
        {project.bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>

      {project.links && project.links.length > 0 && (
        <div className="prj-links">
          {project.links.map((l) => (
            <button
              key={l.url}
              type="button"
              className="btn"
              onClick={() => {
                window.open(l.url, '_blank', 'noopener')
                onOpenLink('opening in a browser from 30 years in the future…')
              }}
            >
              <AppIcon name="doc" size={16} />
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
