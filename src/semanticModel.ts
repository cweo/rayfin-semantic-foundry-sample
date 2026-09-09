import { FabricClient, type IFabricApiProxy } from '@microsoft/fabric-app-data'
import { SemanticModelMessageClient, isRunningInFabric } from '@microsoft/fabric-app-data-embed-client'
import { EmbedFabricApiProxy } from '@microsoft/fabric-app-data-proxy'
import { isEmbeddedMode } from '@microsoft/fabric-embedded-host'

export interface ModelConnection {
  workspaceId: string
  itemId: string
  table: string
  columns: { name: string; dataType: string }[]
  portalUrl: string
}
declare const __SEMANTIC_MODEL__: ModelConnection | null
export const modelConnection = __SEMANTIC_MODEL__

export function isPortalHost(): boolean {
  return window.self !== window.top && isRunningInFabric() && isEmbeddedMode({})
}

export function modelQuery(model: ModelConnection, columns: string[], limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Choose a row limit between 1 and 100.')
  if (!columns.length || new Set(columns).size !== columns.length ||
      columns.some((name) => !model.columns.some((column) => column.name === name))) {
    throw new Error('Select valid fields from the provisioned model.')
  }
  const table = `'${model.table.replaceAll("'", "''")}'`
  const field = (name: string) => `${table}[${name.replaceAll(']', ']]')}]`
  const order = model.columns.map((column) => `${field(column.name)}, ASC`).join(', ')
  const selection = columns.map((name) => `"${name.replaceAll('"', '""')}", ${field(name)}`).join(', ')
  return `EVALUATE SELECTCOLUMNS(TOPN(${limit}, ${table}, ${order}), ${selection})`
}

let proxy: EmbedFabricApiProxy | undefined
export async function readModel(model: ModelConnection, columns: string[], limit: number) {
  if (!isPortalHost()) throw new Error('Open this app inside the Fabric portal to query the semantic model.')
  const query = modelQuery(model, columns, limit)
  proxy ??= new EmbedFabricApiProxy(new SemanticModelMessageClient())
  const base = proxy
  const bounded: IFabricApiProxy = {
    semanticModel: {
      executeDax: (workspace, item, dax, options) => base.semanticModel.executeDax(workspace, item, dax, {
        ...options, queryTimeout: 30, resultSetRowCountLimit: limit,
      }),
      executeDaxJson: (...args) => base.semanticModel.executeDaxJson(...args),
    },
    lakehouse: base.lakehouse,
    warehouse: base.warehouse,
  }
  const client = new FabricClient({
    proxy: bounded, cache: { enabled: false }, daxProtocol: 'arrow',
    semanticModels: { selected: { workspaceId: model.workspaceId, itemId: model.itemId } },
  })
  const result = await client.semanticModel('selected').query(query)
  if (result.status !== 'success') throw new Error(result.error.message)
  if (result.table.rows.length > limit) throw new Error('The model returned more rows than requested, possibly due to ties. Narrow the source; no truncated success is shown.')
  return result.table
}
