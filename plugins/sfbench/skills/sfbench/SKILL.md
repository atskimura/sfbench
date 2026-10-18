---
name: sfbench
description: Opens Salesforce SOQL queries, REST API requests and anonymous Apex in sfbench, a workbench in the user's browser that uses the orgs logged in with the Salesforce CLI (sf). Use when the user mentions sfbench, or wants to see a query's records in the browser, or wants a REST API request or Apex prepared for them to check and send or run themselves.
---

# sfbench

sfbench runs on the user's machine and opens in their browser.
Run it with `npx -y sfbench`; it is not installed as a command.
Check the options first:

```
npx -y sfbench --help
```

## Show records of a query

Write the SOQL and open it with `--run`, so that the result shows in the browser:

```
npx -y sfbench -o <alias> --query "SELECT Id, Name FROM Account WHERE Industry = 'Retail'" --run
```

`-o` takes an org alias or username from `sf org list`; without it, sfbench opens the sf CLI's default org.
The command returns at once. Tell the user the query you opened; the records are in the browser, not in the command's output.

## Prepare a REST API request or Apex

sfbench fills them in but never sends or runs them: the user checks them and presses Send or Run.

```
npx -y sfbench -o <alias> --rest /services/data/v62.0/sobjects/Account --method POST --body '{"Name": "Acme"}'
npx -y sfbench -o <alias> --apex-file <file.apex>
```

For long bodies or code, write a file and use `--body-file` or `--apex-file`.
Tell the user what you prepared and that nothing changes until they press Send or Run.

## Notes

- Add `--json` to get the opened URL as JSON, and `--no-open` to print the URL without opening a browser.
- `npx -y sfbench stop` stops the background server.
- If the sf CLI is not installed or the org needs a new login, sfbench says so; pass that on to the user.
