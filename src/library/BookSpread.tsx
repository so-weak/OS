import { useEffect, useMemo, useRef } from 'react'
import { fullByline, readDate, type Book } from '../data/library'
import { navigate } from '../router'
import { useFontsReady } from '../useFontsReady'
import { barcodeCanvas, shelfMark } from './art'
import { Cover, Stars } from './pieces'

/* =====================================================================
   One volume, opened: the cloth board on the left, the bookplate on the
   right — the same two faces you see when you pull the book off the 3D
   shelf and turn it over.

   The bookplate is real text here rather than a drawing, so it can be
   selected, searched, read aloud and indexed. Only the barcode stays a
   canvas, because a barcode is a picture.
   ===================================================================== */

export default function BookSpread({
  book,
  siblings,
  onOpen,
}: {
  book: Book
  siblings: Book[]
  onOpen: (id: string) => void
}) {
  const at = siblings.findIndex((b) => b.id === book.id)
  const prev = at > 0 ? siblings[at - 1] : null
  const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') navigate({ name: 'library', bookId: null })
      if (e.key === 'ArrowLeft' && prev) onOpen(prev.id)
      if (e.key === 'ArrowRight' && next) onOpen(next.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, onOpen])

  return (
    <div className="cat spread-page">
      <header className="spread-head">
        <button
          type="button"
          className="cat-back"
          onClick={() => navigate({ name: 'library', bookId: null })}
        >
          ◂ back to the shelves
        </button>
        <nav className="spread-nav">
          <button type="button" disabled={!prev} onClick={() => prev && onOpen(prev.id)}>
            ◂ {prev ? prev.title : 'start of shelf'}
          </button>
          <button type="button" disabled={!next} onClick={() => next && onOpen(next.id)}>
            {next ? next.title : 'end of shelf'} ▸
          </button>
        </nav>
      </header>

      <article className="spread">
        <div className="leaf board">
          <Cover book={book} scale={0.9} className="cover big" />
        </div>

        <div className="leaf plate-leaf">
          <div className="plate-card">
            <p className="plate-from">from the library of</p>
            <p className="plate-owner">Soubhik Ghosh</p>

            <h1 className="plate-title">{book.title}</h1>
            {book.subtitle && <p className="plate-subtitle">{book.subtitle}</p>}
            <p className="plate-by">{fullByline(book)}</p>

            {book.note ? (
              <blockquote className="plate-note">{book.note}</blockquote>
            ) : (
              <blockquote className="plate-note empty">
                No note yet — this one is still waiting for a verdict.
              </blockquote>
            )}
            {book.review?.split(/\n\s*\n/).map((para, i) => (
              <p key={i} className="plate-review">
                {para}
              </p>
            ))}

            <p className="plate-stars">
              <Stars rating={book.rating} />
              {book.pick && <span className="ribbon-tag">Soubhik’s pick</span>}
            </p>

            <dl className="plate-facts">
              <Fact term="shelf" value={statusLabel(book)} />
              {book.finished && <Fact term="finished" value={readDate(book.finished)} />}
              <Fact term="genre" value={book.genre} />
              {book.year && <Fact term="published" value={String(book.year)} />}
              {book.pages && <Fact term="extent" value={`${book.pages} pp.`} />}
              {book.isbn && <Fact term="isbn" value={book.isbn} />}
            </dl>

            {book.tags?.length ? (
              <p className="plate-tags">
                {book.tags.map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </p>
            ) : null}

            <Barcode book={book} />
          </div>
        </div>
      </article>
    </div>
  )
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </>
  )
}

function statusLabel(b: Book): string {
  if (b.status === 'reading') return 'reading now'
  if (b.status === 'shelved') return 'not read yet'
  return 'read'
}

function Barcode({ book }: { book: Book }) {
  const host = useRef<HTMLDivElement>(null)
  const fonts = useFontsReady()
  const canvas = useMemo(() => {
    void fonts // redraw once the face is available
    return barcodeCanvas(book, 0.9)
  }, [book, fonts])
  useEffect(() => {
    const node = host.current
    if (!node) return
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', book.isbn ? `ISBN ${book.isbn}` : shelfMark(book))
    node.append(canvas)
    return () => canvas.remove()
  }, [canvas, book])
  return <div ref={host} className="plate-barcode" />
}
