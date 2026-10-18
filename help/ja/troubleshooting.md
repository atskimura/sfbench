# 困ったとき

[ヘルプの目次](README.md)

## 「Salesforce CLI（sf）が見つかりません」と出る

sfbench は sf CLI の認証を使います。
[Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) をインストールしてから、`npx sfbench` を実行し直してください。

## 組織が一覧にない

sfbench の組織の一覧は、sf CLI にログイン済みの組織です。
ターミナルでログインしてから、組織の一覧を開き直してください。

```
sf org login web -a my-org
```

削除された組織、期限の切れたトライアルの組織、期限の切れたスクラッチ組織は、一覧に出しません。

## 「セッションが切れています」と出る、または「再ログインが必要な組織」に入っている

sf CLI に保存したログインが無効になっています。
画面に出ているコマンドをコピーし、ターミナルで実行してログインし直してください。

```
sf org login web --instance-url <URL> -a <alias>
```

ログインし直したら、組織の一覧の「接続を確かめ直す」を押します。

## 「この URL は使えません」と出る

sfbench を開く URL は、一度だけ使えて、時間がたつと使えなくなります。
ブラウザのブックマークや履歴から開いたときに出ます。
`npx sfbench` を実行して開き直してください。

## 「sfbench に接続できません」と出る

sfbench のサーバーが止まったか、起動し直されました。
`npx sfbench` を実行して開き直してください。
エディタの内容は、同じブラウザのタブに残しているので、開き直しても失われません。

## 結果のレコード ID を押すとログイン画面になる

ブラウザが Salesforce にログインしていません。
ヘッダーの「組織を開く」（外部リンクのアイコン）を一度押すと、ログイン済みの状態で組織が開き、以後はリンクがそのまま開きます。

## クエリや describe がタイムアウトする

設定の「接続」で、Salesforce の応答を待つ時間を延ばしてください（10秒から600秒）。

## 送った要求や実行した Apex の結果が分からない

タイムアウトや通信の切断で応答が届かなかったときは、Salesforce の側で処理が終わっていることがあります。
送り直す前に、Salesforce の画面か実行履歴で確かめてください。
同じ要求やコードを送り直そうとすると、sfbench は確認のダイアログを出します。

## 「sfbench needs Node.js 22.21.0 or later」と出る

その場所で使われる Node.js が古いためです。
asdf や nvm などで、プロジェクトのフォルダごとに古い Node.js を指定していると起きます。
npm の Node.js 24 を使えば、そのまま動かせます。

```
npx -y -p node@24 -p sfbench -- sfbench
```

## Claude Code のサンドボックスで sfbench が起動しない

Claude Code のシェルのサンドボックスを有効にしていると（`/sandbox`）、sfbench は起動できません。
`~/.npm/` と `~/.sfbench/` に書き込み、ローカルのサーバーを動かし続けるからです。
`~/.claude/settings.json` に次を足して、sfbench だけをサンドボックスの外で動かしてください。

```json
"sandbox": { "excludedCommands": ["npx -y sfbench *", "npx -y sfbench"] }
```

## AI が使えない

- 「接続を確かめる」で、提供元のエラー文を確かめてください。API キーの誤り、モデル ID の誤り、残高の不足がよくある原因です。
- 提供元を切り替えたら、モデル ID もその提供元のものにしてください。
- AI の欄が出ていないときは、設定の「AI」が「使わない」になっていないか確かめてください。

## sfbench を止める、版を上げる

```
npx sfbench stop
```

新しい版で起動するときは、版を指定します。

```
npx sfbench@latest
```

古い版のサーバーが動いていれば、sfbench がそれを止めてから新しい版で起動します。

## ログを見る

サーバーのログは `~/.sfbench/server.log` にあります。
ログには、SOQL、要求のボディ、Apex のコード、レコードの値を書きません。
不具合を報告するときは、[GitHub の Issues](https://github.com/atskimura/sfbench/issues) にログの該当部分を添えてください。
