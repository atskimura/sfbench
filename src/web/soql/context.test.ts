import { describe, expect, it } from 'vitest'
import { cursorInfo } from './context.ts'

/** cursorInfo with the cursor at `|`. */
const at = (text: string) => cursorInfo(text.replace('|', ''), text.indexOf('|'))

describe('cursorInfo', () => {
  it('offers objects right after FROM, and keywords after the object name', () => {
    expect(at('SELECT Id FROM Acc|')).toMatchObject({ word: 'Acc', context: { kind: 'from', scope: { child: false } } })
    expect(at('SELECT Id FROM |')).toMatchObject({ word: '', context: { kind: 'from' } })
    expect(at('SELECT Id FROM Account WH|').context.kind).toBe('keyword')
    expect(at('SELECT Id FROM Account a LIM|').context.kind).toBe('keyword')
  })

  it('offers fields of the FROM object in SELECT, even before FROM is reached', () => {
    const info = at('SELECT Id, Na| FROM Account WHERE Name = null')
    expect(info).toMatchObject({ word: 'Na', from: 11, context: { kind: 'field', path: [], scope: { from: 'Account' } } })
  })

  it('offers fields in WHERE, GROUP BY, HAVING and ORDER BY', () => {
    for (const text of [
      'SELECT Id FROM Account WHERE Na|',
      'SELECT Id FROM Account WHERE Name = \'x\' AND (Ty|',
      'SELECT Industry FROM Account GROUP BY Ind|',
      'SELECT Id FROM Account ORDER BY Cr|',
    ]) {
      expect(at(text).context).toMatchObject({ kind: 'field', scope: { from: 'Account' } })
    }
  })

  it('follows parent relationships and drops the FROM alias', () => {
    expect(at('SELECT Account.Owner.Na| FROM Contact')).toMatchObject({
      word: 'Na',
      afterDot: false,
      context: { kind: 'field', path: ['Account', 'Owner'], scope: { from: 'Contact' } },
    })
    expect(at('SELECT c.Account.| FROM Contact c')).toMatchObject({
      word: '',
      afterDot: true,
      context: { kind: 'field', path: ['Account'] },
    })
  })

  it('offers child relationships after FROM in a SELECT subquery, and the child fields inside it', () => {
    const rel = at('SELECT Id, (SELECT Id FROM Con|) FROM Account')
    expect(rel.context).toMatchObject({ kind: 'from', scope: { child: true, parent: { from: 'Account' } } })
    const field = at('SELECT Id, (SELECT Id, La| FROM Contacts) FROM Account')
    expect(field.context).toMatchObject({ kind: 'field', path: [], scope: { from: 'Contacts', child: true, parent: { from: 'Account' } } })
  })

  it('treats a subquery in WHERE as a query on an object (semi-join)', () => {
    const info = at('SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Con|)')
    expect(info.context).toMatchObject({ kind: 'from', scope: { child: false } })
    const field = at('SELECT Id FROM Account WHERE Id IN (SELECT Acc| FROM Contact)')
    expect(field.context).toMatchObject({ kind: 'field', scope: { from: 'Contact', child: false } })
  })

  it('reads objects whose names are clause words, such as Group and Order', () => {
    expect(at('SELECT Na| FROM Group WHERE Type = null').context).toMatchObject({ kind: 'field', scope: { from: 'Group' } })
    expect(at('SELECT Id FROM Order ORDER BY Ord|').context).toMatchObject({ kind: 'field', scope: { from: 'Order' } })
  })

  it('does not complete inside a string, and ignores clause words in strings', () => {
    expect(at("SELECT Id FROM Account WHERE Name = 'Acme FR|").context.kind).toBe('none')
    expect(at("SELECT Id FROM Account WHERE Name = 'from where' AND Na|").context).toMatchObject({ kind: 'field', scope: { from: 'Account' } })
  })

  it('stays in the clause inside function parentheses', () => {
    expect(at('SELECT COUNT(I|) FROM Account').context).toMatchObject({ kind: 'field', scope: { from: 'Account' } })
  })

  it('offers keywords where no clause has started and after LIMIT', () => {
    expect(at('SEL|').context.kind).toBe('keyword')
    expect(at('SELECT Id FROM Account LIMIT 10 OFF|').context.kind).toBe('keyword')
  })

  it('finds a word typed in Japanese', () => {
    expect(at('SELECT 取引| FROM Account')).toMatchObject({ word: '取引', context: { kind: 'field' } })
  })
})
