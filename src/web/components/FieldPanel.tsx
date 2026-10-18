// The fields and child relationships of the object in FROM
// (docs/screens.md "オブジェクトと項目の一覧（左）", docs/parity.md).
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ChildRelationship, FieldDescribe } from '../apiClient.ts'
import { t } from '../i18n/i18n.ts'
import { matches } from '../soql/completion.ts'
import { nameKey } from '../soql/namespace.ts'
import { refKey } from '../soql/selection.ts'
import { describeGlobal, describeSObject, useLoadable } from '../state/describeCache.ts'
import { useReportOrgError } from '../state/OrgContext.tsx'
import { useSoql } from '../state/SoqlContext.tsx'
import { CollapseButton } from './CollapseButton.tsx'
import styles from './FieldPanel.module.css'
import { FilterInput } from './FilterInput.tsx'
import panel from './Panel.module.css'
import { ReloadButton } from './ReloadButton.tsx'

/** SOQL follows at most five levels of parent relationships. */
const MAX_PARENT_DEPTH = 5

type Sort = 'none' | 'asc' | 'desc'

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

export function FieldPanel({ username, objectName }: { username: string; objectName: string }) {
  const soql = useSoql()
  const [tab, setTab] = useState<'fields' | 'relationships'>('fields')
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<Sort>('none')
  const tabsId = useId()
  const describe = useLoadable(`${username}\n${objectName}\n${soql.tooling}\n${soql.apiVersion}`, (refresh) =>
    describeSObject(username, objectName, soql.tooling, soql.apiVersion, refresh),
  )
  useReportOrgError(username, describe.error)
  const d = describe.data

  return (
    <section className={panel.panel} aria-label={objectName}>
      <div className={panel.header}>
        <button type="button" className={styles.back} aria-label={t.backToObjects} title={t.backToObjects} onClick={soql.showObjectList}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M10 3L5 8l5 5" />
          </svg>
        </button>
        <div className={styles.heading}>
          <span className={styles.objectName}>{objectName}</span>
          <span className={panel.meta}>
            {d ? `${d.label} · ${t.fieldCount(d.fields.length)} · ${t.loadedAt(timeFormat.format(new Date(d.fetchedAt)))}` : ''}
          </span>
        </div>
        <span className={panel.spacer} />
        <ReloadButton label={t.reloadFields} busy={describe.loading} onClick={describe.reload} />
        {d && <FieldMenu fields={d.fields} onSort={setSort} />}
        <CollapseButton name="objects" label={t.hideObjects} side="left" />
      </div>
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          id={`${tabsId}-fields`}
          aria-selected={tab === 'fields'}
          className={styles.tab}
          onClick={() => setTab('fields')}
        >
          {t.fieldsTab}
        </button>
        <button
          type="button"
          role="tab"
          id={`${tabsId}-rels`}
          aria-selected={tab === 'relationships'}
          className={styles.tab}
          onClick={() => setTab('relationships')}
        >
          {t.childRelationshipsTab}
        </button>
      </div>
      <FilterInput label={t.filterFields} value={filter} onChange={setFilter} />
      <div className={panel.body} role="tabpanel" aria-labelledby={`${tabsId}-${tab === 'fields' ? 'fields' : 'rels'}`} aria-busy={describe.loading}>
        {describe.error !== undefined && <p className={panel.empty}>{t.loadFailed}</p>}
        {describe.pending && <p className={panel.empty}>{t.loading}</p>}
        {d && tab === 'fields' && (
          <FieldList username={username} fields={d.fields} relationships={[]} filter={filter} sort={sort} />
        )}
        {d && tab === 'relationships' && (
          <RelationshipList username={username} relationships={d.childRelationships} filter={filter} />
        )}
      </div>
    </section>
  )
}

function FieldMenu({ fields, onSort }: { fields: FieldDescribe[]; onSort: (s: Sort) => void }) {
  const soql = useSoql()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  // Close on a click outside the menu or on Escape.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      root.current?.querySelector('button')?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const choose = (action: () => void) => () => {
    action()
    setOpen(false)
  }
  return (
    <div className={styles.menuRoot} ref={root}>
      <button type="button" className={panel.button} aria-label={t.fieldMenu} title={t.fieldMenu} aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <ul className={styles.menu} role="menu">
          <li role="none">
            <button type="button" role="menuitem" onClick={choose(() => soql.selectAll(fields.map((f) => f.name)))}>
              {t.selectAllFields}
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" onClick={choose(soql.clearAll)}>
              {t.clearAllFields}
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" onClick={choose(() => onSort('asc'))}>
              {t.sortAsc}
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" onClick={choose(() => onSort('desc'))}>
              {t.sortDesc}
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}

function sortFields(fields: FieldDescribe[], sort: Sort): FieldDescribe[] {
  if (sort === 'none') return fields
  const sorted = [...fields].sort((a, b) => a.name.localeCompare(b.name))
  return sort === 'asc' ? sorted : sorted.reverse()
}

type FieldListProps = {
  username: string
  fields: FieldDescribe[]
  /** The parent relationship path to these fields, such as ['Account', 'Owner']. */
  relationships: string[]
  /** Set inside a child relationship: the fields go into that subquery. */
  childRelationship?: string
  /** Applies to the top level only, as in lwc-soql-builder. */
  filter?: string
  sort?: Sort
}

function FieldList({ username, fields, relationships, childRelationship, filter = '', sort = 'none' }: FieldListProps) {
  const soql = useSoql()
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return sortFields(fields, sort).filter((x) => !f || matches(f, x.name, x.label))
  }, [fields, filter, sort])

  const selected = useMemo(() => {
    if (!soql.selection) return new Set<string>()
    if (!childRelationship) return soql.selection.fields
    return soql.selection.subqueries.get(nameKey(childRelationship, soql.names.ns)) ?? new Set<string>()
  }, [soql.selection, soql.names.ns, childRelationship])

  if (shown.length === 0) return <p className={panel.empty}>{t.noMatchingFields}</p>
  return (
    <ul className={styles.tree} role="group">
      {shown.map((field) => (
        <FieldRow
          key={field.name}
          username={username}
          field={field}
          relationships={relationships}
          childRelationship={childRelationship}
          checked={selected.has(refKey({ name: field.name, relationships }, soql.names.ns))}
        />
      ))}
    </ul>
  )
}

function FieldRow({
  username,
  field,
  relationships,
  childRelationship,
  checked,
}: {
  username: string
  field: FieldDescribe
  relationships: string[]
  childRelationship?: string
  checked: boolean
}) {
  const soql = useSoql()
  const [expanded, setExpanded] = useState(false)
  const target = field.referenceTo[0]
  const canExpand = Boolean(field.relationshipName && target)
  const atMaxDepth = relationships.length >= MAX_PARENT_DEPTH
  // Fields inside a child relationship sit one level below it.
  const indent = relationships.length + (childRelationship ? 1 : 0)
  const id = useId()

  return (
    <li role="treeitem" aria-expanded={canExpand ? expanded : undefined} aria-selected={checked} className={checked ? styles.checked : undefined}>
      <div className={styles.row} style={{ paddingLeft: `calc(var(--space-3) + ${indent} * var(--space-4))` }}>
        {canExpand ? (
          <button
            type="button"
            className={styles.expand}
            // Focusable even at the limit, so that keyboard and screen reader users hear why it does not open.
            aria-label={atMaxDepth ? t.maxDepth : expanded ? t.collapseReference : t.expandReference}
            title={atMaxDepth ? t.maxDepth : expanded ? t.collapseReference : t.expandReference}
            aria-disabled={atMaxDepth || undefined}
            onClick={() => !atMaxDepth && setExpanded(!expanded)}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className={styles.expandSpacer} />
        )}
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={() => soql.toggleField({ name: field.name, relationships }, childRelationship)}
        />
        <label htmlFor={id} className={styles.label} title={`${field.label} (${field.name})`}>
          <span className={styles.line}>{field.label}</span>
          <span className={`${styles.subline} ${panel.meta} ${panel.mono}`}>
            <span className={styles.line}>{field.name}</span>
            <span className={styles.type}>{field.type}</span>
          </span>
        </label>
      </div>
      {expanded && target && field.relationshipName && (
        <ReferenceFields
          username={username}
          objectName={target}
          relationships={[...relationships, field.relationshipName]}
          childRelationship={childRelationship}
        />
      )}
    </li>
  )
}

function ReferenceFields({
  username,
  objectName,
  relationships,
  childRelationship,
}: {
  username: string
  objectName: string
  relationships: string[]
  childRelationship?: string
}) {
  const soql = useSoql()
  const describe = useLoadable(`${username}\n${objectName}\n${soql.tooling}\n${soql.apiVersion}`, () =>
    describeSObject(username, objectName, soql.tooling, soql.apiVersion),
  )
  useReportOrgError(username, describe.error)
  if (describe.error !== undefined) return <p className={panel.empty}>{t.loadFailed}</p>
  if (describe.pending || !describe.data) return <p className={panel.empty} aria-busy="true">{t.loading}</p>
  return <FieldList username={username} fields={describe.data.fields} relationships={relationships} childRelationship={childRelationship} />
}

function RelationshipList({ username, relationships, filter }: { username: string; relationships: ChildRelationship[]; filter: string }) {
  const soql = useSoql()
  // Child object labels come from the object list (already cached by the left panel).
  const globals = useLoadable(`${username}\n${soql.tooling}\n${soql.apiVersion}`, () => describeGlobal(username, soql.tooling, soql.apiVersion))
  const labels = useMemo(
    () => new Map((globals.data?.sobjects ?? []).map((o) => [o.name, o.label])),
    [globals.data],
  )
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return relationships
      .filter((r): r is ChildRelationship & { relationshipName: string } => Boolean(r.relationshipName))
      .filter((r) => !f || matches(f, r.relationshipName, r.childSObject))
      .sort((a, b) => a.relationshipName.localeCompare(b.relationshipName))
  }, [relationships, filter])
  if (shown.length === 0) return <p className={panel.empty}>{t.noChildRelationships}</p>
  return (
    <ul className={styles.tree} role="group">
      {shown.map((r) => (
        <RelationshipRow key={r.relationshipName} username={username} relationship={r} childLabel={labels.get(r.childSObject)} />
      ))}
    </ul>
  )
}

function RelationshipRow({
  username,
  relationship,
  childLabel,
}: {
  username: string
  relationship: ChildRelationship & { relationshipName: string }
  childLabel: string | undefined
}) {
  const soql = useSoql()
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const checked = soql.selection?.subqueries.has(nameKey(relationship.relationshipName, soql.names.ns)) ?? false
  return (
    <li role="treeitem" aria-expanded={expanded} aria-selected={checked} className={checked ? styles.checked : undefined}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.expand}
          aria-label={expanded ? t.collapseRelationship : t.expandRelationship}
          title={expanded ? t.collapseRelationship : t.expandRelationship}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <input id={id} type="checkbox" checked={checked} onChange={() => soql.toggleSubquery(relationship.relationshipName)} />
        <label htmlFor={id} className={styles.label} title={`${relationship.relationshipName} (${relationship.childSObject})`}>
          <span className={styles.line}>{relationship.relationshipName}</span>
          <span className={`${styles.line} ${panel.meta} ${panel.mono}`}>
            {childLabel ? `${childLabel} · ${relationship.childSObject}` : relationship.childSObject}
          </span>
        </label>
      </div>
      {expanded && (
        <ReferenceFields
          username={username}
          objectName={relationship.childSObject}
          relationships={[]}
          childRelationship={relationship.relationshipName}
        />
      )}
    </li>
  )
}
