import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// This must match your GitHub repo name exactly for Pages to work.
export default defineConfig({
  plugins: [react()],
  base: '/court-split/',
})
