import { useState } from 'react'
import { isPortalHost, modelConnection, readModel } from './semanticModel'
import { useRequest } from './useRequest'

function valueText(value: unknown) {
  return value == null ? '-' : String(value)
}

export function SemanticModelPanel() {
  const { busy, error, run } = useRequest()
  const [selected, setSelected] = useState<string[]>(modelConnection?.columns.slice(0, 12).map((column) => column.name) ?? [])
  const [limit, setLimit] = useState(25)
  const [result, setResult] = useState<Awaited<ReturnType<typeof readModel>> | null>(null)
  return (
    <section className="panel">
      <h2>Lakehouse through a semantic model</h2>
      <p className="muted">Read-only DAX through the Fabric portal host. No Lakehouse GraphQL API, separate app registration, or app-visible user token.</p>
      {!isPortalHost() ? <p className="warning">Open this app using its Fabric portal item link, not the standalone website, to read model data.</p>
        : !modelConnection ? <p className="error" role="alert">Run setup to create the selected Lakehouse semantic model, then deploy this app.</p>
          : (
            <form onSubmit={(event) => {
              event.preventDefault()
              setResult(null)
              void run(() => {
                if (!modelConnection) throw new Error('The semantic model has not been configured.')
                return readModel(modelConnection, selected, limit)
              }, setResult)
            }}>
              <p>Model table: <strong>{modelConnection.table}</strong></p>
              <fieldset className="columns" disabled={busy}>
                <legend>Columns</legend>
                {modelConnection.columns.map((column) => (
                  <label className="check" key={column.name}>
                    <input type="checkbox" checked={selected.includes(column.name)} onChange={(event) => {
                      setSelected((current) => event.target.checked ? [...current, column.name] : current.filter((name) => name !== column.name))
                      setResult(null)
                    }} />{column.name}
                  </label>
                ))}
              </fieldset>
              <label htmlFor="row-limit">Row limit (1-100)</label>
              <input id="row-limit" type="number" value={limit} min={1} max={100} disabled={busy}
                onChange={(event) => { setLimit(Number(event.target.value)); setResult(null) }} />
              <button type="submit" disabled={busy || !selected.length}>{busy ? 'Reading model...' : 'Read model data'}</button>
            </form>
          )}
      {error && <p className="error" role="alert">{error}</p>}
      {result && <p className="muted" role="status">{result.rows.length} rows returned. Limited preview, not full history.</p>}
      {result && result.rows.length > 0 && (
        <div className="table-scroll" role="region" aria-label="Model results" tabIndex={0}>
          <table>
            <thead><tr>{result.columns.map((column, index) => <th key={index}>{column.name}</th>)}</tr></thead>
            <tbody>{result.rows.map((row, index) => (
              <tr key={index}>{result.columns.map((_, column) => <td key={column}>{valueText(row[column])}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}
