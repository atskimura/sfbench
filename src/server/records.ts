// Saving and deleting records from the result table (docs/edit.md "サーバー"):
// what is accepted, and how sObject Collections' answer is passed back. Pure,
// so that it is tested without Salesforce.
import { MAX_RECORDS_PER_CALL, type FieldValue, type RecordError, type RecordResult, type RecordsDeleteRequest, type RecordsUpdateRequest } from '../shared/api.ts'

export class RecordsRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordsRequestError'
  }
}

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/
const ID = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/

function checkCount(n: number): void {
  if (n === 0) throw new RecordsRequestError('No records were given.')
  if (n > MAX_RECORDS_PER_CALL) throw new RecordsRequestError(`At most ${MAX_RECORDS_PER_CALL} records can be sent at once.`)
}

function checkId(id: unknown): string {
  if (typeof id !== 'string' || !ID.test(id)) throw new RecordsRequestError('Each record needs a 15 or 18 character Id.')
  return id
}

function isFieldValue(value: unknown): value is FieldValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
}

/** Checks a save from the screen; nothing is sent when it fails. */
export function checkUpdate(input: Record<string, unknown>): Pick<RecordsUpdateRequest, 'object' | 'records' | 'allOrNone'> {
  const { object, records, allOrNone } = input
  if (typeof object !== 'string' || !NAME.test(object)) throw new RecordsRequestError('object must be an object API name.')
  if (!Array.isArray(records)) throw new RecordsRequestError('records must be a list.')
  checkCount(records.length)
  const checked = records.map((record: unknown) => {
    if (!record || typeof record !== 'object') throw new RecordsRequestError('Each record must be an object.')
    const { id, fields } = record as Record<string, unknown>
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new RecordsRequestError('Each record needs its fields.')
    const entries = Object.entries(fields)
    if (entries.length === 0) throw new RecordsRequestError('Each record needs at least one field.')
    for (const [name, value] of entries) {
      if (!NAME.test(name) || name.toLowerCase() === 'id' || name === 'attributes') throw new RecordsRequestError(`Invalid field name: ${name}`)
      if (!isFieldValue(value)) throw new RecordsRequestError(`The value of ${name} must be text, true, false or null.`)
    }
    return { id: checkId(id), fields: fields as Record<string, FieldValue> }
  })
  return { object, records: checked, allOrNone: allOrNone === true }
}

/** Checks a delete from the screen; nothing is sent when it fails. */
export function checkDelete(input: Record<string, unknown>): Pick<RecordsDeleteRequest, 'ids' | 'allOrNone'> {
  const { ids, allOrNone } = input
  if (!Array.isArray(ids)) throw new RecordsRequestError('ids must be a list.')
  checkCount(ids.length)
  return { ids: ids.map(checkId), allOrNone: allOrNone === true }
}

/** The body of the sObject Collections update. */
export function updateBody(request: Pick<RecordsUpdateRequest, 'object' | 'records' | 'allOrNone'>): string {
  return JSON.stringify({
    allOrNone: request.allOrNone,
    records: request.records.map((r) => ({ attributes: { type: request.object }, ...r.fields, id: r.id })),
  })
}

function errorsOf(value: unknown): RecordError[] {
  if (!Array.isArray(value)) return []
  return value.map((e) => {
    const error = (e ?? {}) as Record<string, unknown>
    return {
      statusCode: typeof error.statusCode === 'string' ? error.statusCode : 'UNKNOWN',
      message: typeof error.message === 'string' ? error.message : '',
      fields: Array.isArray(error.fields) ? error.fields.filter((f): f is string => typeof f === 'string') : [],
    }
  })
}

/**
 * Salesforce's answers, one per record sent and in the same order. A failed
 * record has no id in the answer: the id sent is put in. An answer of another
 * shape is not guessed at: Salesforce took the call, so what it did is not
 * known, and the screen says so (an internal error is of unknown outcome).
 */
export function recordResults(ids: readonly string[], body: unknown): RecordResult[] {
  if (!Array.isArray(body) || body.length !== ids.length) throw new Error('sObject Collections answered in an unexpected form')
  return ids.map((id, i) => {
    const answer = (body[i] ?? {}) as Record<string, unknown>
    return { id, success: answer.success === true, errors: errorsOf(answer.errors) }
  })
}
