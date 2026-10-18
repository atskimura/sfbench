---
name: sfbench
description: Salesforce の SOQL、REST API の要求、匿名 Apex を、利用者のブラウザの sfbench で開く。sfbench は Salesforce CLI（sf）にログイン済みの組織を使う。利用者が sfbench に触れたとき、クエリの結果のレコードをブラウザで見たいとき、REST API の要求や Apex を用意してもらい、利用者が確かめてから自分で送信や実行をしたいときに使う。
---

# sfbench

sfbench は利用者の PC で動き、ブラウザで開く。
コマンドとしては入っていないので、`npx -y sfbench` で起動する。
まず引数を確かめる。

```
npx -y sfbench --help
```

## クエリの結果を見せる

SOQL を組み立て、`--run` を付けて開く。結果はブラウザに出る。

```
npx -y sfbench -o <alias> --query "SELECT Id, Name FROM Account WHERE Industry = 'Retail'" --run
```

`-o` には `sf org list` のエイリアスかユーザー名を渡す。付けなければ、sf CLI の既定の組織で開く。
コマンドはすぐに終わる。レコードはコマンドの出力ではなくブラウザに出るので、開いたクエリを利用者に伝える。

## REST API の要求や Apex を用意する

sfbench は入れるだけで、送信も実行もしない。利用者が確かめて、送信か実行を押す。

```
npx -y sfbench -o <alias> --rest /services/data/v62.0/sobjects/Account --method POST --body '{"Name": "Acme"}'
npx -y sfbench -o <alias> --apex-file <file.apex>
```

ボディやコードが長いときは、ファイルに書いて `--body-file` か `--apex-file` で渡す。
用意したものと、送信か実行を押すまで何も変わらないことを、利用者に伝える。

## そのほか

- `--json` を付けると、開いた URL を JSON で出す。`--no-open` を付けると、ブラウザを開かずに URL だけを出す。
- `npx -y sfbench stop` で、裏で動いているサーバーを止める。
- sf CLI が入っていないときや、組織にログインし直す必要があるときは、sfbench がそう出すので、利用者に伝える。
- sfbench が Node.js が古いと言ったら（プロジェクトが asdf や nvm で古い Node.js を指定していることがある）、メッセージのとおり、npm の Node.js 24 で同じ引数を付けて実行し直す: `npx -y -p node@24 -p sfbench -- sfbench -o <alias> ...`
- それ以外のエラーで止まったら、原因を推測せず、sfbench のメッセージをそのまま利用者に伝える。
