import { useCallback, useEffect, useRef, useState } from 'react'

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'The request failed. Please retry.'
}

export function useRequest() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => {
    controller.current?.abort()
    controller.current = null
  }, [])

  const run = useCallback(async <T,>(
    operation: (signal: AbortSignal) => Promise<T>,
    complete: (value: T) => void,
  ) => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setBusy(true)
    setError('')
    try {
      const value = await operation(current.signal)
      if (controller.current === current) complete(value)
    } catch (cause) {
      if (controller.current === current) setError(errorText(cause))
    } finally {
      if (controller.current === current) {
        controller.current = null
        setBusy(false)
      }
    }
  }, [])

  const cancel = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    setBusy(false)
    setError('')
  }, [])

  return { busy, error, run, cancel }
}
