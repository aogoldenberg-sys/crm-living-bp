import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import type { Plugin } from 'vite'

/**
 * Shim plugin: resolves the pre-existing missing escalation module in @crm/core.
 * packages/core/src/index.ts exports from "./process/escalation.js" which doesn't
 * exist yet — redirect to an empty shim so the build succeeds.
 */
function shimMissingCoreModules(): Plugin {
  const shimPath = path.resolve(__dirname, 'src/_shims/process-escalation.ts')
  return {
    name: 'shim-missing-core-modules',
    resolveId(source, importer) {
      if (
        importer &&
        importer.includes('packages/core/src/index.ts') &&
        source === './process/escalation.js'
      ) {
        return shimPath
      }
      return null
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), shimMissingCoreModules()],
  base: command === 'build' ? '/crm_life/' : '/',
}))
