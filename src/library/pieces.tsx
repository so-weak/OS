import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { Book } from '../data/library'
import { useFontsReady } from '../useFontsReady'
import { bookDims, coverCanvas, spineCanvas, bookplateCanvas } from './art'

/* =====================================================================
   The drawn pieces of the catalogue: a spine, a cloth board, a
   bookplate. Each one is a canvas built by src/library/art.ts — the
   same drawings the 3D shelf uses — mounted into the DOM directly
   rather than round-tripped through a data URL.
   ===================================================================== */

/** Mounts a canvas produced by `make` and keeps it for the node's life. */
function CanvasArt({
  make,
  className,
  alt,
  style,
}: {
  make: () => HTMLCanvasElement
  className: string
  alt: string
  style?: CSSProperties
}) {
  const host = useRef<HTMLSpanElement>(null)
  /* a canvas rasterises with whatever font is loaded at draw time and
     never repaints, so the art is redrawn once VT323 lands */
  const fonts = useFontsReady()
  const canvas = useMemo(() => {
    void fonts // the redraw is the point; the value is not
    return make()
  }, [make, fonts])

  useEffect(() => {
    const node = host.current
    if (!node) return
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', alt)
    node.append(canvas)
    // NB: detach only. Zeroing the backing store here would destroy the
    // canvas during StrictMode's mount/unmount/mount, and the remount
    // would re-attach a blank one.
    return () => canvas.remove()
  }, [canvas, alt])

  return <span ref={host} className={className} style={style} />
}

/** One book standing on a shelf, drawn at its true relative proportions. */
export function Spine({
  book,
  rowHeight,
  onOpen,
}: {
  book: Book
  rowHeight: number
  onOpen: (id: string) => void
}) {
  const dims = bookDims(book)
  // the tallest possible volume just fits the row
  const h = Math.round((dims.tall / 0.244) * rowHeight)
  const w = Math.max(9, Math.round((dims.thick / dims.tall) * h))
  const make = useMemo(() => () => spineCanvas(book, 0.5), [book])

  return (
    <button
      type="button"
      className="spine"
      style={{ width: w }}
      onClick={() => onOpen(book.id)}
      title={book.authors.length ? `${book.title} — ${book.authors.join(', ')}` : book.title}
    >
      <span className="spine-body" style={{ width: w, height: h }}>
        <CanvasArt make={make} className="spine-art" alt={book.title} />
        {book.status === 'reading' && <span className="ribbon" aria-hidden />}
      </span>
    </button>
  )
}

/** The cloth board, for the grid view and the spread. */
export function Cover({
  book,
  scale = 0.45,
  className = 'cover',
}: {
  book: Book
  scale?: number
  className?: string
}) {
  const make = useMemo(() => () => coverCanvas(book, scale), [book, scale])
  return <CanvasArt make={make} className={className} alt={`${book.title} — front board`} />
}

/** The pasted bookplate: the note, the stars, the date, the barcode. */
export function Bookplate({ book }: { book: Book }) {
  const make = useMemo(() => () => bookplateCanvas(book, 0.85), [book])
  return <CanvasArt make={make} className="bookplate" alt={`${book.title} — bookplate`} />
}

/** Five stars, halves included, as text that a screen reader can read. */
export function Stars({ rating }: { rating: number | undefined }) {
  if (!rating) return <span className="stars none">unrated</span>
  const full = Math.floor(rating)
  const half = rating - full >= 0.5
  return (
    <span className="stars" aria-label={`${rating} out of 5`}>
      {'★'.repeat(full)}
      {half && <span className="half">★</span>}
      <span className="dim">{'★'.repeat(5 - full - (half ? 1 : 0))}</span>
    </span>
  )
}
