# sfbench

sfbench は、Salesforce の SOQL、REST API、匿名 Apex を手元のブラウザで実行するツールです。
認証は sf CLI に保存済みのものを使うので、接続アプリケーションの作成や組織の設定は要りません。

**現在開発中で、npm にはまだ公開していません。**

sfbench は [lwc-soql-builder](https://github.com/lwc-soql-builder/lwc-soql-builder) の後継です。
lwc-soql-builder は、Salesforce が OAuth のユーザーエージェントフローを使えなくしたため、ログインできなくなりました。

## 特徴

- クリック操作で SOQL を組み立てる。項目を API 名でもラベルでも探せる
- 親リレーション、子リレーション（サブクエリ）をたどって項目を選ぶ
- 管理パッケージの名前空間を省略して書ける
- 結果を全件 CSV に出力する
- Tooling API でのクエリ
- AI のエージェント（Claude Code など）から、クエリを入れた状態で起動できる

REST API と匿名 Apex の実行、AI に SOQL を組ませる機能は、順に追加する予定です。

## 必要なもの

- Node.js 22.12 以上
- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli)（`sf`）と、使う組織へのログイン

macOS、Linux、Windows で動きます。
組織へのログインは sf CLI で行います。

```
sf org login web -a my-org
```

## 使い方

公開後は次のコマンドで起動します。

```
npx sfbench
```

ブラウザで sfbench が開きます。
組織は、画面右上の組織の切り替えから選びます。
`-o` を付けない場合は、sf CLI の既定の組織（`sf config set target-org <alias>` で設定したもの）で開きます。

### コマンドライン引数

| 引数 | 内容 |
| --- | --- |
| `-o, --target-org <alias>` | 開く組織 |
| `--query "<SOQL>"` | SOQL を入力した状態で開く |
| `--run` | `--query` の SOQL を実行した状態で開く |
| `--json` | 開いた URL などを JSON で出力する |
| `--no-open` | ブラウザを開かず、URL だけを出力する |
| `stop` | 起動中の sfbench を止める |

### AI のエージェントから使う

Claude Code などの AI のエージェントに「sfbench で成約済みの商談を一覧して」と頼むと、エージェントは SOQL を組み立てて次のように起動できます。

```
npx -y sfbench -o my-org --query "SELECT Id, Name, Amount FROM Opportunity WHERE IsWon = true" --run
```

sfbench はブラウザでクエリを実行した結果を開き、コマンドはすぐ終了します。
すでに起動している場合は、新しいタブを開きます。

## 仕組み

sfbench は手元で小さな Web サーバー（`http://127.0.0.1:7717`）を起動し、ブラウザで画面を開きます。
Salesforce への問い合わせはこのサーバーが行い、アクセストークンは sf CLI から取得します。
トークンがブラウザやほかのサーバーに渡ることはありません。
サーバーは自動では止まりません。止めるときは `npx sfbench stop` を実行します。

設定と最近のクエリは `~/.sfbench/` に保存します。
サーバーのログは `~/.sfbench/server.log` にあります。

## 開発

```
npm install
npm run dev:server   # ローカルサーバー
npm run dev:web      # 画面の開発サーバー
```

設計は [docs/design.md](docs/design.md) にあります。

## ライセンス

MIT
