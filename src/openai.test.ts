import { afterEach, expect, it, vi } from 'vitest'
import { askOpenAI, openAIEndpoint } from './openai'

const endpoint = 'https://test-resource.openai.azure.com/'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('sends only the explicit prompt with the user supplied API key', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    choices: [{ finish_reason: 'stop', message: { content: 'Answer' } }],
  }))
  vi.stubGlobal('fetch', request)
  expect(await askOpenAI(endpoint, 'model', 'test-token', 'Question')).toBe('Answer')
  const options = request.mock.calls[0][1]
  expect(options).toMatchObject({ redirect: 'error', credentials: 'omit' })
  expect(new Headers(options?.headers).get('api-key')).toBe('test-token')
  expect(new Headers(options?.headers).get('Authorization')).toBeNull()
  expect(JSON.parse(String(options?.body)).messages).toEqual([{ role: 'user', content: 'Question' }])
})
it('rejects unsafe endpoints and oversized input', async () => {
  expect(() => openAIEndpoint('https://untrusted.example/')).toThrow()
  await expect(askOpenAI(endpoint, 'model', 'token', 'x'.repeat(2001))).rejects.toThrow('2000')
})
it.each([401, 403, 429, 500])('surfaces upstream HTTP %s without returning a fake answer', async (status) => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })))
  await expect(askOpenAI(endpoint, 'model', 'token', 'Question')).rejects.toThrow()
})
it('rejects truncated answers', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    choices: [{ finish_reason: 'length', message: { content: 'Partial' } }],
  })))
  await expect(askOpenAI(endpoint, 'model', 'token', 'Question')).rejects.toThrow('output limit')
})
it.each([
  'http://test.openai.azure.com/', 'https://user:password@test.openai.azure.com/',
  'https://test.openai.azure.com:444/', 'https://test.openai.azure.com/?key=forbidden',
  'https://test.openai.azure.com/#fragment', 'https://test.openai.azure.com/other',
  'https://test.openai.azure.com.evil.example/',
])('rejects an unsafe credential destination: %s', (value) => {
  expect(() => openAIEndpoint(value)).toThrow()
})
it('sanitizes server and network errors that might contain credentials', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('request included demo-key')))
  await expect(askOpenAI(endpoint, 'model', 'demo-key', 'Question')).rejects.toThrow('CORS')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { message: 'demo-key' } }, { status: 500 })))
  await expect(askOpenAI(endpoint, 'model', 'demo-key', 'Question')).rejects.toThrow('HTTP 500')
})
it('rejects answers echoing the API key', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: 'demo-key' } }] })))
  await expect(askOpenAI(endpoint, 'model', 'demo-key', 'Question')).rejects.toThrow('credential-containing')
})
it('cancels after 60 seconds without a retry', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, options) =>
    new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
  vi.stubGlobal('fetch', fetch)
  const result = expect(askOpenAI(endpoint, 'model', 'demo-key', 'Question')).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(60_000)
  await result
  expect(fetch).toHaveBeenCalledOnce()
})
