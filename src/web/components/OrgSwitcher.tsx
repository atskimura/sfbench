// The org button in the header and the org list popover (docs/screens.md "組織の切り替え").
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Org } from '../../shared/api.ts'
import { t } from '../i18n/i18n.ts'
import { isProductionByList, orgKindLabel } from '../orgs/production.ts'
import { useOrgs, type OrgStatus } from '../state/OrgContext.tsx'
import { CommandText } from './CommandText.tsx'
import { CopyCommand } from './CopyCommand.tsx'
import { ChevronDownIcon } from './icons.tsx'
import styles from './OrgSwitcher.module.css'

export function OrgSwitcher() {
  const { selectedOrg, selectedSummary, pickerOpen, setPickerOpen, status } = useOrgs()
  const popoverId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on Escape or a click outside.
  useEffect(() => {
    if (!pickerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && selectedOrg && setPickerOpen(false)
    const onClick = (e: MouseEvent) => {
      if (selectedOrg && rootRef.current && !rootRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [pickerOpen, selectedOrg, setPickerOpen])

  const dot = selectedOrg ? dotClass(status[selectedOrg.username]) : styles.dotUnknown

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.button}
        aria-expanded={pickerOpen}
        aria-controls={popoverId}
        onClick={() => setPickerOpen(!pickerOpen)}
      >
        <span className={`${styles.dot} ${dot}`} />
        <span className={styles.alias}>{selectedOrg ? (selectedOrg.alias ?? selectedOrg.username) : t.selectOrg}</span>
        {selectedOrg && <span className={styles.kind}>{orgKindLabel(selectedOrg, selectedSummary)}</span>}
        <ChevronDownIcon />
      </button>
      {pickerOpen && <OrgPopover id={popoverId} />}
    </div>
  )
}

function dotClass(status: OrgStatus | undefined): string {
  if (!status) return styles.dotUnknown
  return status.state === 'ok' ? styles.dotOk : styles.dotError
}

function OrgPopover({ id }: { id: string }) {
  const { orgs, loading, loadError, selected, selectOrg, status, notice } = useOrgs()
  const [filter, setFilter] = useState('')
  const inputId = useId()
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (orgs ?? []).filter((o) => !f || o.username.toLowerCase().includes(f) || o.alias?.toLowerCase().includes(f))
  }, [orgs, filter])

  return (
    <div className={styles.popover} id={id} role="dialog" aria-label={t.selectOrg}>
      <div className={styles.top}>
        {notice && (
          <p className={styles.notice}>
            <CommandText text={notice} />
          </p>
        )}
        <label htmlFor={inputId} className="visually-hidden">
          {t.findOrg}
        </label>
        <input
          id={inputId}
          className={styles.filter}
          type="search"
          placeholder={t.findOrg}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
        />
      </div>
      <div className={styles.list} aria-busy={loading}>
        {orgs === undefined && loading && <p className={styles.message}>{t.loadingOrgs}</p>}
        {loadError && <p className={styles.message}>{loadError}</p>}
        {orgs?.length === 0 && !loading && (
          <div className={styles.message}>
            <p>{t.noOrgs}</p>
            <CopyCommand command="sf org login web -a <alias>" />
          </div>
        )}
        <ul className={styles.orgs}>
          {shown.map((org) => (
            <OrgRow
              key={org.username}
              org={org}
              current={org.username === selected}
              status={status[org.username]}
              onSelect={() => selectOrg(org.username)}
            />
          ))}
        </ul>
      </div>
      <div className={styles.bottom}>
        <span>{t.addOrg}</span>
        <CopyCommand command="sf org login web -a <alias>" />
      </div>
    </div>
  )
}

function OrgRow({ org, current, status, onSelect }: { org: Org; current: boolean; status: OrgStatus | undefined; onSelect: () => void }) {
  const badge =
    org.kind === 'sandbox'
      ? styles.badgeSandbox
      : org.kind === 'scratch'
        ? styles.badgeScratch
        : isProductionByList(org)
          ? styles.badgeProduction
          : styles.badgeNeutral
  return (
    <li className={`${styles.row} ${current ? styles.current : ''}`}>
      <button type="button" className={styles.select} onClick={onSelect} aria-current={current}>
        <span className={`${styles.dot} ${dotClass(status)}`} />
        <span className={styles.names}>
          <span className={styles.rowTitle}>
            <span className={styles.rowAlias}>{org.alias ?? org.username}</span>
            <span className={`${styles.badge} ${badge}`}>{orgKindLabel(org)}</span>
            {org.isExpired && <span className={`${styles.badge} ${styles.badgeNeutral}`}>expired</span>}
          </span>
          {org.alias && <span className={styles.username}>{org.username}</span>}
          {org.expirationDate && !org.isExpired && <span className={styles.note}>Expires {org.expirationDate}</span>}
        </span>
      </button>
      {status?.state === 'authError' && status.reloginCommand && (
        <div className={styles.relogin}>
          <span>{t.orgAuthError}</span>
          <CopyCommand command={status.reloginCommand} />
        </div>
      )}
    </li>
  )
}
