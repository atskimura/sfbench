// Record IDs in results become links (docs/web.md "子リレーションとレコード").

const SUFFIX_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'

/**
 * True for an 18-character Salesforce ID. The last three characters encode
 * the case of the first fifteen, so checking them avoids taking any
 * 18-character text for an ID.
 */
export function isRecordId(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9]{18}$/.test(value)) return false
  let suffix = ''
  for (let block = 0; block < 3; block++) {
    let bits = 0
    for (let i = 0; i < 5; i++) {
      const c = value[block * 5 + i]
      if (c >= 'A' && c <= 'Z') bits |= 1 << i
    }
    suffix += SUFFIX_CHARS[bits]
  }
  return value.slice(15) === suffix
}
