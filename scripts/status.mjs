import { resolve } from 'node:path'
import { guid, list, request } from './cloud.mjs'
import { readJson } from './model.mjs'

export async function deploymentStatus(directory) {
  const registry = readJson(resolve(directory, 'rayfin', '.deployments.json'))
  const deployment = registry.deployments?.[registry.active]
  if (!deployment) throw new Error('The active deployment is missing from this sample registry.')
  const workspaceId = guid(deployment.fabricWorkspaceId, 'recorded workspace')
  const itemId = guid(deployment.fabricItemId, 'recorded app')
  const { data: app } = await request('fabric', `/workspaces/${workspaceId}/items/${itemId}`)
  if (app.type !== 'AppBackend' || app.id !== itemId) throw new Error('The recorded Fabric item is not this app backend.')
  // The pinned CLI incorrectly reports databases[0]. Never copy that fallback.
  const databases = (await list('fabric', `/workspaces/${workspaceId}/sqlDatabases`))
    .filter((database) => database.displayName === app.displayName)
  if (databases.length !== 1) {
    throw new Error('Cannot uniquely identify the SQL item named for this app. Inspect the app database association in Fabric; no first-database fallback is used.')
  }
  const model = readJson(resolve(directory, 'model.json'))
  if (model.workspaceId !== workspaceId || !model.validated) throw new Error('The app/model workspace or last model validation does not match.')
  guid(model.itemId, 'recorded model')
  const { data: semanticModel } = await request('fabric', `/workspaces/${workspaceId}/semanticModels/${model.itemId}`)
  if (!/^https:\/\/[a-z0-9-]+\.webapp\.fabricapps\.net\/?$/.test(deployment.hostingUrl ?? '')) {
    throw new Error('The deployment has no supported Fabric static hosting URL.')
  }
  const response = await fetch(new URL('rayfin.config.json', `${deployment.hostingUrl.replace(/\/$/, '')}/`), {
    credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`The hosted runtime configuration is unavailable (HTTP ${response.status}).`)
  const runtime = await response.json()
  if (runtime.workspaceId !== workspaceId || runtime.itemId !== itemId ||
      runtime.apiUrl !== deployment.fabricApiUrl || runtime.publishableKey !== deployment.publishableKey) {
    throw new Error('The hosted runtime does not match this app backend. Deployment is incomplete.')
  }
  return {
    workspaceId,
    app: { name: app.displayName, id: itemId },
    sqlDatabase: { name: databases[0].displayName, id: databases[0].id, match: 'exact app name; unique in workspace' },
    semanticModel: { name: semanticModel.displayName, id: model.itemId },
    portalUrl: deployment.fabricDeepLink,
    hostingUrl: deployment.hostingUrl,
    runtime: 'Hosted configuration matches this app',
  }
}
