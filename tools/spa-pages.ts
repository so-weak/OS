import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'

/* =====================================================================
   GitHub Pages serves static files and knows nothing about routes, so
   after the bundle is written we drop copies of index.html where the
   router's paths will look for them:

     dist/library/index.html   ->  /OS/library/  loads with a 200
     dist/404.html             ->  /OS/library/dune and any other deep
                                   link falls back to the app

   Asset URLs inside index.html are absolute (base: '/OS/'), so a copy
   works from any depth. Build-time only.
   ===================================================================== */

/** Routes that should resolve with a 200 rather than via 404.html. */
const PAGES = ['library']

export function spaPages(): Plugin {
  return {
    name: 'stacks-spa-pages',
    apply: 'build',
    async closeBundle() {
      const out = path.resolve('dist')
      const index = path.join(out, 'index.html')
      for (const page of PAGES) {
        const dir = path.join(out, page)
        await mkdir(dir, { recursive: true })
        await copyFile(index, path.join(dir, 'index.html'))
      }
      await copyFile(index, path.join(out, '404.html'))
    },
  }
}
