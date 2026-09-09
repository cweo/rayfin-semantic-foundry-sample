import { useId, useRef, useState } from 'react'
import { askOpenAI } from './openai'
import { useRequest } from './useRequest'

export function OpenAIPanel() {
  const { busy, error, run, cancel } = useRequest()
  const [apiKey, setApiKey] = useState('')
  const [endpoint, setEndpoint] = useState(import.meta.env.VITE_OPENAI_ENDPOINT || '')
  const [deployment, setDeployment] = useState(import.meta.env.VITE_OPENAI_DEPLOYMENT || '')
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsId = useId()
  const settingsButton = useRef<HTMLButtonElement>(null)
  const configured = Boolean(endpoint.trim() && deployment.trim() && apiKey.trim())

  function closeSettings() {
    setSettingsOpen(false)
    settingsButton.current?.focus()
  }

  function clear() {
    cancel()
    setApiKey('')
    setPrompt('')
    setAnswer('')
  }

  return (
    <section className="panel" aria-labelledby="foundry-title">
      <div className="foundry-heading">
        <h2 id="foundry-title">Foundry</h2>
        <button ref={settingsButton} className="settings-toggle" type="button"
          aria-label="Foundry settings" title="Foundry settings"
          aria-expanded={settingsOpen} aria-controls={settingsId}
          onClick={() => setSettingsOpen((open) => !open)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M10 2h4l.6 3 2.1 1.2 2.9-.9 2 3.4-2.3 2.1v2.4l2.3 2.1-2 3.4-2.9-.9-2.1 1.2-.6 3h-4l-.6-3-2.1-1.2-2.9.9-2-3.4 2.3-2.1v-2.4L2.4 8.7l2-3.4 2.9.9L9.4 5Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
      <p className="muted">{configured ? `Configured for ${deployment}` : 'Open the settings gear to add your endpoint, model deployment and API key.'}</p>
      {settingsOpen && (
        <form id={settingsId} className="foundry-settings" aria-label="Foundry settings"
          onSubmit={(event) => { event.preventDefault(); closeSettings() }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              closeSettings()
            }
          }}>
          <p className="warning"><strong>Demo only.</strong> The key stays in page memory but is visible to this browser,
            extensions, developer tools and any injected script. Use a disposable demo resource, not a shared production key.</p>
          <label htmlFor="foundry-endpoint">Foundry resource endpoint</label>
          <input id="foundry-endpoint" type="url" value={endpoint} required disabled={busy}
            placeholder="https://your-resource.openai.azure.com/"
            onChange={(event) => { setEndpoint(event.target.value); setApiKey(''); setAnswer('') }} />
          <div className="foundry-settings-fields">
            <div>
              <label htmlFor="foundry-deployment">Model deployment name</label>
              <input id="foundry-deployment" value={deployment} required disabled={busy}
                onChange={(event) => setDeployment(event.target.value)} />
            </div>
            <div>
              <label htmlFor="foundry-key">Your Foundry API key (memory only)</label>
              <input id="foundry-key" type="password" value={apiKey} required disabled={busy}
                autoComplete="off" spellCheck={false} onChange={(event) => setApiKey(event.target.value)} />
            </div>
          </div>
          <p className="muted">Clear key, sign-out, account change or reload removes this page's reference.
            Closing settings keeps it in memory for this session. This cannot recall an already-sent request.</p>
          <button className="secondary" type="submit" disabled={busy}>Done</button>
        </form>
      )}
      <form onSubmit={(event) => {
        event.preventDefault()
        setAnswer('')
        void run((signal) => askOpenAI(endpoint, deployment, apiKey, prompt, signal), setAnswer)
      }}>
        <label htmlFor="model-prompt">Prompt</label>
        <textarea id="model-prompt" value={prompt} maxLength={2000} rows={3} required disabled={busy}
          onChange={(event) => setPrompt(event.target.value)} />
        <div className="actions">
          <button type="submit" disabled={busy || !configured}>{busy ? 'Asking Foundry...' : 'Ask Foundry'}</button>
          <button className="secondary" type="button" onClick={clear}>Clear key and response</button>
        </div>
      </form>
      <p className="muted">Demo only: your API key stays in page memory. Only your prompt is sent, never notes or model rows.
        Up to 1024 completion tokens; 60-second timeout; no retries. Model usage may incur charges.</p>
      {error && <p role="alert" className="error">{error}</p>}
      {answer && <p className="answer" role="status">{answer}</p>}
    </section>
  )
}
