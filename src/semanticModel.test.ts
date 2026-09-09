import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FabricClientConfig } from '@microsoft/fabric-app-data'
import { isPortalHost, modelQuery, readModel, type ModelConnection } from './semanticModel'

const sdk = vi.hoisted(() => ({
  embedded: false, iframe: false, execute: vi.fn(),
  result: {
    status: 'success',
    table: { columns: [{ name: 'Name', dataType: 'string' }], rows: [['Example']] },
    error: { message: 'Model access denied' },
  },
  configs: [] as FabricClientConfig[],
}))
vi.mock('@microsoft/fabric-embedded-host', () => ({ isEmbeddedMode: () => sdk.embedded }))
vi.mock('@microsoft/fabric-app-data-embed-client', () => ({
  isRunningInFabric: () => sdk.iframe,
  SemanticModelMessageClient: class {},
}))
vi.mock('@microsoft/fabric-app-data-proxy', () => ({
  EmbedFabricApiProxy: class {
    semanticModel = { executeDax: sdk.execute, executeDaxJson: vi.fn() }
  },
}))
vi.mock('@microsoft/fabric-app-data', () => ({
  FabricClient: class {
    private config: FabricClientConfig
    constructor(config: FabricClientConfig) { this.config = config; sdk.configs.push(config) }
    semanticModel(alias: string) {
      return { query: async (query: string) => {
        const item = this.config.semanticModels?.[alias]
        if (!item) throw new Error('Missing model reference')
        await this.config.proxy.semanticModel.executeDax(item.workspaceId, item.itemId, query)
        return sdk.result
      } }
    }
  },
}))
const model: ModelConnection = {
  workspaceId: 'test-workspace', itemId: 'test-model', table: "Owner's table",
  columns: [{ name: 'Name', dataType: 'string' }, { name: 'A]"B', dataType: 'string' }],
  portalUrl: 'https://app.fabric.microsoft.com',
}
beforeEach(() => {
  sdk.embedded = false
  sdk.iframe = false
  sdk.result.status = 'success'
  sdk.result.table.rows = [['Example']]
  sdk.configs.length = 0
  sdk.execute.mockResolvedValue({ data: new ArrayBuffer(0), requestId: 'test' })
})
afterEach(() => vi.unstubAllGlobals())

it('does not mistake an ordinary iframe for the Fabric portal', async () => {
  vi.stubGlobal('window', { self: {}, top: {} })
  sdk.iframe = true
  expect(isPortalHost()).toBe(false)
  await expect(readModel(model, ['Name'], 25)).rejects.toThrow('Fabric portal')
  expect(sdk.execute).not.toHaveBeenCalled()
})
it('rejects standalone requests even if an old embedded flag remains', async () => {
  sdk.embedded = true
  await expect(readModel(model, ['Name'], 25)).rejects.toThrow('Fabric portal')
  expect(sdk.execute).not.toHaveBeenCalled()
})
it('escapes model identifiers and accepts only discovered columns', () => {
  expect(modelQuery(model, ['A]"B'], 10)).toContain('"A]""B", \'Owner\'\'s table\'[A]]"B]')
  expect(() => modelQuery(model, ['Unselected'], 10)).toThrow('valid fields')
  expect(() => modelQuery(model, ['Name', 'Name'], 10)).toThrow('valid fields')
  expect(() => modelQuery(model, [], 10)).toThrow('valid fields')
})
it.each([0, 101, -1, 1.5, NaN])('rejects invalid row limit %s', (limit) => {
  expect(() => modelQuery(model, ['Name'], limit)).toThrow('row limit')
})
it('uses the host proxy with Arrow limits and no cache or browser token request', async () => {
  vi.stubGlobal('window', { self: {}, top: {} })
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  sdk.iframe = sdk.embedded = true
  const result = await readModel(model, ['Name'], 25)
  expect(result.rows).toEqual([['Example']])
  expect(sdk.execute).toHaveBeenCalledWith('test-workspace', 'test-model',
    modelQuery(model, ['Name'], 25), { queryTimeout: 30, resultSetRowCountLimit: 25 })
  expect(sdk.configs[0]).toMatchObject({ daxProtocol: 'arrow', cache: { enabled: false } })
  expect(fetch).not.toHaveBeenCalled()
})
it('surfaces normalized failures and rejects row-limit overflow', async () => {
  vi.stubGlobal('window', { self: {}, top: {} })
  sdk.iframe = sdk.embedded = true
  sdk.result.status = 'error'
  await expect(readModel(model, ['Name'], 1)).rejects.toThrow('Model access denied')
  sdk.result.status = 'success'
  sdk.result.table.rows = [['Duplicate'], ['Duplicate']]
  await expect(readModel(model, ['Name'], 1)).rejects.toThrow('more rows')
})
