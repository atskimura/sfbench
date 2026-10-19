# sfbench

sfbench は、Salesforce の SOQL、REST API、匿名 Apex を手元のブラウザで実行するツールです。
認証は sf CLI に保存済みのものを使うので、接続アプリケーションの作成や組織の設定は要りません。

[English README](README.md)

![sfbench の SOQL の画面。AI がクエリを提案している](help/images/ja/soql-ai.webp)

sfbench は [lwc-soql-builder](https://github.com/lwc-soql-builder/lwc-soql-builder) の後継です。
lwc-soql-builder は、Salesforce が OAuth のユーザーエージェントフローを使えなくしたため、ログインできなくなりました。

## 特徴

### SOQL

- クリック操作で SOQL を組み立てる。項目を API 名でもラベルでも探せる
- 親リレーション、子リレーション（サブクエリ）をたどって項目を選ぶ
- カーソルの位置に応じた補完（FROM のあとはオブジェクト、`Account.` のあとは参照先の項目、サブクエリの中は子オブジェクトの項目）
- 管理パッケージの名前空間を省略して書ける
- 数万件の結果も、スクロールに合わせて続きを読み込む。子リレーションのレコードは表で開く
- 読み込んだ結果の行を絞り込み、全件を CSV に出力する
- 結果の表で値を書き換えて保存し、行を選んで削除する
- Tooling API と Query All でのクエリ、API バージョンの指定

### REST API

- メソッド、パス、ヘッダー、JSON のボディを入れて送る。ボディの整形と色分け
- 4xx と 5xx もレスポンスとして、ステータス、ヘッダー、本文を見る
- 送った要求は実行履歴に残り、押すと欄に読み込む

### 匿名 Apex

- Apex を色分けして書き、実行する。API バージョンも指定できる
- コンパイルエラーと例外は、行と列へ移るボタン付きで出す
- デバッグログを検索し、`USER_DEBUG` の行だけに絞る
- 実行したコードは実行履歴に残る

### AI

- やりたいことを書くと、AI が SOQL、REST API の要求、匿名 Apex を組む
- 失敗したクエリ、要求、Apex を、エラー文をもとに AI が直す
- AI の提案は差分で見せ、置き換えるまで画面を変えない。REST API と Apex は、置き換えても自動では送らない・実行しない
- Anthropic か OpenAI の API キーを、設定画面で入れて使う

### そのほか

- AI のエージェント（Claude Code など）から、クエリや要求を入れた状態で起動できる
- 本番の組織では、データを変える操作の前に確認する
- 結果が分からなかった要求（タイムアウトなど）を送り直す前に確認する

## 必要なもの

- Node.js 22.21.0 以上の 22 系、または 24.5.0 以上（プロジェクトで古い Node.js を指定していても、`npx -y -p node@24 -p sfbench -- sfbench` で動かせます）
- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli)（`sf`）と、使う組織へのログイン

macOS、Linux、Windows で動きます。
組織へのログインは sf CLI で行います。

```
sf org login web -a my-org
```

## 使い方

```
npx sfbench
```

ブラウザで sfbench が開きます。
組織は、画面右上の組織の切り替えから選びます。
`-o` を付けない場合は、sf CLI の既定の組織（`sf config set target-org <alias>` で設定したもの）で開きます。

画面の上のタブで、SOQL、REST API、Apex を切り替えます。
タブを切り替えても、それぞれの画面の入力や結果は残ります。
各画面の使い方は、[ヘルプ](help/ja/README.md)にあります。

### コマンドライン引数

| 引数 | 内容 |
| --- | --- |
| `-o, --target-org <alias>` | 開く組織 |
| `--query "<SOQL>"` | SOQL を入力した状態で開く |
| `--run` | `--query` の SOQL を実行した状態で開く |
| `--rest <path>` | REST API の画面を、この要求を入れた状態で開く。送信はしない |
| `--method <method>` | `--rest` の要求のメソッド。GET（既定）、POST、PATCH、PUT、DELETE |
| `--body <json>`、`--body-file <file>` | `--rest` の要求の JSON のボディ |
| `--apex "<code>"`、`--apex-file <file>` | Apex の画面を、このコードを入れた状態で開く。実行はしない |
| `--json` | 開いた URL などを JSON で出力する |
| `--no-open` | ブラウザを開かず、URL だけを出力する |
| `stop` | 起動中の sfbench を止める |

データを変えうる REST API の要求と Apex は、入れた状態で開くだけで、送信や実行は画面のボタンで行います。

### AI のエージェントから使う

AI のエージェントは、sfbench をまだ知りません。
何も教えずに「sfbench で〜」と頼むと、Claude Code は `sfbench` コマンドを探して見つけられず、sf CLI で直接クエリを実行しました。
Claude Code には、sfbench の使い方を教えるスキルを、このリポジトリからプラグインとして入れられます。

```
claude plugin install sfbench --marketplace atskimura/sfbench
```

Claude Code の中では `/plugin install sfbench --marketplace atskimura/sfbench` でも入れられます。
指示ファイル（`CLAUDE.md`）を書き換える必要はありません。
スキルのファイルを自分で置くこともできます。
日本語版は [plugins/sfbench/ja/sfbench/SKILL.md](plugins/sfbench/ja/sfbench/SKILL.md)、英語版は [plugins/sfbench/skills/sfbench/SKILL.md](plugins/sfbench/skills/sfbench/SKILL.md) です。
`sfbench` フォルダごと、エージェントがスキルを読む場所（Claude Code なら `~/.claude/skills/`、Codex なら `~/.agents/skills/`）に置きます（Codex では試していません）。

Claude Code のシェルのサンドボックスを有効にしている場合（`/sandbox`）、sfbench はサンドボックスの中では起動できません。
`~/.npm/` と `~/.sfbench/` に書き込み、ローカルのサーバーを動かし続けるからです。
`~/.claude/settings.json` に次を足し、sfbench だけをサンドボックスの外で動かしてください。

```json
"sandbox": { "excludedCommands": ["npx -y sfbench *", "npx -y sfbench", "npx -y -p node@24 -p sfbench -- sfbench *", "npx -y -p node@24 -p sfbench -- sfbench"] }
```

スキルを入れた Claude Code に「sfbench で成約済みの商談を一覧して」と頼むと、エージェントは SOQL を組み立てて次のように起動します。

```
npx -y sfbench -o my-org --query "SELECT Id, Name, Amount FROM Opportunity WHERE IsWon = true" --run
```

sfbench はブラウザでクエリを実行した結果を開き、コマンドはすぐ終了します。
すでに起動している場合は、新しいタブを開きます。

REST API の要求や Apex も、同じように入れた状態で開けます。

```
npx -y sfbench -o my-org --rest /services/data/v62.0/sobjects/Account --method POST --body-file account.json
npx -y sfbench -o my-org --apex-file fix-data.apex
```

### AI で組む機能

設定画面（右上の歯車）で、AI の提供元（Anthropic か OpenAI）、モデル ID、API キーを入れます。
API キーはこの PC の `~/.sfbench/settings.json` に本人だけが読める形で保存し、ブラウザには表示しません。
AI を呼ぶのは「生成」か「AI で直す」を押したときだけで、呼ぶたびに API キーの持ち主に提供元の料金がかかります。

AI に送るのは、オブジェクトと項目の名前、型、ラベル、選択リストの値、画面の内容（エディタのクエリやコード、いまの要求）、直すときのエラー文です。
送るものは入力欄の下の「送る情報」に並び、画面の内容は押して ✓ を外せば送りません。
SOQL の結果は送りません。
REST API のレスポンスと Apex の実行結果は、「この結果を使って AI に頼む」を押したときだけ送ります。

## 仕組み

sfbench は手元で小さな Web サーバー（`http://127.0.0.1:7717`。使用中なら 7736 までの空いているポート）を起動し、ブラウザで画面を開きます。
Salesforce への問い合わせはこのサーバーが行い、アクセストークンは sf CLI から取得します。
トークンがブラウザやほかのサーバーに渡ることはありません。
サーバーは自動では止まりません。止めるときは `npx sfbench stop` を実行します。

設定、最近のクエリ、REST API と Apex の実行履歴は `~/.sfbench/` に保存します。
サーバーのログは `~/.sfbench/server.log` にあります。
ログには、SOQL、要求のボディ、Apex のコード、レコードの値を書きません。

## 開発

```
npm install
npm run dev   # 画面の開発サーバーとローカルサーバーを起動する
```

`http://localhost:5173/launch/dev` を開きます。
コードを保存すると、画面とサーバーにそのまま反映されます。

設計は [docs/design.md](docs/design.md) にあります。

## ライセンス

MIT

画面に取り込んでいるライブラリのライセンスは、設定画面の「ライセンス」から見られます（公開物の `dist/web/licenses.txt`）。
