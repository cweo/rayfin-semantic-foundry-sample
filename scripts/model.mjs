import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request, list, operation, guid, trustedUrl, sleep, errorDetail } from './cloud.mjs'
import { definitionFor } from './model-definition.mjs'

export const root = fileURLToPath(new URL('..', import.meta.url))
export const stateRoot = resolve(root, '.fabric-deployment')
export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
export function saveJson(path, value) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n')
  renameSync(`${path}.tmp`, path)
}

export async function verifySsoBinding(state, selection) {
  const path = `/workspaces/${state.workspaceId}/items/${state.itemId}/connections`
  const expected = `https://onelake.dfs.fabric.microsoft.com/${selection.sourceWorkspaceId}/${selection.lakehouseId}`
  const connections = await list('fabric', path)
  if (connections.length !== 1 ||
      connections[0].connectionDetails?.type !== 'AzureDataLakeStorage' ||
      connections[0].connectionDetails.path.replace(/\/$/, '') !== expected) {
    throw new Error('The model source connection does not match the selected Lakehouse. Nothing was rebound.')
  }
  const connection = connections[0]
  if (connection.connectivityType === 'None') {
    await request('fabric', `/workspaces/${state.workspaceId}/semanticModels/${state.itemId}/bindConnection`, {
      method: 'POST',
      body: { connectionBinding: { connectivityType: 'Automatic', connectionDetails: connection.connectionDetails } },
    })
    const bound = await list('fabric', path)
    if (bound.length !== 1 || bound[0].connectivityType !== 'Automatic' ||
        bound[0].connectionDetails?.type !== connection.connectionDetails.type ||
        bound[0].connectionDetails?.path !== connection.connectionDetails.path) {
      throw new Error('Fabric did not confirm the automatic SSO source binding.')
    }
  } else if (connection.connectivityType !== 'Automatic') {
    throw new Error('This demo requires automatic per-user SSO. A fixed/personal connection will not be substituted or silently changed.')
  }
}

export async function refreshModel(state, persist) {
  if (state.refreshed && !state.refreshUrl) return
  const path = `/groups/${state.workspaceId}/datasets/${state.itemId}/refreshes`
  if (!state.refreshUrl) {
    console.log('Framing the Direct Lake model (metadata refresh, not an Import copy)...')
    const response = await request('powerbi', path, {
      method: 'POST',
      body: { type: 'full', commitMode: 'transactional', retryCount: 0, maxParallelism: 1 },
    })
    if (response.status !== 202 || !response.headers.get('Location')) {
      throw new Error('The model refresh did not return a trackable operation. Inspect refresh history in Fabric before retrying.')
    }
    state.refreshUrl = trustedUrl(response.headers.get('Location'))
    persist()
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await request('powerbi', state.refreshUrl)
    const status = response.data?.status
    if (status === 'Completed') {
      delete state.refreshUrl
      state.refreshed = true
      persist()
      return
    }
    if (['Failed', 'Cancelled', 'Disabled'].includes(status)) {
      delete state.refreshUrl
      persist()
      const messages = response.data?.messages?.map((message) => message.message).filter(Boolean).join(' ')
      throw new Error(`Model refresh ${status}: ${messages || errorDetail(response.data) || 'Inspect refresh history in Fabric.'} No refresh retry was attempted. For credential/access errors, configure source access in Fabric before explicitly running this command again.`)
    }
    if (!['Unknown', 'NotStarted', 'InProgress'].includes(status)) throw new Error('Power BI returned an unknown refresh status.')
    await sleep(Math.min(30, Math.max(1, Number(response.headers.get('Retry-After')) || 5)) * 1000)
  }
  throw new Error('Model refresh is still running. Its operation was saved; rerun model:deploy to resume polling, not create another model.')
}

export function assertQueryResult(data) {
  const results = data?.results
  const tables = results?.flatMap((result) => result.tables ?? [])
  const failure = data?.error ?? results?.find((result) => result.error)?.error ??
    tables?.find((table) => table.error)?.error
  if (failure) throw new Error(`Model read failed: ${errorDetail(failure) || failure.code || 'Query error.'}`)
  if (results?.length !== 1 || tables?.length !== 1 || !Array.isArray(tables[0].rows)) {
    throw new Error('Model read returned no valid row result.')
  }
}

export async function deployModel(workspaceId, directory = stateRoot) {
  guid(workspaceId, 'deployment workspace')
  const selectionFile = resolve(directory, 'selection.json')
  if (!existsSync(selectionFile)) throw new Error('Run npm run setup to choose the Lakehouse table first.')
  const selection = readJson(selectionFile)
  if (selection.workspaceId !== workspaceId) throw new Error('Deployment workspace differs from setup. Run setup explicitly to change it.')
  const generated = definitionFor(selection)
  const modelFile = resolve(directory, 'model.json')
  const pendingFile = resolve(directory, 'pending-model.json')
  let state = existsSync(modelFile) ? readJson(modelFile) : null
  if (state) {
    if (state.workspaceId !== workspaceId || state.fingerprint !== generated.fingerprint) {
      throw new Error('The saved source schema differs from the deployed model. Review the change explicitly; setup will not overwrite an existing model.')
    }
    guid(state.itemId, 'saved model')
    await request('fabric', `/workspaces/${workspaceId}/semanticModels/${state.itemId}`)
  } else {
    const name = 'SemanticKeyDemoModel'
    let accepted
    if (existsSync(pendingFile)) {
      const pending = readJson(pendingFile)
      if (pending.workspaceId !== workspaceId || pending.fingerprint !== generated.fingerprint || !pending.operationUrl) {
        throw new Error('A previous model creation needs inspection in Fabric. No duplicate will be created. Resolve the saved pending-model operation before retrying.')
      }
      accepted = { status: 202, headers: new Headers({ Location: trustedUrl(pending.operationUrl) }) }
    } else {
      const models = await list('fabric', `/workspaces/${workspaceId}/items?type=SemanticModel`)
      if (models.some((item) => item.displayName.toLowerCase() === name.toLowerCase())) {
        throw new Error(`A model named ${name} exists but is not recorded as owned by this sample. Choose another workspace or resolve ownership before continuing.`)
      }
      console.log('Creating the selected table semantic model...')
      mkdirSync(directory, { recursive: true })
      const pending = { workspaceId, fingerprint: generated.fingerprint }
      // Record intent first: an interrupted POST must never trigger a duplicate.
      saveJson(pendingFile, pending)
      accepted = await request('fabric', `/workspaces/${workspaceId}/semanticModels`, {
        method: 'POST', body: { displayName: name, definition: generated.definition },
      })
      if (accepted.status === 202 && accepted.headers.get('Location')) {
        saveJson(pendingFile, { ...pending, operationUrl: trustedUrl(accepted.headers.get('Location')) })
      }
    }
    const model = await operation(accepted)
    if (!model?.id) throw new Error('Fabric model creation did not return an item ID.')
    state = {
      workspaceId, itemId: model.id, table: selection.table, columns: generated.columns,
      fingerprint: generated.fingerprint, validated: false,
      portalUrl: `https://app.fabric.microsoft.com/groups/${workspaceId}/semanticmodels/${model.id}`,
    }
    saveJson(modelFile, state)
    rmSync(pendingFile, { force: true })
  }
  state.validated = false
  const persist = () => saveJson(modelFile, state)
  persist()
  await verifySsoBinding(state, selection)
  await refreshModel(state, persist)
  // A newly uploaded definition must be framed before the engine can query it.
  const table = `'${state.table.replaceAll("'", "''")}'`
  const { data } = await request('powerbi', `/groups/${workspaceId}/datasets/${state.itemId}/executeQueries`, {
    method: 'POST', body: { queries: [{ query: `EVALUATE TOPN(1, ${table})` }], serializerSettings: { includeNulls: true } },
  })
  assertQueryResult(data)
  state.validated = true
  persist()
  console.log('Semantic model is provisioned and its source read succeeded.')
  return state
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selectionPath = resolve(stateRoot, 'selection.json')
  Promise.resolve().then(() => {
    if (!existsSync(selectionPath)) throw new Error('Run npm run setup first.')
    return deployModel(readJson(selectionPath).workspaceId)
  }).catch((error) => { console.error(error.message); process.exitCode = 1 })
}
