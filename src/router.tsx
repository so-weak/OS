import { useCallback, useEffect, useState } from 'react'

/* =====================================================================
   A router in thirty lines, because this site has two places to be:
   the room (/) and the catalogue (/library, /library/<book-id>).

   GitHub Pages has no server-side routing, so `npm run build` emits
   `library/index.html` (a 200 for the catalogue itself) and `404.html`
   (the fallback that serves deep links like /library/dune). Both are
   byte copies of index.html — see tools/spa-pages.ts. That means a
   refresh or a shared link lands on the right screen.
   ===================================================================== */

/** '/OS/' in production, '/' in dev. Always has a trailing slash. */
const BASE = import.meta.env.BASE_URL

export type Route =
  | { name: 'room' }
  | { name: 'library'; bookId: string | null }

function parse(pathname: string): Route {
  let path = pathname
  if (path.startsWith(BASE)) path = path.slice(BASE.length)
  path = path.replace(/^\/+|\/+$/g, '')
  if (!path) return { name: 'room' }
  const [head, ...rest] = path.split('/')
  if (head === 'library') {
    return { name: 'library', bookId: rest[0] ? decodeURIComponent(rest[0]) : null }
  }
  return { name: 'room' }
}

export function href(route: Route): string {
  if (route.name === 'room') return BASE
  return route.bookId
    ? `${BASE}library/${encodeURIComponent(route.bookId)}`
    : `${BASE}library/`
}

/** Push a route into history without reloading the page. */
export function navigate(route: Route, replace = false): void {
  const url = href(route)
  if (replace) window.history.replaceState(null, '', url)
  else window.history.pushState(null, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useRoute(): Route {
  const read = useCallback(() => parse(window.location.pathname), [])
  const [route, setRoute] = useState<Route>(read)
  useEffect(() => {
    const sync = (): void => setRoute(read())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [read])
  return route
}
