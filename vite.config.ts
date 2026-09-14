import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { libraryWriter } from './tools/library-writer'
import { spaPages } from './tools/spa-pages'

// https://vite.dev/config/
export default defineConfig({
  // Served as a GitHub Pages project site at so-weak.github.io/OS/
  base: '/OS/',
  plugins: [
    react(),
    // dev only: lets scan.html append scanned books to books.ts
    libraryWriter(),
    // build only: static entry points for the /library routes
    spaPages(),
  ],
  build: {
    rollupOptions: {
      // index.html is the ONLY entry. scan.html (the ISBN intake console)
      // is deliberately left out of the build, so neither it nor
      // src/dev/** ever reaches the static host.
      input: 'index.html',
    },
  },
})
