// A result table: one CSS grid for the header and the rows, with only the
// visible rows drawn (docs/web.md "描画").
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { t } from '../i18n/i18n.ts'
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
import styles from './ResultTable.module.css'

/** The row height, also given to the CSS as --row-height so that both agree. */
const ROW_HEIGHT = 28
/** Load the next page when the last drawn row is this close to the end (docs/web.md). */
const NEAR_END_ROWS = 50

export type CellRef = { row: number; column: Column }

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
}

export function ResultTable({ records, loaded = records.length, rows, columns, instanceUrl, selected, onSelect, onOpenChild, onNearEnd, label }: Props) {
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
    return columns.map((c) => `calc(${layout.current.get(c.key)!.width * 1.2}ch + 2 * var(--space-3))`).join(' ')
  }, [columns, records, loaded])

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
          return (
            <div key={index} className={styles.row} role="row" aria-rowindex={item.index + 2}>
              {columns.map((column) => (
                <Cell
                  key={column.key}
                  value={cellValue(record, column)}
                  number={layout.current.get(column.key)?.number ?? false}
                  instanceUrl={instanceUrl}
                  selected={selected?.row === index && selected.column.key === column.key}
                  onSelect={onSelect && (() => onSelect({ row: index, column }))}
                  onOpenChild={onOpenChild && ((child) => onOpenChild(index, column, child))}
                />
              ))}
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
  onSelect,
  onOpenChild,
}: {
  value: unknown
  number: boolean
  instanceUrl: string | undefined
  selected: boolean
  onSelect?: () => void
  onOpenChild?: (child: ChildRecords) => void
}) {
  const text = cellText(value)
  const className = `${styles.cell} ${number ? styles.number : ''} ${selected ? styles.selected : ''}`
  let content: ReactNode = text
  if (isChildRecords(value) && onOpenChild) {
    content = (
      <button type="button" className={styles.child} onClick={() => onOpenChild(value)} title={t.openChildRecords}>
        {text}
      </button>
    )
  } else if (isRecordId(value) && instanceUrl) {
    content = (
      <a href={`${instanceUrl}/${value}`} target="_blank" rel="noreferrer">
        {text}
      </a>
    )
  }
  return (
    <div role="cell" className={className} onClick={onSelect}>
      {content}
    </div>
  )
}
