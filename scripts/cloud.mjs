import { AzureCliCredential } from '@azure/identity'

const credential = new AzureCliCredential()
const audiences = {
  fabric: 'https://api.fabric.microsoft.com',
  powerbi: 'https://analysis.windows.net/powerbi/api',
}
export const api = {
  fabric: 'https://api.fabric.microsoft.com/v1',
  powerbi: 'https://api.powerbi.com/v1.0/myorg',
}

export function guid(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ||
      /^0{8}-(0{4}-){3}0{12}$/.test(value)) throw new Error(`Invalid ${label}. Select an actual Fabric resource.`)
  return value
}

export async function token(service = 'fabric') {
  const result = await credential.getToken(`${audiences[service]}/.default`)
  if (!result?.token) throw new Error('Sign in with Azure CLI before running setup.')
  return result.token
}

export function trustedUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !(['api.fabric.microsoft.com', 'api.powerbi.com'].includes(url.hostname) ||
        /^wabi-[a-z0-9-]+\.analysis\.windows\.net$/.test(url.hostname))) {
    throw new Error('Fabric returned an untrusted continuation/operation URL.')
  }
  return url.href
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function errorDetail(data) {
  const error = data?.error ?? data
  const details = error?.['pbi.error']?.details ?? []
  return [error?.message ?? data?.message,
    ...details.filter((item) => item.code === 'DetailsMessage').map((item) => item.detail?.value)]
    .filter((value) => typeof value === 'string' && value.length)
    .join(' ').replaceAll('<oii>', '').replaceAll('</oii>', '')
}

export async function request(service, path, options = {}) {
  let url = trustedUrl(path.startsWith('https:') ? path : `${api[service]}${path}`)
  const accessToken = await token(service)
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    })
    if ([307, 308].includes(response.status) && response.headers.get('Location')) {
      url = trustedUrl(new URL(response.headers.get('Location'), url).href)
      continue
    }
    if (response.status === 429 && attempt < 4) {
      const delay = Math.min(60, Math.max(1, Number(response.headers.get('Retry-After')) || 5))
      await sleep(delay * 1000)
      continue
    }
    const text = await response.text()
    let data
    if (text) {
      try { data = JSON.parse(text) } catch (error) {
        throw new Error(`Fabric returned a non-JSON response (HTTP ${response.status}).`, { cause: error })
      }
    }
    if (!response.ok) {
      throw new Error(`${service} HTTP ${response.status}: ${data?.errorCode ?? data?.error?.code ?? 'request failed'}: ${errorDetail(data)}`)
    }
    return { status: response.status, headers: response.headers, data }
  }
  throw new Error('Fabric request exceeded the retry/redirect limit.')
}

export async function list(service, path) {
  const items = []
  const seen = new Set()
  let next = path
  while (next) {
    if (seen.has(next)) throw new Error('Fabric repeated an inventory continuation.')
    seen.add(next)
    const { data } = await request(service, next)
    if (!Array.isArray(data?.value)) throw new Error('Fabric returned an invalid inventory response.')
    items.push(...data.value)
    next = data.continuationUri
    if (!next && data.continuationToken) {
      const url = new URL(`${api[service]}${path}`)
      url.searchParams.set('continuationToken', data.continuationToken)
      next = url.href
    }
  }
  return items
}

export async function operation(response) {
  if (response.status !== 202) return response.data
  const location = response.headers.get('Location')
  if (!location) throw new Error('Fabric accepted the operation without a status URL.')
  const url = trustedUrl(location)
  for (let count = 0; count < 60; count++) {
    const delay = Math.min(30, Math.max(1, Number(response.headers.get('Retry-After')) || 5))
    await sleep(delay * 1000)
    const state = await request('fabric', url)
    if (state.data?.status === 'Succeeded') {
      return (await request('fabric', `${url.replace(/\/$/, '')}/result`)).data
    }
    if (['Failed', 'Cancelled'].includes(state.data?.status)) {
      throw new Error(`Fabric operation ${state.data.status}: ${state.data.error?.message ?? 'See Fabric operation details.'}`)
    }
    if (!['NotStarted', 'Running', 'InProgress'].includes(state.data?.status)) {
      throw new Error('Fabric returned an unknown operation status.')
    }
    response = state
  }
  throw new Error('Fabric operation is still running. Inspect its status before retrying setup.')
}
