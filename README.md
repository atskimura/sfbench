# sfbench

sfbench runs Salesforce SOQL, REST API requests and anonymous Apex in your browser, on your own machine.
It uses the auth you already have in the sf CLI, so there is no connected app to create and nothing to set up in your org.

[日本語の README](README.ja.md)

sfbench is the successor to [lwc-soql-builder](https://github.com/lwc-soql-builder/lwc-soql-builder).
lwc-soql-builder can no longer log in, because Salesforce has blocked the OAuth user-agent flow it relied on.

## Features

- Build SOQL by clicking. Find fields by API name or by label
- Pick fields through parent relationships and child relationships (subqueries)
- Completion that follows the cursor: objects after FROM, the target's fields after `Account.`, the child object's fields inside a subquery
- Leave out the namespace of a managed package
- Results of tens of thousands of rows load as you scroll. Child relationship records open in their own table
- Filter the loaded rows
- Export the whole result to CSV
- Queries with the Tooling API and Query All
- AI agents (such as Claude Code) can open sfbench with a query filled in

Running REST API requests and anonymous Apex, and having an AI write SOQL, will come in later versions.

## Requirements

- Node.js 22.21.0 or later in the 22 line, or 24.5.0 or later
- The [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`), logged in to the orgs you use

sfbench runs on macOS, Linux and Windows.
You log in to orgs with the sf CLI:

```
sf org login web -a my-org
```

## Usage

Start sfbench with:

```
npx sfbench
```

sfbench opens in your browser.
Choose an org from the org switcher at the top right.
Without `-o`, sfbench opens the sf CLI's default org (the one set with `sf config set target-org <alias>`).

### Command-line options

| Option | Description |
| --- | --- |
| `-o, --target-org <alias>` | The org to open |
| `--query "<SOQL>"` | Open with this SOQL in the editor |
| `--run` | Also run the `--query` SOQL |
| `--json` | Print the opened URL and more as JSON |
| `--no-open` | Print the URL without opening a browser |
| `stop` | Stop the running sfbench |

### From an AI agent

Ask an AI agent such as Claude Code to "list the won opportunities in sfbench", and it can write the SOQL and start sfbench like this:

```
npx -y sfbench -o my-org --query "SELECT Id, Name, Amount FROM Opportunity WHERE IsWon = true" --run
```

sfbench opens the result in your browser, and the command returns right away.
If sfbench is already running, it opens a new tab.

## How it works

sfbench starts a small web server on your machine (`http://127.0.0.1:7717`, or the next free port up to 7736) and opens its page in your browser.
The server sends the requests to Salesforce, with an access token it gets from the sf CLI.
The token never goes to the browser or to any other server.
The server keeps running until you stop it with `npx sfbench stop`.

Settings and recent queries are saved in `~/.sfbench/`.
The server log is `~/.sfbench/server.log`.

## Development

```
npm install
npm run dev   # starts the web dev server and the local server
```

Open `http://localhost:5173/launch/dev`.
Saved changes show up in the page and the server right away.

The design documents in [docs/](docs/) are in Japanese.

## License

MIT

The licenses of the libraries bundled into the web interface are under "Licenses" in the settings (`dist/web/licenses.txt` in the package).
