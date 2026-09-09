import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OpenAIPanel } from './OpenAIPanel'
import { askOpenAI } from './openai'

vi.mock('./openai', () => ({ askOpenAI: vi.fn() }))
const ask = vi.mocked(askOpenAI)
const testKey = 'demo-test-key'
beforeEach(() => { ask.mockReset() })
afterEach(cleanup)

function openSettings() {
  const button = screen.getByRole('button', { name: 'Foundry settings' })
  if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button)
}

function fill() {
  openSettings()
  fireEvent.change(screen.getByLabelText('Foundry resource endpoint'), { target: { value: 'https://test.openai.azure.com/' } })
  fireEvent.change(screen.getByLabelText('Model deployment name'), { target: { value: 'model' } })
  fireEvent.change(screen.getByLabelText('Your Foundry API key (memory only)'), { target: { value: testKey } })
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'My explicit prompt' } })
}
it('keeps the key out of storage and renders an answer as text, not markup', async () => {
  const store = vi.spyOn(Storage.prototype, 'setItem')
  ask.mockResolvedValue('<img src=x onerror=alert(1)>')
  const { container } = render(<OpenAIPanel />)
  fill()
  fireEvent.click(screen.getByRole('button', { name: 'Ask Foundry' }))
  expect(await screen.findByRole('status')).toHaveTextContent('<img src=x onerror=alert(1)>')
  expect(container.querySelector('img')).toBeNull()
  expect(ask).toHaveBeenCalledWith('https://test.openai.azure.com/', 'model', testKey, 'My explicit prompt', expect.any(AbortSignal))
  expect(store).not.toHaveBeenCalled()
  expect(screen.queryByText(testKey)).not.toBeInTheDocument()
  openSettings()
  expect(screen.getByLabelText('Your Foundry API key (memory only)')).toHaveAttribute('type', 'password')
})
it('clears the key when the endpoint changes', () => {
  render(<OpenAIPanel />)
  fill()
  openSettings()
  fireEvent.change(screen.getByLabelText('Foundry resource endpoint'), { target: { value: 'https://another.openai.azure.com/' } })
  expect(screen.getByLabelText('Your Foundry API key (memory only)')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Ask Foundry' })).toBeDisabled()
})
it('allows clearing during a request, aborts it, and discards late results', async () => {
  let finish!: (value: string) => void
  ask.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  render(<OpenAIPanel />)
  fill()
  fireEvent.click(screen.getByRole('button', { name: 'Ask Foundry' }))
  const signal = ask.mock.calls[0][4]
  const clear = screen.getByRole('button', { name: 'Clear key and response' })
  expect(clear).toBeEnabled()
  fireEvent.click(clear)
  expect(signal?.aborted).toBe(true)
  openSettings()
  expect(screen.getByLabelText('Your Foundry API key (memory only)')).toHaveValue('')
  expect(screen.getByLabelText('Prompt')).toHaveValue('')
  await act(async () => finish('Old answer'))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
it('aborts on unmount and never persists a key across remount', async () => {
  ask.mockImplementation(() => new Promise(() => {}))
  const rendered = render(<OpenAIPanel />)
  fill()
  fireEvent.click(screen.getByRole('button', { name: 'Ask Foundry' }))
  const signal = ask.mock.calls[0][4]
  rendered.unmount()
  expect(signal?.aborted).toBe(true)
  render(<OpenAIPanel />)
  openSettings()
  await waitFor(() => expect(screen.getByLabelText('Your Foundry API key (memory only)')).toHaveValue(''))
})
it('keeps configuration behind the gear and retains it when settings are reopened', () => {
  render(<OpenAIPanel />)
  const button = screen.getByRole('button', { name: 'Foundry settings' })
  expect(button).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByLabelText('Foundry resource endpoint')).not.toBeInTheDocument()
  fill()
  expect(screen.queryByLabelText('Your Foundry API key (memory only)')).not.toBeInTheDocument()
  expect(screen.getByText('Configured for model')).toBeVisible()
  expect(button).toHaveFocus()
  expect(ask).not.toHaveBeenCalled()
  openSettings()
  expect(button).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('form', { name: 'Foundry settings' }).id).toBe(button.getAttribute('aria-controls'))
  expect(screen.getByLabelText('Foundry resource endpoint')).toHaveValue('https://test.openai.azure.com/')
  expect(screen.getByLabelText('Model deployment name')).toHaveValue('model')
  expect(screen.getByLabelText('Your Foundry API key (memory only)')).toHaveValue(testKey)
})
it('closes settings with Escape and returns focus to the gear', () => {
  render(<OpenAIPanel />)
  openSettings()
  const endpoint = screen.getByLabelText('Foundry resource endpoint')
  endpoint.focus()
  fireEvent.keyDown(endpoint, { key: 'Escape' })
  const button = screen.getByRole('button', { name: 'Foundry settings' })
  expect(button).toHaveAttribute('aria-expanded', 'false')
  expect(button).toHaveFocus()
  expect(screen.queryByRole('form', { name: 'Foundry settings' })).not.toBeInTheDocument()
})
it('prevents incomplete configuration from enabling an inference call', () => {
  render(<OpenAIPanel />)
  openSettings()
  fireEvent.change(screen.getByLabelText('Your Foundry API key (memory only)'), { target: { value: testKey } })
  fireEvent.click(screen.getByRole('button', { name: 'Foundry settings' }))
  expect(screen.getByRole('button', { name: 'Ask Foundry' })).toBeDisabled()
  expect(ask).not.toHaveBeenCalled()
})
