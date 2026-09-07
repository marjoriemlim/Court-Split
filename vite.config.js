import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// IMPORTANT: change '/badminton-payments/' to '/YOUR-REPO-NAME/'
// This must match your GitHub repo name exactly for Pages to work.
export default defineConfig({
  plugins: [react()],
  base: '/badminton-payments/',
})
