// Smoke test of the built sfbench server against a real org. Prints no tokens.
// Usage: SFBENCH_HOME=$(mktemp -d) node scripts/smoke.mjs dist/server/cli.js <org alias>
// Add SFBENCH_TRANSPORT=cli to go through `sf api request rest` instead of fetch.
// Run `npm run build` first. It starts, uses and stops a server in SFBENCH_HOME.
import { execFileSync } from 'node:child_process'

const cli = process.argv[2]
const org = process.argv[3]
const run = (args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' })

const t0 = Date.now()
const out = JSON.parse(run(['-o', org, '--query', 'SELECT Id, Name FROM Account LIMIT 2', '--run', '--no-open', '--json']))
console.log('launch:', { opened: out.opened, port: out.port, org: out.org, ms: Date.now() - t0 })
const base = `http://127.0.0.1:${out.port}`
const code = out.url.split('/launch/')[1]

const call = async (method, path, { session, body, origin = base } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(session ? { 'X-Sfbench-Session': session } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text.slice(0, 80) }
  return { status: res.status, json }
}

// Security checks
console.log('session from another origin:', (await call('POST', '/api/session', { body: { code }, origin: 'http://evil.example.com' })).status)
const s = await call('POST', '/api/session', { body: { code } })
console.log('session:', s.status, 'launch =', JSON.stringify(s.json.launch))
const session = s.json.sessionToken
console.log('code reuse:', (await call('POST', '/api/session', { body: { code } })).status)
console.log('no session:', (await call('GET', '/api/orgs', { origin: null })).status)
console.log('admin from browser origin:', (await call('GET', '/api/health')).status)

// The UI resolves the launch org (alias or username) against the org list.
const orgsForLaunch = await call('GET', '/api/orgs', { session, origin: null })
const username = orgsForLaunch.json.orgs.find((o) => o.alias === s.json.launch.org || o.username === s.json.launch.org).username
let t = Date.now()
const orgs = await call('GET', '/api/orgs', { session, origin: null })
console.log('orgs:', orgs.status, orgs.json.orgs.length, 'orgs; token leaked =', JSON.stringify(orgs.json).includes('!'), `${Date.now() - t}ms`)
t = Date.now()
const summary = await call('GET', `/api/orgs/${encodeURIComponent(username)}/summary`, { session, origin: null })
console.log('summary:', summary.status, JSON.stringify(summary.json), `${Date.now() - t}ms`)
t = Date.now()
const q = await call('POST', `/api/orgs/${encodeURIComponent(username)}/query`, { session, body: { soql: 'SELECT Id, Name FROM Account LIMIT 2' } })
console.log('query:', q.status, 'totalSize =', q.json.totalSize, 'apiUsage =', JSON.stringify(q.json.apiUsage), `${Date.now() - t}ms`)
const bad = await call('POST', `/api/orgs/${encodeURIComponent(username)}/query`, { session, body: { soql: 'SELECT Id FROM NoSuchObject__c' } })
console.log('bad query:', bad.status, bad.json.error.code, bad.json.error.status)
const both = await call('POST', `/api/orgs/${encodeURIComponent(username)}/query`, { session, body: { soql: 'SELECT Id FROM ApexClass', tooling: true, queryAll: true } })
console.log('tooling+queryAll:', both.status)
const next = await call('POST', `/api/orgs/${encodeURIComponent(username)}/query/next`, { session, body: { nextRecordsUrl: 'https://evil.example.com/services/data/' } })
console.log('next to another host:', next.status)
t = Date.now()
const d1 = await call('GET', `/api/orgs/${encodeURIComponent(username)}/sobjects/Account`, { session, origin: null })
const t1 = Date.now() - t
t = Date.now()
const d2 = await call('GET', `/api/orgs/${encodeURIComponent(username)}/sobjects/Account`, { session, origin: null })
console.log('describe:', d1.status, d1.json.fields?.length, 'fields', `${t1}ms`, 'cached:', d2.status, `${Date.now() - t}ms`)
const hist = await call('GET', `/api/orgs/${encodeURIComponent(username)}/history`, { session, origin: null })
console.log('history:', hist.json.entries.map((e) => e.soql))
console.log('unknown org:', (await call('GET', '/api/orgs/nobody%40example.com/summary', { session, origin: null })).status)
const settings = await call('PUT', '/api/settings', { session, body: { omitNamespace: false } })
console.log('settings:', settings.status, JSON.stringify(settings.json))

// Reuse: a second launch must not start another server
const out2 = JSON.parse(run(['-o', org, '--no-open', '--json']))
console.log('second launch same port:', out2.port === out.port)
console.log(run(['stop']).trim())
console.log('after stop, health:', await fetch(`${base}/api/health`).then(() => 'answered').catch(() => 'no answer'))
