// A result table: one CSS grid for the header and the rows, with only the
// visible rows drawn (docs/web.md "描画").
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import type { FieldValue } from '../../shared/api.ts'
import type { FieldDescribe } from '../apiClient.ts'
import { t } from '../i18n/i18n.ts'
import { isEditableValue } from '../results/editable.ts'
import {
  cellText,
  cellValue,
  columnWidth,
  isChildRecords,
  isNumberColumn,
  type ChildRecords,
  type Column,
  type SObjectRecord,
} from '../results/columns.ts'
import { isRecordId } from '../results/recordId.ts'
import { CellEditor } from './CellEditor.tsx'
import styles from './ResultTable.module.css'

/** The row height, also given to the CSS as --row-height so that both agree. */
const ROW_HEIGHT = 28
/** Load the next page when the last drawn row is this close to the end (docs/web.md). */
const NEAR_END_ROWS = 50

export type CellRef = { row: number; column: Column }

/** Editing the rows (docs/edit.md "画面"): a selection column first, changed cells marked, cells that open an input. */
export type TableEdit = {
  /** The field of a column that can be edited, else undefined. */
  fieldOf: (column: Column) => FieldDescribe | undefined
  /** A row's changed value in a column, if changed. */
  changed: (id: string, column: Column) => { value: FieldValue } | undefined
  /** The cell whose input is open. */
  editing: CellRef | undefined
  onEdit: (cell: CellRef | undefined) => void
  /** A cell's new value (the caller tells whether it is the row's own). */
  onSet: (row: number, column: Column, value: FieldValue) => void
  isSelected: (id: string) => boolean
  onSelectRows: (ids: readonly string[], on: boolean) => void
  /** The ids of the rows shown, for the header's checkbox. */
  shownIds: readonly string[]
  /** Salesforce's message for a row whose save or delete failed. */
  errorOf: (id: string) => string | undefined
  /** Shows a failed row's message (its mark is a button). */
  onShowError: (id: string) => void
  /** A save or delete is being sent: nothing can be changed. */
  disabled: boolean
}

const SELECT_COLUMN = '3.5em'

function idOf(record: SObjectRecord | undefined): string {
  return typeof record?.Id === 'string' ? record.Id : ''
}

type Props = {
  records: readonly SObjectRecord[]
  /** How many of `records` to show (the result may hold a page not yet in its state). Defaults to all. */
  loaded?: number
  /** Indices into `records` to show (the filtered rows), or undefined for all. */
  rows?: readonly number[]
  columns: readonly Column[]
  instanceUrl: string | undefined
  selected?: CellRef
  onSelect?: (cell: CellRef) => void
  onOpenChild?: (row: number, column: Column, child: ChildRecords) => void
  onNearEnd?: () => void
  label: string
  edit?: TableEdit
}

export function ResultTable({ records, loaded = records.length, rows, columns, instanceUrl, selected, onSelect, onOpenChild, onNearEnd, label, edit }: Props) {
  const scroll = useRef<HTMLDivElement>(null)
  const count = rows ? rows.length : loaded

  // Widths and alignment are decided once per column, so that they do not
  // change while scrolling: from the first rows, or for a column that a later
  // page brought, from the rows of the pages loaded since the last layout.
  const layout = useRef(new Map<string, { width: number; number: boolean }>())
  const laidOutUpTo = useRef(0)
  const template = useMemo(() => {
    const sample = records.slice(laidOutUpTo.current, loaded)
    for (const column of columns) {
      if (!layout.current.has(column.key)) {
        layout.current.set(column.key, { width: columnWidth(column, sample), number: isNumberColumn(column, sample) })
      }
    }
    laidOutUpTo.current = loaded
    // ch is the width of "0"; capitals and wide glyphs run wider, hence the margin.
    const widths = columns.map((c) => `calc(${layout.current.get(c.key)!.width * 1.2}ch + 2 * var(--space-3))`)
    return (edit ? [SELECT_COLUMN, ...widths] : widths).join(' ')
  }, [columns, records, loaded, edit])

  // The virtualizer's functions change on every render; this component does not memoize them.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scroll.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin: ROW_HEIGHT,
    initialRect: { width: 0, height: 600 },
  })
  const items = virtualizer.getVirtualItems()
  const lastIndex = items.length > 0 ? items[items.length - 1].index : -1

  useEffect(() => {
    if (onNearEnd && count > 0 && lastIndex >= count - NEAR_END_ROWS) onNearEnd()
  }, [onNearEnd, lastIndex, count])

  // Arrow keys move the selected cell (whose full text the panel shows below the table).
  const onKeyDown = (e: KeyboardEvent) => {
    // Keys typed in a cell's input are its own.
    if (e.target !== e.currentTarget) return
    // Enter opens the selected cell's input, as a double click does.
    if (e.key === 'Enter' && edit && selected) {
      e.preventDefault()
      startEdit(selected)
      return
    }
    if (!onSelect || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) || count === 0) return
    e.preventDefault()
    const position = selected ? (rows ? rows.indexOf(selected.row) : selected.row) : -1
    const columnIndex = selected ? Math.max(columns.findIndex((c) => c.key === selected.column.key), 0) : 0
    let nextPosition = Math.max(position, 0)
    let nextColumn = columnIndex
    if (position !== -1) {
      if (e.key === 'ArrowUp') nextPosition = Math.max(position - 1, 0)
      if (e.key === 'ArrowDown') nextPosition = Math.min(position + 1, count - 1)
      if (e.key === 'ArrowLeft') nextColumn = Math.max(columnIndex - 1, 0)
      if (e.key === 'ArrowRight') nextColumn = Math.min(columnIndex + 1, columns.length - 1)
    }
    onSelect({ row: rows ? rows[nextPosition] : nextPosition, column: columns[nextColumn] })
    virtualizer.scrollToIndex(nextPosition)
  }

  /** Opens a cell's input; a checkbox field flips at once instead. */
  const startEdit = (cell: CellRef) => {
    if (!edit || edit.disabled) return
    const field = edit.fieldOf(cell.column)
    const record = records[cell.row]
    if (!field || !record || !isEditableValue(cellValue(record, cell.column))) return
    if (field.type === 'boolean') {
      const now = edit.changed(idOf(record), cell.column)?.value ?? cellValue(record, cell.column)
      edit.onSet(cell.row, cell.column, now !== true)
      return
    }
    edit.onEdit(cell)
  }
  const shownSelected = edit ? edit.shownIds.filter((id) => edit.isSelected(id)).length : 0

  const before = items.length > 0 ? items[0].start - ROW_HEIGHT : 0
  const after = items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end + ROW_HEIGHT : 0

  return (
    <div
      ref={scroll}
      className={styles.scroll}
      style={{ '--row-height': `${ROW_HEIGHT}px` } as CSSProperties}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={onKeyDown}
    >
      <div className={styles.grid} role="table" aria-label={label} aria-rowcount={count + 1} style={{ gridTemplateColumns: template }}>
        <div className={`${styles.row} ${styles.header}`} role="row" aria-rowindex={1}>
          {edit && (
            <div role="columnheader" className={`${styles.cell} ${styles.selectCell}`}>
              <input
                type="checkbox"
                aria-label={t.selectAllRows}
                disabled={edit.disabled || edit.shownIds.length === 0}
                checked={edit.shownIds.length > 0 && shownSelected === edit.shownIds.length}
                ref={(el) => {
                  if (el) el.indeterminate = shownSelected > 0 && shownSelected < edit.shownIds.length
                }}
                onChange={(e) => edit.onSelectRows(edit.shownIds, e.target.checked)}
              />
            </div>
          )}
          {columns.map((c) => (
            <div key={c.key} role="columnheader" className={`${styles.cell} ${layout.current.get(c.key)?.number ? styles.number : ''}`} title={c.key}>
              {c.key}
            </div>
          ))}
        </div>
        <div className={styles.spacer} style={{ height: before }} />
        {items.map((item) => {
          const index = rows ? rows[item.index] : item.index
          const record = records[index]
          const id = idOf(record)
          const error = edit?.errorOf(id)
          return (
            <div key={index} className={styles.row} role="row" aria-rowindex={item.index + 2}>
              {edit && (
                <div role="cell" className={`${styles.cell} ${styles.selectCell}`}>
                  <input
                    type="checkbox"
                    aria-label={t.selectRow}
                    disabled={edit.disabled || !id}
                    checked={edit.isSelected(id)}
                    onChange={(e) => edit.onSelectRows([id], e.target.checked)}
                  />
                  {error && (
                    <button type="button" className={styles.rowError} aria-label={t.rowError} title={error} onClick={() => edit.onShowError(id)}>
                      !
                    </button>
                  )}
                </div>
              )}
              {columns.map((column) => {
                const field = edit?.fieldOf(column)
                const changed = edit && field ? edit.changed(id, column) : undefined
                const value = changed ? changed.value : cellValue(record, column)
                const isSelected = selected?.row === index && selected.column.key === column.key
                if (edit && field && edit.editing?.row === index && edit.editing.column.key === column.key) {
                  return (
                    <div key={column.key} role="cell" className={`${styles.cell} ${styles.editing}`}>
                      <CellEditor
                        field={field}
                        value={value}
                        label={t.editCell(column.key)}
                        onCommit={(next) => {
                          edit.onSet(index, column, next)
                          edit.onEdit(undefined)
                          scroll.current?.focus()
                        }}
                        onCancel={() => {
                          edit.onEdit(undefined)
                          scroll.current?.focus()
                        }}
                      />
                    </div>
                  )
                }
                const rounded = field !== undefined && !isEditableValue(cellValue(record, column))
                return (
                  <Cell
                    key={column.key}
                    value={value}
                    number={layout.current.get(column.key)?.number ?? false}
                    instanceUrl={instanceUrl}
                    selected={isSelected}
                    changed={changed !== undefined}
                    // A double click to edit a lookup must not follow its link.
                    linkable={!field}
                    title={rounded ? t.editRounded : undefined}
                    onSelect={onSelect && (() => onSelect({ row: index, column }))}
                    onDoubleClick={field ? () => startEdit({ row: index, column }) : undefined}
                    onOpenChild={onOpenChild && ((child) => onOpenChild(index, column, child))}
                  />
                )
              })}
            </div>
          )
        })}
        <div className={styles.spacer} style={{ height: after }} />
      </div>
    </div>
  )
}

function Cell({
  value,
  number,
  instanceUrl,
  selected,
  changed = false,
  linkable = true,
  title,
  onSelect,
  onDoubleClick,
  onOpenChild,
}: {
  value: unknown
  number: boolean
  instanceUrl: string | undefined
  selected: boolean
  /** Changed and not saved yet. */
  changed?: boolean
  /** A record Id shows as a link (not in a column being edited). */
  linkable?: boolean
  title?: string
  onSelect?: () => void
  onDoubleClick?: () => void
  onOpenChild?: (child: ChildRecords) => void
}) {
  const text = cellText(value)
  const className = `${styles.cell} ${number ? styles.number : ''} ${selected ? styles.selected : ''} ${changed ? styles.changed : ''}`
  let content: ReactNode = text
  if (isChildRecords(value) && onOpenChild) {
    content = (
      <button type="button" className={styles.child} onClick={() => onOpenChild(value)} title={t.openChildRecords}>
        {text}
      </button>
    )
  } else if (isRecordId(value) && instanceUrl && linkable) {
    content = (
      <a href={`${instanceUrl}/${value}`} target="_blank" rel="noreferrer">
        {text}
      </a>
    )
  }
  return (
    <div role="cell" className={className} title={title} onClick={onSelect} onDoubleClick={onDoubleClick}>
      {content}
      {/* Not by colour alone. */}
      {changed && <span className="visually-hidden">{t.cellChanged}</span>}
    </div>
  )
}
