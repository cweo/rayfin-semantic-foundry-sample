// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { list, request } from './cloud.mjs'
import { saveJson } from './model.mjs'
import { deploymentStatus } from './status.mjs'

vi.mock('./cloud.mjs', async (original) => ({ ...await original(), list: vi.fn(), request: vi.fn() }))
const id = (digit) => [8, 4, 4, 4, 12].map((length) => digit.repeat(length)).join('-')
let directory
const runtime = {
  workspaceId: id('1'), itemId: id('2'), apiUrl: 'https://backend.example.test/', publishableKey: 'pk-test',
}
beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'fabric-status-test-'))
  mkdirSync(resolve(directory, 'rayfin'))
  saveJson(resolve(directory, 'rayfin', '.deployments.json'), {
    active: 'test',
    deployments: { test: {
      fabricWorkspaceId: runtime.workspaceId, fabricItemId: runtime.itemId,
      fabricApiUrl: runtime.apiUrl, publishableKey: runtime.publishableKey,
      hostingUrl: 'https://test.webapp.fabricapps.net',
    } },
  })
  saveJson(resolve(directory, 'model.json'), { workspaceId: runtime.workspaceId, itemId: id('3'), validated: true })
  request.mockReset().mockImplementation(async (_service, path) => ({
    data: path.includes('/semanticModels/')
      ? { id: id('3'), displayName: 'Model' }
      : { id: runtime.itemId, displayName: 'This app', type: 'AppBackend' },
  }))
  list.mockReset().mockResolvedValue([{ id: id('4'), displayName: 'Earlier sample' }, { id: id('5'), displayName: 'This app' }])
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(runtime)))
})
afterEach(() => { vi.unstubAllGlobals(); rmSync(directory, { recursive: true, force: true }) })
it('reports the exact-name SQL item, not the first workspace database', async () => {
  const result = await deploymentStatus(directory)
  expect(result.sqlDatabase.id).toBe(id('5'))
  expect(result.app.id).toBe(runtime.itemId)
  expect(JSON.stringify(result)).not.toContain('pk-test')
})
it('rejects ambiguous/missing SQL matches instead of reporting false success', async () => {
  list.mockResolvedValue([{ displayName: 'Earlier sample' }])
  await expect(deploymentStatus(directory)).rejects.toThrow('Cannot uniquely identify')
  list.mockResolvedValue([{ displayName: 'This app' }, { displayName: 'This app' }])
  await expect(deploymentStatus(directory)).rejects.toThrow('Cannot uniquely identify')
})
it('rejects another app runtime configuration', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...runtime, itemId: id('9') })))
  await expect(deploymentStatus(directory)).rejects.toThrow('does not match this app')
})
