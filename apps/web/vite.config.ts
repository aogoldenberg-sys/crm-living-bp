import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => ({
  plugins: [
    // РЕШЕНИЕ: в режиме test отключаем fast-refresh — он несовместим с vitest jsdom.
    react({ jsxRuntime: 'automatic', fastRefresh: mode !== 'test' }),
  ],
  // VITE_BASE_PATH — для альтернативных деплоев (напр. /gr-crm/ для Густорико).
  // Если не задан, используем стандартный путь Кайрос.
  base: process.env.VITE_BASE_PATH ?? (command === 'build' ? '/kairos/app/' : '/'),
  build: {
    // heic2any — browser-only, не входит в бандл
    rollupOptions: { external: ['heic2any'] },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
}))
