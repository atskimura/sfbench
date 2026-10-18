# sfbench

sfbench runs Salesforce SOQL, REST API requests and anonymous Apex in your browser, on your own machine.
It uses the auth you already have in the sf CLI, so there is no connected app to create and nothing to set up in your org.

[日本語の README](README.ja.md)

![The SOQL screen of sfbench, with a query proposed by the AI](help/images/en/soql-ai.webp)

sfbench is the successor to [lwc-soql-builder](https://github.com/lwc-soql-builder/lwc-soql-builder).
lwc-soql-builder can no longer log in, because Salesforce has blocked the OAuth user-agent flow it relied on.

## Features

### SOQL

- Build SOQL by clicking. Find fields by API name or by label
- Pick fields through parent relationships and child relationships (subqueries)
- Completion that follows the cursor: objects after FROM, the target's fields after `Account.`, the child object's fields inside a subquery
- Leave out the namespace of a managed package
- Results of tens of thousands of rows load as you scroll. Child relationship records open in their own table
- Filter the loaded rows, and export the whole result to CSV
- Edit values in the result table and save them, or select rows and delete them
- Queries with the Tooling API and Query All, on the API version you choose

### REST API

- Send a request with its method, path, headers and JSON body. The body is formatted and colored
- See 4xx and 5xx answers as responses, with their status, headers and body
- Requests you sent stay in the history; click one to load it again

### Anonymous Apex

- Write Apex with syntax colors and run it, on the API version you choose
- Compile errors and exceptions come with a button that goes to their line and column
- Search the debug log, or show only its `USER_DEBUG` lines
- The code you ran stays in the history

### AI

- Write what you want, and an AI writes the SOQL, the REST API request or the anonymous Apex
- An AI fixes a query, a request or Apex that failed, from its error
- Proposals show as differences and change nothing until you replace. REST API requests and Apex are never sent or run by the AI: you press Send or Run
- Bring your own Anthropic or OpenAI API key, set in the settings

### And more

- AI agents (such as Claude Code) can open sfbench with a query, a request or Apex filled in
- In a production org, sfbench asks before anything that changes data
- sfbench asks before sending again a request whose outcome is not known (after a timeout, for example)

## Requirements

- Node.js 22.21.0 or later in the 22 line, or 24.5.0 or later
- The [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`), logged in to the orgs you use

sfbench runs on macOS, Linux and Windows.
You log in to orgs with the sf CLI:

```
sf org login web -a my-org
```

## Usage

```
npx sfbench
```

sfbench opens in your browser.
Choose an org from the org switcher at the top right.
Without `-o`, sfbench opens the sf CLI's default org (the one set with `sf config set target-org <alias>`).

The tabs at the top switch between SOQL, REST API and Apex.
Each screen keeps what you typed and its result while another is shown.
The [help](help/en/README.md) explains each screen.

### Command-line options

| Option | Description |
| --- | --- |
| `-o, --target-org <alias>` | The org to open |
| `--query "<SOQL>"` | Open with this SOQL in the editor |
| `--run` | Also run the `--query` SOQL |
| `--rest <path>` | Open the REST API screen with this request. It is not sent |
| `--method <method>` | The `--rest` request's method: GET (default), POST, PATCH, PUT or DELETE |
| `--body <json>`, `--body-file <file>` | The `--rest` request's JSON body |
| `--apex "<code>"`, `--apex-file <file>` | Open the Apex screen with this code. It is not run |
| `--json` | Print the opened URL and more as JSON |
| `--no-open` | Print the URL without opening a browser |
| `stop` | Stop the running sfbench |

A REST API request or Apex, which may change data, is only filled in: you send or run it with the button on the screen.

### From an AI agent

AI agents do not know sfbench yet.
Asked to "use sfbench" with no hint, Claude Code looked for an `sfbench` command, did not find it, and ran the query with the sf CLI instead.
For Claude Code, install the skill that teaches it sfbench, as a plugin from this repository:

```
claude plugin install sfbench --marketplace atskimura/sfbench
```

Inside Claude Code, `/plugin install sfbench --marketplace atskimura/sfbench` does the same.
Your instructions file (`CLAUDE.md`) stays as it is.
You can also put the skill's file in place yourself: [plugins/sfbench/skills/sfbench/SKILL.md](plugins/sfbench/skills/sfbench/SKILL.md) in English, or [plugins/sfbench/ja/sfbench/SKILL.md](plugins/sfbench/ja/sfbench/SKILL.md) in Japanese.
Copy the `sfbench` folder to where the agent reads skills (`~/.claude/skills/` for Claude Code, `~/.agents/skills/` for Codex; untested with Codex).

With the skill, ask Claude Code to "list the won opportunities in sfbench", and it writes the SOQL and starts sfbench like this:

```
npx -y sfbench -o my-org --query "SELECT Id, Name, Amount FROM Opportunity WHERE IsWon = true" --run
```

sfbench opens the result in your browser, and the command returns right away.
If sfbench is already running, it opens a new tab.

A REST API request or Apex can be filled in the same way:

```
npx -y sfbench -o my-org --rest /services/data/v62.0/sobjects/Account --method POST --body-file account.json
npx -y sfbench -o my-org --apex-file fix-data.apex
```

### Writing with AI

In the settings (the gear at the top right), choose the AI provider (Anthropic or OpenAI) and enter the model ID and your API key.
The key is saved in `~/.sfbench/settings.json` on your machine, readable by you only, and never shown in the browser.
sfbench calls the AI only when you press Generate or Fix with AI, and each call is billed to the key's owner by the provider.

What goes to the AI: the names, types and labels of objects and fields, picklist values, what is on the screen (the query or code in the editor, the request in the fields), and the error when fixing.
The pills under the input show what is sent; untick a pill to keep what is on the screen from being sent.
SOQL results are never sent.
A REST API response or an Apex result is sent only when you press "Use this result with AI".

## How it works

sfbench starts a small web server on your machine (`http://127.0.0.1:7717`, or the next free port up to 7736) and opens its page in your browser.
The server sends the requests to Salesforce, with an access token it gets from the sf CLI.
The token never goes to the browser or to any other server.
The server keeps running until you stop it with `npx sfbench stop`.

Settings, recent queries, and the REST API and Apex histories are saved in `~/.sfbench/`.
The server log is `~/.sfbench/server.log`.
The log never holds SOQL, request bodies, Apex code or record values.

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
