import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/vt323'
import '@fontsource/ibm-plex-mono' // 400 — UI face
import '@fontsource/ibm-plex-mono/700.css' // real bold (no faux-bold smear)
import '@fontsource/silkscreen'
import './styles/tokens.css'
import './styles/win95.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
