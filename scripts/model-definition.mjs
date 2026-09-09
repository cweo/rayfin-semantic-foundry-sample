import { createHash } from 'node:crypto'
import { guid } from './cloud.mjs'

export function needsApproximation(column) {
  return ['decimal', 'numeric', 'money', 'smallmoney'].includes(column.type.toLowerCase()) &&
    (column.scale == null || column.scale > 4 || column.precision == null || column.precision > 18)
}

export function columnType(column, approximateColumns = []) {
  const type = column.type.toLowerCase()
  if (['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext', 'uniqueidentifier'].includes(type)) return 'string'
  if (['tinyint', 'smallint', 'int', 'bigint'].includes(type)) return 'int64'
  if (['float', 'real'].includes(type)) return 'double'
  if (['decimal', 'numeric', 'money', 'smallmoney'].includes(type)) {
    if (needsApproximation(column)) {
      if (approximateColumns.includes(column.name)) return 'double'
      throw new Error(`Column ${column.name} (${type}(${column.precision ?? '?'},${column.scale ?? '?'})) exceeds the model's fixed-decimal precision. Rerun setup to explicitly allow approximate numbers, or choose a compatible source. No precision is discarded automatically.`)
    }
    return 'decimal'
  }
  if (type === 'bit') return 'boolean'
  if (['date', 'datetime', 'smalldatetime', 'datetime2'].includes(type)) return 'dateTime'
  throw new Error(`Unsupported source type ${type} on ${column.name}. Select a compatible table or projection.`)
}

export function definitionFor(selection) {
  guid(selection.workspaceId, 'app workspace')
  guid(selection.sourceWorkspaceId, 'source workspace')
  guid(selection.lakehouseId, 'Lakehouse')
  if (!selection.schema || !selection.table || !Array.isArray(selection.columns) || !selection.columns.length) {
    throw new Error('Source schema, table and columns must come from setup discovery.')
  }
  const names = selection.columns.map((column) => column.name)
  if (names.some((name) => typeof name !== 'string' || !name.trim()) || new Set(names).size !== names.length) {
    throw new Error('Source column names are missing or duplicated.')
  }
  const approximateColumns = selection.approximateColumns ?? []
  if (!Array.isArray(approximateColumns) || new Set(approximateColumns).size !== approximateColumns.length ||
      approximateColumns.some((name) => !selection.columns.some((column) => column.name === name && needsApproximation(column)))) {
    throw new Error('Approximate column choices do not match the discovered decimal columns.')
  }
  // A single source table is intentional: this is a row-reading demo, not a
  // fabricated star schema or a set of inferred business relationships.
  const columns = selection.columns.map((column) => ({
    name: column.name, sourceColumn: column.name, dataType: columnType(column, approximateColumns), summarizeBy: 'none',
  }))
  const model = {
    compatibilityLevel: 1702,
    model: {
      culture: 'en-US', defaultPowerBIDataSourceVersion: 'powerBI_V3',
      discourageImplicitMeasures: true,
      expressions: [{
        name: 'Lakehouse', kind: 'm',
        expression: `let\n    Source = AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/${selection.sourceWorkspaceId}/${selection.lakehouseId}", [HierarchicalNavigation=true])\nin\n    Source`,
      }],
      tables: [{
        name: selection.table,
        description: `Read-only projection of the selected ${selection.schema}.${selection.table} Lakehouse table.`,
        columns,
        partitions: [{
          name: selection.table, mode: 'directLake',
          source: { type: 'entity', schemaName: selection.schema, entityName: selection.table, expressionSource: 'Lakehouse' },
        }],
      }],
    },
  }
  const files = {
    'definition.pbism': JSON.stringify({ version: '4.2', settings: { qnaEnabled: false } }),
    'model.bim': JSON.stringify(model),
  }
  return {
    columns: columns.map(({ name, dataType }) => ({ name, dataType })),
    fingerprint: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    definition: {
      format: 'TMSL',
      parts: Object.entries(files).map(([path, value]) => ({
        path, payload: Buffer.from(value).toString('base64'), payloadType: 'InlineBase64',
      })),
    },
  }
}
