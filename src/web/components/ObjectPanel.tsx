// The left panel: the object list, or the fields of the object in FROM
// (docs/screens.md "オブジェクトと項目の一覧（左）").
import { useMemo, useState } from 'react'
import { t } from '../i18n/i18n.ts'
import { nameKey } from '../soql/namespace.ts'
import type { DescribeGlobal } from '../api/client.ts'
import { describeGlobal, useLoadable, type Loadable } from '../state/describeCache.ts'
import { useReportOrgError } from '../state/OrgContext.tsx'
import { useSoql } from '../state/SoqlContext.tsx'
import { FieldPanel } from './FieldPanel.tsx'
import panel from './Panel.module.css'
import styles from './ObjectPanel.module.css'
import { ReloadButton } from './ReloadButton.tsx'

export function ObjectPanel({ username }: { username: string }) {
  const soql = useSoql()
  const globals = useLoadable(`${username}\n${soql.tooling}`, (refresh) => describeGlobal(username, soql.tooling, refresh))
  useReportOrgError(username, globals.error)

  // The FROM object, if the org has it (matching case and namespace loosely).
  const found = useMemo(() => {
    if (!soql.panelObject || !globals.data) return undefined
    const key = nameKey(soql.panelObject, soql.names.ns)
    return globals.data.sobjects.find((o) => nameKey(o.name, soql.names.ns) === key)
  }, [soql.panelObject, soql.names.ns, globals.data])

  // While FROM names an object the org does not have (such as a half-typed
  // name), the last object found stays shown (docs/web.md).
  const [last, setLast] = useState<{ data: DescribeGlobal; name: string }>()
  if (found && (last?.name !== found.name || last.data !== globals.data)) {
    setLast({ data: globals.data!, name: found.name })
  } else if (!soql.panelObject && last) {
    setLast(undefined)
  }
  const current = found?.name ?? (soql.panelObject && last?.data === globals.data ? last?.name : undefined)

  if (current) return <FieldPanel key={`${current}\n${soql.tooling}`} username={username} objectName={current} />
  return <ObjectList globals={globals} />
}

function ObjectList({ globals }: { globals: Loadable<DescribeGlobal> }) {
  const soql = useSoql()
  const [filter, setFilter] = useState('')
  const objects = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (globals.data?.sobjects ?? [])
      .filter((o) => o.queryable !== false)
      .filter((o) => !f || o.name.toLowerCase().includes(f) || o.label.toLowerCase().includes(f))
  }, [globals.data, filter])

  return (
    <section className={panel.panel} aria-label={t.sObjects}>
      <div className={panel.header}>
        <span className={panel.title}>{t.sObjects}</span>
        <span className={panel.spacer} />
        {globals.data && <span className={panel.meta}>{globals.data.sobjects.length}</span>}
        <ReloadButton label={t.reloadObjects} busy={globals.loading} onClick={globals.reload} />
      </div>
      <div className={panel.search}>
        <input
          className={panel.input}
          type="search"
          aria-label={t.filterObjects}
          placeholder={t.filterObjects}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className={panel.body} aria-busy={globals.loading}>
        {globals.error !== undefined && <p className={panel.empty}>{t.loadFailed}</p>}
        {globals.data && objects.length === 0 && <p className={panel.empty}>{t.noMatchingObjects}</p>}
        <ul className={styles.list}>
          {objects.map((o) => (
            <li key={o.name}>
              <button type="button" className={styles.item} onClick={() => soql.pickObject(o.name)}>
                <span>{o.label}</span>
                <span className={`${panel.meta} ${panel.mono}`}>{o.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
