import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  authors,
  books,
  fullByline,
  genres,
  readDate,
  selectBooks,
  SHELF_TABS,
  SORT_MODES,
  type Book,
  type ShelfTab,
  type SortMode,
} from '../data/library'
import { navigate } from '../router'
import BookSpread from './BookSpread'
import { Cover, Spine, Stars } from './pieces'
import './catalogue.css'

/* =====================================================================
   THE STACKS — the catalogue at /library.

   The 3D shelf in the room is the doorway; this is the reading room.
   Everything a shelf is bad at — typing, filtering, scanning a hundred
   titles, deep links, a phone — happens here, in paper and oak.

   Still read-only: the whole catalogue is static data authored in
   src/data/library/books.ts. There is no endpoint to add a book,
   because there is no server.
   ===================================================================== */

type View = 'shelf' | 'cards'

interface Query {
  text: string
  shelf: ShelfTab
  genre: string | null
  author: string | null
  sort: SortMode
}

const DEFAULTS: Query = {
  text: '',
  shelf: 'all',
  genre: null,
  author: null,
  sort: 'latest',
}

/* ---------- the query lives in the URL, so a shelf is shareable ---------- */

function readQuery(): Query {
  const p = new URLSearchParams(window.location.search)
  const shelf = p.get('shelf')
  const sort = p.get('sort')
  return {
    text: p.get('q') ?? '',
    shelf: SHELF_TABS.some((t) => t.id === shelf) ? (shelf as ShelfTab) : 'all',
    genre: p.get('genre'),
    author: p.get('author'),
    sort: SORT_MODES.some((s) => s.id === sort) ? (sort as SortMode) : 'latest',
  }
}

function writeQuery(q: Query): void {
  const p = new URLSearchParams()
  if (q.text) p.set('q', q.text)
  if (q.shelf !== 'all') p.set('shelf', q.shelf)
  if (q.genre) p.set('genre', q.genre)
  if (q.author) p.set('author', q.author)
  if (q.sort !== 'latest') p.set('sort', q.sort)
  const search = p.toString()
  const url = window.location.pathname + (search ? `?${search}` : '')
  window.history.replaceState(null, '', url)
}

/* ---------- reading ledger ---------- */

function stats(): { label: string; value: string }[] {
  const read = books.filter((b) => b.status === 'read')
  const rated = read.filter((b) => b.rating)
  const year = new Date().getFullYear().toString()
  const avg = rated.length
    ? (rated.reduce((sum, b) => sum + (b.rating ?? 0), 0) / rated.length).toFixed(1)
    : '—'
  return [
    { label: 'volumes', value: String(books.length) },
    {
      label: `finished in ${year}`,
      value: String(books.filter((b) => b.finished?.startsWith(year)).length),
    },
    { label: 'reading now', value: String(books.filter((b) => b.status === 'reading').length) },
    { label: 'average stars', value: avg },
  ]
}

export default function LibraryPage({ bookId }: { bookId: string | null }) {
  const [query, setQuery] = useState<Query>(readQuery)
  const [view, setView] = useState<View>('shelf')
  const search = useRef<HTMLInputElement>(null)

  const set = useCallback((patch: Partial<Query>) => {
    setQuery((q) => {
      const next = { ...q, ...patch }
      writeQuery(next)
      return next
    })
  }, [])

  const results = useMemo(
    () => selectBooks({ ...query, tab: query.shelf }),
    [query],
  )
  const open = bookId ? (books.find((b) => b.id === bookId) ?? null) : null

  /* the room hides page overflow; a page needs to scroll */
  useEffect(() => {
    const html = document.documentElement
    html.classList.add('page-scroll')
    return () => html.classList.remove('page-scroll')
  }, [])

  useEffect(() => {
    document.title = open
      ? `${open.title} — The Stacks`
      : 'The Stacks — Soubhik Ghosh’s library'
  }, [open])

  /* "/" focuses the search, the way every catalogue terminal should */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      e.preventDefault()
      search.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openBook = useCallback((id: string) => {
    navigate({ name: 'library', bookId: id })
    window.scrollTo({ top: 0 })
  }, [])

  if (open) {
    return (
      <BookSpread
        book={open}
        siblings={results.length ? results : books}
        onOpen={openBook}
      />
    )
  }

  const cleared =
    query.text === '' &&
    query.shelf === 'all' &&
    query.genre === null &&
    query.author === null

  return (
    <div className="cat">
      <header className="cat-head">
        <button
          type="button"
          className="cat-back"
          onClick={() => navigate({ name: 'room' })}
        >
          ◂ back to the room
        </button>

        <div className="plate">
          <span className="plate-name">THE STACKS</span>
          <span className="plate-sub">from the library of Soubhik Ghosh</span>
        </div>

        <ul className="ledger">
          {stats().map((s) => (
            <li key={s.label}>
              <b>{s.value}</b>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      </header>

      <section className="card-rail">
        {/* guide-card tabs, the way they ride above the cards in a drawer */}
        <nav className="tabs" aria-label="shelves">
          {SHELF_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab${query.shelf === t.id ? ' on' : ''}`}
              aria-pressed={query.shelf === t.id}
              onClick={() => set({ shelf: t.id })}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="card">
          <div className="card-line">
            <label className="card-key" htmlFor="cat-search">
              search
            </label>
            <input
              ref={search}
              id="cat-search"
              className="card-input"
              type="search"
              placeholder="a title, an author, a mood…"
              value={query.text}
              autoComplete="off"
              onChange={(e) => set({ text: e.target.value })}
            />
            <kbd className="slash">/</kbd>
          </div>

          <div className="card-line facets">
            <span className="card-key">genre</span>
            <div className="chips">
              <button
                type="button"
                className={`chip${query.genre === null ? ' on' : ''}`}
                onClick={() => set({ genre: null })}
              >
                every genre
              </button>
              {genres.map((g) => (
                <button
                  key={g.name}
                  type="button"
                  className={`chip${query.genre === g.name ? ' on' : ''}`}
                  onClick={() => set({ genre: query.genre === g.name ? null : g.name })}
                >
                  {g.name} <i>{g.count}</i>
                </button>
              ))}
            </div>
          </div>

          <div className="card-line facets">
            <span className="card-key">author</span>
            <select
              className="card-select"
              value={query.author ?? ''}
              onChange={(e) => set({ author: e.target.value || null })}
            >
              <option value="">every author</option>
              {authors.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                  {a.count > 1 ? ` (${a.count})` : ''}
                </option>
              ))}
            </select>

            <span className="card-key">sorted by</span>
            <select
              className="card-select"
              value={query.sort}
              onChange={(e) => set({ sort: e.target.value as SortMode })}
            >
              {SORT_MODES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label.toLowerCase()}
                </option>
              ))}
            </select>

            <span className="card-spring" />

            <div className="view-toggle" role="group" aria-label="view">
              <button
                type="button"
                className={view === 'shelf' ? 'on' : ''}
                onClick={() => setView('shelf')}
              >
                shelf
              </button>
              <button
                type="button"
                className={view === 'cards' ? 'on' : ''}
                onClick={() => setView('cards')}
              >
                cards
              </button>
            </div>
          </div>

          <div className="card-foot">
            <span>
              {results.length} of {books.length} volumes
            </span>
            {!cleared && (
              <button type="button" className="clear" onClick={() => set(DEFAULTS)}>
                clear the slip
              </button>
            )}
          </div>
        </div>
      </section>

      <main className="cat-main">
        {results.length === 0 && (
          <p className="nothing">
            Nothing on this shelf{query.text ? ` for “${query.text}”` : ''}.
          </p>
        )}

        {view === 'shelf' && results.length > 0 && (
          <ShelfView
            books={results}
            byYear={query.shelf === 'latest'}
            onOpen={openBook}
          />
        )}

        {view === 'cards' && results.length > 0 && (
          <ul className="grid">
            {results.map((b) => (
              <li key={b.id}>
                <button type="button" className="grid-item" onClick={() => openBook(b.id)}>
                  <Cover book={b} />
                  <span className="grid-title">{b.title}</span>
                  <span className="grid-by">{fullByline(b)}</span>
                  <span className="grid-meta">
                    <Stars rating={b.rating} />
                    {b.finished && <i>{readDate(b.finished)}</i>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="cat-foot">
        <p>
          The catalogue is authored in code — <code>src/data/library/books.ts</code> — and
          served as static files. Nothing on this page can add, edit or remove a volume;
          books arrive by commit, scanned in by ISBN.
        </p>
      </footer>
    </div>
  )
}

/* ---------- the shelf: spines at their true proportions ---------- */

const ROW = 286

function ShelfView({
  books: list,
  byYear,
  onOpen,
}: {
  books: Book[]
  byYear: boolean
  onOpen: (id: string) => void
}) {
  /* LATEST reads as a reading log — a shelf per year they were finished.
     Every other shelf is one continuous run, the way a shelf really is. */
  const groups = useMemo(() => {
    const out = new Map<string, Book[]>()
    for (const b of list) {
      const key = b.finished ? b.finished.slice(0, 4) : ''
      const bucket = out.get(key)
      if (bucket) bucket.push(b)
      else out.set(key, [b])
    }
    return [...out.entries()]
  }, [list])

  const grouped = byYear && groups.length > 1 && groups.every(([year]) => year)

  if (!grouped) {
    return <Shelf books={list} onOpen={onOpen} />
  }
  return (
    <>
      {groups.map(([year, group]) => (
        <section key={year} className="shelf-group">
          <h2 className="year">
            {year} <i>{group.length} volumes</i>
          </h2>
          <Shelf books={group} onOpen={onOpen} />
        </section>
      ))}
    </>
  )
}

function Shelf({ books: list, onOpen }: { books: Book[]; onOpen: (id: string) => void }) {
  return (
    <div className="shelf" style={{ ['--row' as string]: `${ROW}px` }}>
      {list.map((b) => (
        <Spine key={b.id} book={b} rowHeight={ROW - 30} onOpen={onOpen} />
      ))}
      {/* brass bookend, holding up whatever the shelf has */}
      <span className="bookend" aria-hidden />
    </div>
  )
}
