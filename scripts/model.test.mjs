// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { list, request, operation, errorDetail, trustedUrl } from './cloud.mjs'
import { definitionFor, columnType } from './model-definition.mjs'
import { deployModel, readJson, saveJson, verifySsoBinding, assertQueryResult } from './model.mjs'

vi.mock('./cloud.mjs', async (original) => ({
  ...await original(), list: vi.fn(), request: vi.fn(),
  operation: vi.fn(async (response) => response.data), sleep: vi.fn().mockResolvedValue(undefined),
}))
const id = (digit) => [8, 4, 4, 4, 12].map((length) => digit.repeat(length)).join('-')
const selection = {
  workspaceId: id('1'), sourceWorkspaceId: id('2'), lakehouseId: id('3'),
  schema: 'dbo', table: 'Example',
  columns: [{ name: 'Name', type: 'varchar', nullable: 'YES' }, { name: 'Value', type: 'float', nullable: 'YES' }],
}
const itemId = id('4')
const refreshUrl = `https://api.powerbi.com/v1.0/myorg/groups/${selection.workspaceId}/datasets/${itemId}/refreshes/${id('5')}`
const connection = {
  connectivityType: 'Automatic',
  connectionDetails: {
    type: 'AzureDataLakeStorage',
    path: `https://onelake.dfs.fabric.microsoft.com/${selection.sourceWorkspaceId}/${selection.lakehouseId}/`,
  },
}
let directory
beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'fabric-model-test-'))
  saveJson(resolve(directory, 'selection.json'), selection)
  list.mockReset().mockImplementation(async (_service, path) => path.endsWith('/connections') ? [connection] : [])
  operation.mockReset().mockImplementation(async (response) => response.data)
  request.mockReset().mockImplementation(async (_service, path, options) => {
    if (path.endsWith('/semanticModels') && options?.method === 'POST') return { status: 201, data: { id: itemId } }
    if (path.endsWith(`/semanticModels/${itemId}`)) return { data: { id: itemId } }
    if (path.endsWith('/refreshes')) return { status: 202, headers: new Headers({ Location: refreshUrl }) }
    if (path === refreshUrl) return { headers: new Headers(), data: { status: 'Completed' } }
    if (path.endsWith('/executeQueries')) return { data: { results: [{ tables: [{ rows: [{ Name: 'Example' }] }] }] } }
    throw new Error(`Unexpected test request: ${path}`)
  })
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

it('builds a complete single-table Direct Lake definition from metadata', () => {
  const result = definitionFor(selection)
  expect(result.definition.format).toBe('TMSL')
  expect(result.definition.parts.map((part) => part.path)).toEqual(['definition.pbism', 'model.bim'])
  const model = JSON.parse(Buffer.from(result.definition.parts[1].payload, 'base64').toString('utf8'))
  expect(model.compatibilityLevel).toBe(1702)
  expect(model.model.tables).toHaveLength(1)
  expect(model.model.tables[0].partitions[0]).toMatchObject({
    mode: 'directLake', source: { type: 'entity', schemaName: 'dbo', entityName: 'Example', expressionSource: 'Lakehouse' },
  })
  expect(model.model.tables[0].columns[1]).toMatchObject({ sourceColumn: 'Value', dataType: 'double', summarizeBy: 'none' })
  expect(result.fingerprint).toBe(definitionFor(selection).fingerprint)
  expect(result.fingerprint).not.toBe(definitionFor({ ...selection, table: 'Different' }).fingerprint)
})
it('rejects unsupported types, precision loss and absent/duplicate columns', () => {
  for (const column of [
    { name: 'Binary', type: 'varbinary' }, { name: 'Precise', type: 'decimal', scale: 5, precision: 10 },
    { name: 'Offset', type: 'datetimeoffset' },
  ]) expect(() => columnType(column)).toThrow()
  expect(() => definitionFor({ ...selection, columns: [] })).toThrow('Source schema')
  expect(() => definitionFor({ ...selection, columns: [selection.columns[0], selection.columns[0]] })).toThrow('duplicated')
})
it('maps wide decimals to double only after explicit per-column consent', () => {
  const column = { name: 'Value', type: 'decimal', precision: 38, scale: 18 }
  const source = { ...selection, columns: [column] }
  expect(() => definitionFor(source)).toThrow('decimal(38,18)')
  const result = definitionFor({ ...source, approximateColumns: ['Value'] })
  expect(result.columns).toEqual([{ name: 'Value', dataType: 'double' }])
  expect(() => definitionFor({ ...source, approximateColumns: ['Other'] })).toThrow('do not match')
  expect(column.type).toBe('decimal')
  expect(columnType({ name: 'Exact', type: 'decimal', precision: 18, scale: 4 })).toBe('decimal')
})
it('creates only its own model, confirms SSO, frames before querying, then reuses it', async () => {
  const state = await deployModel(selection.workspaceId, directory)
  expect(state.validated).toBe(true)
  expect(state.refreshed).toBe(true)
  const paths = request.mock.calls.map(([, path]) => path)
  expect(paths.findIndex((path) => path.endsWith('/refreshes'))).toBeLessThan(paths.findIndex((path) => path.endsWith('/executeQueries')))
  expect(request.mock.calls.find(([, path]) => path.endsWith('/refreshes'))[2].body)
    .toMatchObject({ retryCount: 0, type: 'full', commitMode: 'transactional' })
  expect(existsSync(resolve(directory, 'pending-model.json'))).toBe(false)
  request.mockClear()
  await deployModel(selection.workspaceId, directory)
  expect(request.mock.calls.some(([, path]) => path.endsWith('/semanticModels') || path.endsWith('/refreshes'))).toBe(false)
})
it('does not adopt same-name foreign models or deploy into a different workspace', async () => {
  list.mockResolvedValue([{ displayName: 'SemanticKeyDemoModel', id: itemId }])
  await expect(deployModel(selection.workspaceId, directory)).rejects.toThrow('not recorded as owned')
  await expect(deployModel(id('6'), directory)).rejects.toThrow('differs from setup')
  expect(request).not.toHaveBeenCalled()
})
it('retains the created item after refresh failure without marking it validated', async () => {
  const normal = request.getMockImplementation()
  request.mockImplementation(async (...args) => args[1] === refreshUrl
    ? { data: { status: 'Failed', messages: [{ message: 'Credentials missing' }] } }
    : normal(...args))
  await expect(deployModel(selection.workspaceId, directory)).rejects.toThrow('No refresh retry')
  expect(readJson(resolve(directory, 'model.json'))).toMatchObject({ itemId, validated: false })
  expect(request.mock.calls.filter(([, path]) => path.endsWith('/refreshes'))).toHaveLength(1)
  expect(request.mock.calls.some(([, path]) => path.endsWith('/executeQueries'))).toBe(false)
})
it('persists a pending create operation and resumes it without another POST', async () => {
  request.mockResolvedValueOnce({ status: 202, headers: new Headers({ Location: 'https://api.fabric.microsoft.com/v1/operations/test-operation' }) })
  operation.mockRejectedValueOnce(new Error('Interrupted polling'))
  await expect(deployModel(selection.workspaceId, directory)).rejects.toThrow('Interrupted polling')
  expect(readJson(resolve(directory, 'pending-model.json')).operationUrl).toContain('/operations/')
  operation.mockResolvedValueOnce({ id: itemId })
  await deployModel(selection.workspaceId, directory)
  expect(request.mock.calls.filter(([, path]) => path.endsWith('/semanticModels'))).toHaveLength(1)
})
it('refuses source changes and fixed identity substitution', async () => {
  const state = { workspaceId: selection.workspaceId, itemId }
  list.mockResolvedValue([{ ...connection, connectivityType: 'ShareableCloud' }])
  await expect(verifySsoBinding(state, selection)).rejects.toThrow('per-user SSO')
  list.mockResolvedValue([{ ...connection, connectionDetails: { ...connection.connectionDetails, path: 'https://other.example/' } }])
  await expect(verifySsoBinding(state, selection)).rejects.toThrow('does not match')
  expect(request).not.toHaveBeenCalled()
})
it('binds a disconnected source to automatic SSO using exact discovered details', async () => {
  list.mockResolvedValueOnce([{ ...connection, connectivityType: 'None' }]).mockResolvedValueOnce([connection])
  request.mockResolvedValueOnce({ status: 200 })
  await verifySsoBinding({ workspaceId: selection.workspaceId, itemId }, selection)
  expect(request.mock.calls[0][2].body).toEqual({
    connectionBinding: { connectivityType: 'Automatic', connectionDetails: connection.connectionDetails },
  })
})
it('treats table-level result errors as failures and preserves useful service detail', () => {
  expect(() => assertQueryResult({ results: [{ tables: [{ rows: [], error: { message: 'Truncated result' } }] }] })).toThrow('Truncated result')
  expect(() => assertQueryResult({ results: [{ tables: [] }] })).toThrow('valid row result')
  expect(() => assertQueryResult({ results: [{ tables: [{ rows: [] }] }] })).not.toThrow()
  expect(errorDetail({ error: { 'pbi.error': { details: [{ code: 'DetailsMessage', detail: { value: 'Cannot find <oii>Example</oii>' } }] } } }))
    .toBe('Cannot find Example')
})
it.each(['http://api.fabric.microsoft.com/v1', 'https://api.fabric.microsoft.com.evil.example/', 'https://user:pass@api.fabric.microsoft.com/', 'https://api.fabric.microsoft.com:444/v1'])('rejects unsafe continuation URLs %s', (url) => {
  expect(() => trustedUrl(url)).toThrow('untrusted')
})
