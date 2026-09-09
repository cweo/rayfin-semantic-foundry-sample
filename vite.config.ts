import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

const generatedPath = resolve(import.meta.dirname, '.fabric-deployment', '.env.local')
const generated = existsSync(generatedPath) ? parseEnv(readFileSync(generatedPath, 'utf8')) : {}
const notesKeys = [
  'VITE_RAYFIN_API_URL', 'VITE_RAYFIN_PUBLISHABLE_KEY',
  'VITE_FABRIC_WORKSPACE_ID', 'VITE_FABRIC_ITEM_ID', 'VITE_FABRIC_PORTAL_URL',
]
const modelPath = resolve(import.meta.dirname, '.fabric-deployment', 'model.json')
const model = existsSync(modelPath) ? JSON.parse(readFileSync(modelPath, 'utf8')) : null

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Only this deployment's generated values may supply local notes defaults.
  define: {
    ...Object.fromEntries(notesKeys.map((key) => [`import.meta.env.${key}`, JSON.stringify(generated[key] ?? '')])),
    __SEMANTIC_MODEL__: JSON.stringify(model?.validated ? {
      workspaceId: model.workspaceId, itemId: model.itemId,
      table: model.table, columns: model.columns, portalUrl: model.portalUrl,
    } : null),
  },
  server: { host: 'localhost', port: 5175, strictPort: true },
  preview: { host: 'localhost', port: 4175, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
      },
    },
  },
})
