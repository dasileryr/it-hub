import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base: './' — относительные пути, чтобы сборка работала на GitHub Pages
// и в корне (user.github.io), и в подпапке (user.github.io/repo).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
