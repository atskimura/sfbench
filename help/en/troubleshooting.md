# Troubleshooting

[Help contents](README.md)

## "The Salesforce CLI (sf) was not found"

sfbench uses the sf CLI's auth.
Install the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli), then run `npx sfbench` again.

## An org is missing from the list

The list holds the orgs you are logged in to with the sf CLI.
Log in from a terminal, then open the list again:

```
sf org login web -a my-org
```

Deleted orgs, expired trial orgs and expired scratch orgs are not listed.

## "Session expired", or the org is under "Orgs that need a new login"

The login saved in the sf CLI is no longer valid.
Copy the command shown on the screen and run it in a terminal to log in again:

```
sf org login web --instance-url <URL> -a <alias>
```

Then click "Check connections again" in the org list.

## "This URL has expired or was already used"

The URL that opens sfbench works once, for a short time.
You see this when you open it again from a bookmark or the browser history.
Run `npx sfbench` to open sfbench again.

## "sfbench cannot be reached"

The sfbench server stopped or was restarted.
Run `npx sfbench` to open sfbench again.
The editor text is kept in the same browser tab, so it is not lost.

## A record ID link opens the login page

Your browser is not logged in to Salesforce.
Click Open org (the external link icon) in the header once; the org opens logged in, and the links open directly from then on.

## A query or describe times out

Raise the time to wait for Salesforce under Connection in the settings (10 to 600 seconds).

## The outcome of a request or an Apex run is unknown

When the answer did not arrive (a timeout or a broken connection), Salesforce may still have processed it.
Check in Salesforce or in the history before you send it again.
If you send the same request or code again, sfbench asks first.

## "sfbench needs Node.js 22.21.0 or later"

The Node.js used there is too old.
It happens when asdf, nvm or the like pins an older Node.js in a project folder.
Node.js 24 from npm runs sfbench anyway:

```
npx -y -p node@24 -p sfbench -- sfbench
```

## sfbench does not start in Claude Code's sandbox

With Claude Code's command sandbox turned on (`/sandbox`), sfbench cannot start: it writes `~/.npm/` and `~/.sfbench/` and keeps a local server running.
Add this to `~/.claude/settings.json` so that sfbench alone runs outside the sandbox:

```json
"sandbox": { "excludedCommands": ["npx -y sfbench *", "npx -y sfbench"] }
```

## The AI does not work

- Click Test connection to see the provider's error message. A wrong API key, a wrong model ID or no credit left are common causes.
- After switching providers, use a model ID of that provider.
- If there is no AI input on the screens, check that AI is not set to Off in the settings.

## Stop sfbench, or update it

```
npx sfbench stop
```

To start the latest version, give it explicitly:

```
npx sfbench@latest
```

If an older version's server is running, sfbench stops it and starts the new one.

## Logs

The server log is `~/.sfbench/server.log`.
The log never holds SOQL, request bodies, Apex code or record values.
When you report a problem on [GitHub Issues](https://github.com/atskimura/sfbench/issues), include the relevant part of the log.
