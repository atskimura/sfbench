#!/usr/bin/env node
// Entry point of `npx sfbench`. See docs/design.md ("コマンドライン引数").
import { parseArgs } from 'node:util'
import { openSfbench, stopSfbench, UserError } from './launcher.ts'
import { serve } from './serve.ts'
import { packageVersion } from './version.ts'

const HELP = `Usage: sfbench [options]
       sfbench stop

Opens sfbench, a local workbench for Salesforce, in your browser.
It uses the orgs you logged in to with the Salesforce CLI (sf).

Options:
  -o, --target-org <alias>  Org to open. Defaults to the sf CLI's default org (target-org).
  --query "<SOQL>"          Open with this SOQL in the editor.
  --run                     Also run the --query SOQL.
  --json                    Print the result as JSON.
  --no-open                 Do not open a browser; print the URL instead.
  -h, --help                Show this help.
  -v, --version             Show the version.

Commands:
  stop                      Stop the background sfbench server.

Examples for AI agents:
  npx -y sfbench -o my-org --query "SELECT Id, Name FROM Account LIMIT 10" --run
  npx -y sfbench -o my-org --query "SELECT Id FROM Opportunity WHERE IsWon = true" --run --json
`

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    allowNegative: true,
    options: {
      'target-org': { type: 'string', short: 'o' },
      query: { type: 'string' },
      run: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      open: { type: 'boolean', default: true },
      dev: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  })
  const command = positionals[0]

  if (values.help) {
    process.stdout.write(HELP)
    return
  }
  if (values.version) {
    process.stdout.write(`${packageVersion()}\n`)
    return
  }
  // `serve` is internal: the background server process. --dev runs it in the foreground for development.
  if (command === 'serve' || values.dev) {
    await serve(values.dev)
    return
  }
  if (command === 'stop') {
    await stopSfbench()
    return
  }
  if (command !== undefined) throw new UserError(`Unknown command: ${command}. See \`sfbench --help\`.`)

  await openSfbench({
    targetOrg: values['target-org'],
    query: values.query,
    run: values.run,
    json: values.json,
    open: values.open,
  })
}

main().catch((e: unknown) => {
  if (e instanceof UserError || (e instanceof TypeError && (e as { code?: string }).code?.startsWith('ERR_PARSE_ARGS'))) {
    process.stderr.write(`sfbench: ${(e as Error).message}\n`)
  } else {
    process.stderr.write(`sfbench: ${(e as Error).stack ?? String(e)}\n`)
  }
  process.exitCode = 1
})
