import { RayfinClient, resolveRayfinConfig } from '@microsoft/rayfin-client'
import type { FabricAuthOptions } from '@microsoft/rayfin-auth-provider-fabric'
import type { AppSchema } from '../../rayfin/data/schema'
export type { Note } from '../../rayfin/data/Note'

export type NotesClient = RayfinClient<AppSchema>
export interface NotesConnection {
  client: NotesClient
  fabricOptions: FabricAuthOptions
}

export async function createNotesConnection(
  environment: Record<string, string | undefined>,
  origin: string,
): Promise<NotesConnection> {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)
  const resolved = await resolveRayfinConfig(local ? {
    apiUrl: environment.VITE_RAYFIN_API_URL,
    publishableKey: environment.VITE_RAYFIN_PUBLISHABLE_KEY,
    workspaceId: environment.VITE_FABRIC_WORKSPACE_ID,
    itemId: environment.VITE_FABRIC_ITEM_ID,
    portalUrl: environment.VITE_FABRIC_PORTAL_URL,
  } : {})
  const baseUrl = resolved.baseUrl?.trim()
  const publishableKey = resolved.publishableKey?.trim()
  const workspaceId = resolved.runtimeConfig.workspaceId?.trim()
  const projectId = resolved.runtimeConfig.itemId?.trim()
  const portalUrl = resolved.runtimeConfig.portalUrl?.trim() || 'https://app.fabric.microsoft.com'
  if (!baseUrl || !publishableKey || !workspaceId || !projectId) {
    throw new Error('Deploy this sample with npm run deploy -- --workspace-id <id>, then run npm run dev. Hosted notes require rayfin.config.json from that deployment.')
  }
  for (const value of [baseUrl, portalUrl]) {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Use HTTPS notes backend and Fabric portal URLs without credentials or query parameters.')
    }
  }
  return {
    client: new RayfinClient<AppSchema>({
      baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
      publishableKey,
      authStorage: true,
    }),
    fabricOptions: { workspaceId, projectId, fabricPortalUrl: portalUrl, returnOrigin: origin },
  }
}
