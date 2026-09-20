import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * A stamp the running app can show. Four rounds of the installed-on-iOS
 * viewport bug were spent unable to answer "is the phone running this build, or
 * a cached one?" — a home-screen PWA that resumes instead of cold-launching
 * never re-navigates, so stale CSS and a failed fix look identical.
 */
const buildId = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return 'local' // a tarball with no .git is a fine thing to build from
  }
})()

export default defineConfig({
  plugins: [tailwindcss(), react()],
  base: '/adhdo/',
  define: {
    __BUILD_ID__: JSON.stringify(`${buildId} · ${new Date().toISOString().slice(0, 16)}Z`),
  },
})
