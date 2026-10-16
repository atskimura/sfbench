// The left panel: the object list, or the fields of the object in FROM
// (docs/screens.md "オブジェクトと項目の一覧（左）").
import { useMemo, useState } from 'react'
import { t } from '../i18n/i18n.ts'
import { matches } from '../soql/completion.ts'
import { findByName } from '../soql/namespace.ts'
import type { DescribeGlobal } from '../apiClient.ts'
import { describeGlobal, useLoadable, type Loadable } from '../state/describeCache.ts'
import { useReportOrgError } from '../state/OrgContext.tsx'
import { useSoql } from '../state/SoqlContext.tsx'
import { FieldPanel } from './FieldPanel.tsx'
import { FilterInput } from './FilterInput.tsx'
import panel from './Panel.module.css'
import styles from './ObjectPanel.module.css'
import { ReloadButton } from './ReloadButton.tsx'

export function ObjectPanel({ username }: { username: string }) {
  const soql = useSoql()
  const globals = useLoadable(`${username}\n${soql.tooling}`, (refresh) => describeGlobal(username, soql.tooling, refresh))
  useReportOrgError(username, globals.error)

  // The FROM object, if the org has it (matching case and namespace loosely).
  const found = soql.panelObject && globals.data ? findByName(globals.data.sobjects, soql.panelObject, soql.names.ns) : undefined

  // While FROM names an object the org does not have (such as a half-typed
  // name), the last object found stays shown (docs/web.md).
  const [last, setLast] = useState<string>()
  if (found && last !== found.name) setLast(found.name)
  else if (!soql.panelObject && last) setLast(undefined)
  const lastStillListed = last !== undefined && globals.data?.sobjects.some((o) => o.name === last)
  const current = found?.name ?? (soql.panelObject && lastStillListed ? last : undefined)

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
      .filter((o) => !f || matches(f, o.name, o.label))
  }, [globals.data, filter])

  return (
    <section className={panel.panel} aria-label={t.sObjects}>
      <div className={panel.header}>
        <span className={panel.title}>{t.sObjects}</span>
        <span className={panel.spacer} />
        {globals.data && <span className={panel.meta}>{globals.data.sobjects.length}</span>}
        <ReloadButton label={t.reloadObjects} busy={globals.loading} onClick={globals.reload} />
      </div>
      <FilterInput label={t.filterObjects} value={filter} onChange={setFilter} />
      <div className={panel.body} aria-busy={globals.loading}>
        {globals.error !== undefined && <p className={panel.empty}>{t.loadFailed}</p>}
        {globals.data && objects.length === 0 && <p className={panel.empty}>{t.noMatchingObjects}</p>}
        <ul className={styles.list}>
          {objects.map((o) => (
            <li key={o.name}>
              <button type="button" className={styles.item} title={`${o.label} (${o.name})`} onClick={() => soql.pickObject(o.name)}>
                <span className={styles.line}>{o.label}</span>
                <span className={`${styles.line} ${panel.meta} ${panel.mono}`}>{o.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
