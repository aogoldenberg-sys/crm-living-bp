import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => ({
  plugins: [
    // РЕШЕНИЕ: в режиме test отключаем fast-refresh — он несовместим с vitest jsdom.
    react({ jsxRuntime: 'automatic', fastRefresh: mode !== 'test' }),
  ],
  base: command === 'build' ? '/crm_life/' : '/',
  build: {
    // heic2any — browser-only, не входит в бандл
    rollupOptions: { external: ['heic2any'] },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
}))
