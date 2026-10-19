import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => ({
  plugins: [
    // РЕШЕНИЕ: в режиме test отключаем fast-refresh — он несовместим с vitest jsdom.
    react({ jsxRuntime: 'automatic', fastRefresh: mode !== 'test' }),
  ],
  // VITE_BASE_PATH — для альтернативных деплоев (напр. /gr-crm/ для Густорико).
  // Если не задан, используем стандартный путь Кайрос.
  base: command === 'build' ? '/gm-crm/' : '/',
  build: {
    // heic2any — browser-only, не входит в бандл
    rollupOptions: {
      external: ['heic2any'],
      // Тяжёлые библиотеки — отдельными чанками: кэшируются между деплоями
      // и не попадают в загрузку CRM, если раздел их не использует.
      output: {
        manualChunks(id: string) {
          if (/node_modules\/(d3|d3-[\w-]+|internmap|delaunator|robust-predicates)\//.test(id)) return 'd3'
          if (id.includes('node_modules/xlsx/')) return 'xlsx'
          if (/node_modules\/(@firebase|firebase)\//.test(id)) return 'firebase'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
}))
