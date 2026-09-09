import { mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import inquirer from 'inquirer'
import { list, guid } from './cloud.mjs'
import { listColumns, listTables } from './sql-metadata.mjs'
import { definitionFor, needsApproximation } from './model-definition.mjs'
import { stateRoot, readJson, saveJson, deployModel } from './model.mjs'

async function choose(message, entries) {
  if (!entries.length) throw new Error(`No choices available: ${message}. Check the selected tenant and access.`)
  return (await inquirer.prompt([{
    name: 'value', type: 'list', message, pageSize: 15,
    choices: entries,
  }])).value
}

async function setup() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run npm run setup in a visible interactive terminal. No resource is chosen automatically.')
  const workspaces = await list('fabric', '/workspaces')
  const choices = workspaces.filter((item) => item.capacityId).map((item) => ({
    name: `${item.displayName} (${item.id.slice(0, 8)})`, value: item.id,
  }))
  const workspaceId = guid(await choose('Workspace for the app, SQL notes and semantic model', choices), 'workspace')
  const sourceWorkspaceId = guid(await choose('Workspace containing your Lakehouse', choices), 'source workspace')
  const lakehouses = await list('fabric', `/workspaces/${sourceWorkspaceId}/items?type=Lakehouse`)
  const lakehouseId = guid(await choose('Lakehouse', lakehouses.map((item) => ({
    name: `${item.displayName} (${item.id.slice(0, 8)})`, value: item.id,
  }))), 'Lakehouse')
  console.log('Discovering table metadata without reading source rows...')
  const tables = await listTables(sourceWorkspaceId, lakehouseId)
  const table = await choose('Table for the model', tables.map((item) => ({
    name: `${item.schema}.${item.table}`, value: item,
  })))
  const columns = await listColumns(sourceWorkspaceId, lakehouseId, table.schema, table.table)
  const selection = { workspaceId, sourceWorkspaceId, lakehouseId, ...table, columns }
  const wideDecimals = columns.filter(needsApproximation)
  if (wideDecimals.length) {
    console.log('These columns exceed the fixed-decimal model range:')
    for (const column of wideDecimals) console.log(`  ${column.name}: ${column.type}(${column.precision ?? '?'},${column.scale ?? '?'})`)
    const { approximate } = await inquirer.prompt([{
      name: 'approximate', type: 'confirm', default: false,
      message: 'Use approximate floating-point numbers for these columns in this demo model? Precision may be lost (about 15 significant digits). The Lakehouse remains unchanged.',
    }])
    if (!approximate) throw new Error('Setup stopped without creating resources. Exact precision requires a compatible source table; no numeric conversion was accepted.')
    selection.approximateColumns = wideDecimals.map((column) => column.name)
  }
  definitionFor(selection)
  const selectionFile = resolve(stateRoot, 'selection.json')
  if (existsSync(resolve(stateRoot, 'model.json')) && existsSync(selectionFile) &&
      JSON.stringify(readJson(selectionFile)) !== JSON.stringify(selection)) {
    throw new Error('This sample already owns a model with a different source/schema. Existing data and model will not be overwritten.')
  }
  const { confirmed } = await inquirer.prompt([{
    name: 'confirmed', type: 'confirm', default: false,
    message: `Create/reuse this sample's model over ${table.schema}.${table.table} (${columns.length} columns)? The source will not be modified.`,
  }])
  if (!confirmed) throw new Error('Setup cancelled; no resources were created.')
  mkdirSync(stateRoot, { recursive: true })
  saveJson(selectionFile, selection)
  await deployModel(workspaceId)
  console.log('Run npm run deploy -- --workspace-id <selected-workspace-id> to create the app and its SQL notes database.')
}

setup().catch((error) => { console.error(error.message); process.exitCode = 1 })
