import { Connection, Request, TYPES } from 'tedious'
import { request, token } from './cloud.mjs'

export async function inspectLakehouse(workspaceId, lakehouseId, query, parameters = {}) {
  const { data: lakehouse } = await request('fabric', `/workspaces/${workspaceId}/lakehouses/${lakehouseId}`)
  const endpoint = lakehouse.properties?.sqlEndpointProperties
  if (!endpoint?.connectionString || !endpoint?.id) throw new Error('The selected Lakehouse has no ready SQL analytics endpoint.')
  const [server, port = '1433'] = endpoint.connectionString.replace(/^tcp:/, '').split(',')
  if (!/^[a-z0-9.-]+$/i.test(server) || port !== '1433') throw new Error('Unexpected SQL analytics endpoint connection format.')
  const accessToken = await token('powerbi')
  const connection = new Connection({
    server,
    authentication: { type: 'azure-active-directory-access-token', options: { token: accessToken } },
    options: {
      database: endpoint.id, port: 1433, encrypt: true, trustServerCertificate: false,
      connectTimeout: 30_000, requestTimeout: 30_000,
    },
  })
  try {
    await new Promise((resolve, reject) => {
      connection.once('connect', (error) => error ? reject(error) : resolve())
      connection.connect()
    })
    return await new Promise((resolve, reject) => {
      const rows = []
      const sql = new Request(query, (error) => error ? reject(error) : resolve(rows))
      for (const [name, value] of Object.entries(parameters)) sql.addParameter(name, TYPES.NVarChar, value)
      sql.on('row', (columns) => rows.push(Object.fromEntries(columns.map((column) => [column.metadata.colName, column.value]))))
      connection.execSql(sql)
    })
  } finally {
    connection.close()
  }
}

export function listTables(workspaceId, lakehouseId) {
  return inspectLakehouse(workspaceId, lakehouseId,
    "SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [table] FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME")
}

export function listColumns(workspaceId, lakehouseId, schema, table) {
  return inspectLakehouse(workspaceId, lakehouseId, `
    SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable,
           NUMERIC_PRECISION AS precision, NUMERIC_SCALE AS scale
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
    ORDER BY ORDINAL_POSITION`, { schema, table })
}
