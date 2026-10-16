# sfbench 開発ガイド

sfbench は、sf CLI の認証を借りて Salesforce の SOQL、REST API、匿名 Apex を手元のブラウザで実行するツールである。
設計の決定事項は [docs/design.md](docs/design.md)、画面の仕様は [docs/screens.md](docs/screens.md) にあり、実装はこれらに従う。
設計を変える場合は、同じ PR で文書も更新する。
lwc-soql-builder から引き継ぐ機能の一覧は [docs/parity.md](docs/parity.md) にあり、実装したらチェックを付ける。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev:server` | ローカルサーバーを開発用の設定（`--dev`）で起動する。ポートは 7717 |
| `npm run dev:web` | 画面の開発サーバーを起動する。`/api` はローカルサーバーへ転送する |
| `npm run typecheck` | 型チェック |
| `npm run lint` | oxlint |
| `npm test` | Vitest |
| `npm run build` | 型チェック、画面のビルド、サーバーのコンパイル。出力は `dist/` |

`dev:server` は Node の型除去機能で TypeScript を直接実行するので、開発には Node 22.18 以上が要る。
状態は `~/.sfbench/` ではなく `.sfbench-dev/`（環境変数 `SFBENCH_HOME` で変えられる）に置き、手元で使っている sfbench と混ざらないようにする。
そのため、サーバーのコードは型注釈を消すだけで動く構文（`erasableSyntaxOnly`）で書く。
`enum` や `namespace`、コンストラクタ引数のプロパティ宣言は使えない。

## ディレクトリ

```
src/
  server/   ローカルサーバーと CLI の入口（cli.ts）
  web/      画面（Vite のルート）
  shared/   サーバーと画面で共有する型
docs/       設計文書
```

## 守ること

### 依存

- 利用者の実行時の npm 依存はゼロにする。`dependencies` にパッケージを足さない。画面のライブラリは `devDependencies` に入れ、ビルド時に取り込む。サーバーは Node 標準の API だけで書く。
- sf CLI とは出力だけでつながる。`@salesforce/core` や sf CLI のプラグイン機構には依存しない。
- 対象の OS は macOS、Linux、Windows で、動作環境は Node 22.12 以上である。パスの組み立てには `node:path` を使い、区切り文字を決め打ちしない。

### 安全

- アクセストークンを画面に渡さない。`sf org list` の出力にもトークンが含まれるので、画面に返すときは必要な項目だけを写す。
- 子プロセスの引数に利用者の入力を載せない。組織は環境変数 `SF_TARGET_ORG` で、REST API のリクエストは `--file` の JSON ファイルで渡す。Windows ではシェルを通して `sf.cmd` を起動するため、引数に記号が混ざるとコマンドとして解釈される。
- `127.0.0.1` だけで待ち受け、`Host` を検証する。画面用の API は、セッショントークン（`X-Sfbench-Session` ヘッダー）と自分のオリジンと一致する `Origin` がない要求を拒否する。例外は、CLI の入口が呼ぶ管理用の API（`health`、`launch`、`shutdown`。管理用トークンが必須で、`Origin` がある要求は拒否する）と、コードを交換する `/api/session` である。
- 子プロセスの作業ディレクトリは `~/.sfbench/tmp/` に固定する。Windows の cmd.exe が、作業ディレクトリにある同名の実行ファイルを先に起動するのを防ぐためである。
- ログにトークン、API キー、`sf org open` の URL、SOQL やリクエストのボディを書かない。
- `server.json` の項目名、`X-Sfbench-Admin` ヘッダー、`/api/health` と `/api/shutdown` の形は、バージョンをまたいで変えない。
- 任意の URL を中継しない。Salesforce へのパスは instanceUrl とオリジンが一致し、`/services/` で始まるものだけを通す。
- `~/.sfbench/` のファイルは権限 600、ディレクトリは 700 で作る。
- AI は API（Anthropic、OpenAI 互換）で呼び、利用者がボタンを押したときだけ呼ぶ。AI にクエリの結果やレコードを渡さない。API キーは画面に返さない。
- データを変更しうる操作（REST API の送信、Apex の実行）は、利用者がボタンを押すまで実行しない。

### そのほか

- 状態は `~/.sfbench/` に保存する。localStorage には、消えても困らない表示の好みだけを置く。
- 色や余白は `src/web/styles/tokens.css` の CSS 変数を使い、コンポーネントに直接書かない。
- sf CLI の出力を解析する処理には、実際の出力を記録したものでテストを書く。

## 動作確認

`sf org auth show-access-token` は、AI のエージェントから実行すると権限設定で止められることがある。
その場合は環境変数 `SFBENCH_TRANSPORT=cli` を付けてサーバーを起動すると、トークンを扱わずに `sf api request rest` で Salesforce を呼ぶ。
遅くなるが、機能の確認はできる。
トークンで直接呼ぶ経路は、人が手元で確かめる。
