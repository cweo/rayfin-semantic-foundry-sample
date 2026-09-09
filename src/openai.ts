/* eslint-disable preserve-caught-error -- Request errors may contain user API keys; do not retain them as causes. */
export function openAIEndpoint(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port ||
      !/^[a-z0-9-]+\.(openai\.azure\.com|services\.ai\.azure\.com)$/.test(url.hostname) ||
      !['/', '/openai/v1', '/openai/v1/'].includes(url.pathname)) {
    throw new Error('Configure a valid HTTPS Azure OpenAI resource endpoint.')
  }
  return `${url.origin}/openai/v1/chat/completions`
}

export async function askOpenAI(endpoint: string, deployment: string, apiKey: string, prompt: string, signal?: AbortSignal): Promise<string> {
  if (!prompt.trim() || prompt.length > 2000) throw new Error('Enter a prompt of 1-2000 characters.')
  if (!deployment.trim() || !apiKey.trim()) throw new Error('Enter the deployment name and your API key.')
  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await fetch(openAIEndpoint(endpoint), {
      method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal,
      headers: { 'api-key': apiKey.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: deployment, messages: [{ role: 'user', content: prompt.trim() }],
        max_completion_tokens: 1024, stream: false,
      }),
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Foundry rejected the API key. Check the key, resource endpoint, and whether API-key authentication is enabled.')
      }
      if (response.status === 429) throw new Error('Azure OpenAI is rate limited. Retry later.')
      throw new Error(`Azure OpenAI request failed (HTTP ${response.status}).`)
    }
    const data: unknown = await response.json()
    const choice = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined
    if (!isRecord(choice) || !isRecord(choice.message)) throw new Error('The model returned an invalid response.')
    if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) throw new Error('The model declined this request.')
    if (choice?.finish_reason === 'length') throw new Error('The model reached the output limit. Try a simpler prompt.')
    if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw new Error('The model returned no text answer.')
    if (choice.message.content.includes(apiKey.trim())) throw new Error('The model returned an unexpected credential-containing response.')
    return choice.message.content.trim()
  } catch (error) {
    if (signal?.aborted) throw new Error('Request cancelled. A request already sent to Foundry may still be billed.')
    if (controller.signal.aborted) throw new Error('Foundry request timed out. Retry explicitly if needed.')
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new Error('The Foundry request failed. Check network access, CORS, and the response format.')
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }
}
