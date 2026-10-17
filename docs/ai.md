# sfbench AI で組む機能の技術設計

区切り3（AI で組む機能）の設計を書く。
決まっている方針は [design.md](design.md) の「AI で組む機能」に、画面の仕様は [screens.md](screens.md) の「AI の入力欄」「AI の提案カード」「設定」にあり、この文書はそれらをどう実装するかを決める。

## 範囲

区切り3で作るのは、SOQL を AI に組ませる機能である。

- 要望の文から SOQL を組む（Generate）
- 実行エラーになった SOQL を直す（Fix with AI）
- 提案カード（差分、説明、Discard、Replace、Replace & Run）
- 設定画面の AI の欄と、接続の確認（Test connection）
- 最近のクエリに、AI に頼んだ文を残す

REST API のリクエストと匿名 Apex を組ませる機能は、それぞれの画面と一緒に区切り4と5で作る。
この文書の仕組み（設定、提供元ごとの呼び出し、出力の形の検査、提案カード）は、そのときもそのまま使う。

## 設定

### 保存する形

`~/.sfbench/settings.json` の `ai` に保存する。

```json
{
  "ai": {
    "provider": "anthropic",
    "model": "<モデル ID>",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "<キー>"
  }
}
```

- **provider**：`off`、`anthropic`、`openai` のどれかである。`openai` は OpenAI 互換の Chat Completions API を指す。
- **ai がないとき**：未設定である。画面は AI の入力欄の位置に設定への案内を出す。
- **provider が off のとき**：利用者が Off を選んだ。画面は AI に関する表示をすべて隠す。
- **model**：モデル ID である。sfbench には埋め込まず、利用者が入れる。
- **baseUrl**：`openai` のときだけ使う。`/chat/completions` の手前までを入れる（例: `https://api.openai.com/v1`、`http://localhost:11434/v1`）。
- **apiKey**：手元で動かすモデルなどで不要なときは、ないままでよい。

`settings.json` は、作るときと書き換えるときにファイルの権限を 0600 にする（Windows では何もしない）。
API キーが入るので、同じマシンのほかの利用者に読ませないためである。

### API

`GET /api/settings` は、`ai` から `apiKey` を除き、代わりに `hasApiKey`（真偽値）を返す。

`PUT /api/settings` の `ai` は次のように扱う（design.md の決定どおり）。

- `apiKey` を省けば、保存済みのキーを残す。`apiKey: null` で消す。
- `provider` か `baseUrl` が保存済みのものと変わったら、`apiKey` を省いていても保存済みのキーを消す。キーが、利用者の意図しない宛先に送られないようにするためである。
- `provider` が `anthropic` か `openai` なのに `model` が空なら 400 を返す。`openai` で `baseUrl` が `http://` か `https://` で始まらなければ 400 を返す。

## サーバー

### ファイルの分け方

```
src/server/ai/
  anthropic.ts        Anthropic Messages API の呼び出し
  openaiCompatible.ts OpenAI 互換の Chat Completions API の呼び出し
  tasks.ts            タスクごとの指示文、出力の形（JSON Schema）、受け取った出力の検査
  generate.ts         設定を読み、提供元を選んで呼び、出力を検査して返す
```

提供元ごとの呼び出しは1ファイルにまとめる（design.md「原則の例外」）。
API の仕様が変わって壊れても、直す場所がそのファイルに限られるようにするためである。

### 提供元ごとの呼び出し

どちらも Node の `fetch` で呼ぶ。
起動オプションの `--use-env-proxy` で、環境変数のプロキシを通る。

**Anthropic**

- `POST https://api.anthropic.com/v1/messages` に、`x-api-key`、`anthropic-version: 2023-06-01`、`content-type: application/json` を付ける。
- 出力の形は `output_config.format`（`{"type": "json_schema", "schema": ...}`）で縛る。JSON は `content` の `text` に入って返る。
- ツールの呼び出しを強制する方法（`tool_choice`）は使わない。新しいモデルでは 400 になるからである。
- `stop_reason` が `refusal` か `max_tokens` のときは、出力が形に合わないことがあるので、そのまま検査に回して失敗として扱う。
- エラーの応答は `{"type": "error", "error": {"type", "message"}}` の形で、`error.message` を画面に出す。

**OpenAI 互換**

- `POST <baseUrl>/chat/completions` に、キーがあれば `Authorization: Bearer <キー>` を付ける。
- 出力の形は `response_format`（`{"type": "json_schema", "json_schema": {"name", "schema", "strict": true}}`）で縛る。
- 対応しない実装や、縛りを無視する実装がある（Ollama は `strict` を無視する。Gemini と LM Studio は文書に書かれていない）。そのため、縛りが効いた前提にせず、受け取った出力は必ず sfbench の側で検査する。
- OpenRouter は、エラーを 200 の応答の本文に入れて返すことがある。状態コードだけでなく、本文に `error` があるかも見る。
- エラーの文は、`error.message`、`[0].error.message`（Gemini で報告がある形）、本文そのものの順に探して画面に出す。
- `message.refusal` があれば、拒否として扱い、その文を出す。

### 出力の形

出力の形は、OpenAI の strict モードの規則に合わせて書く。
この規則で書けば、Anthropic の制限にも収まる。

- いちばん外側はオブジェクトにし、すべてのオブジェクトに `additionalProperties: false` を付ける。
- すべての項目を `required` に入れる。省略できる項目は `["string", "null"]` にする。
- `minLength`、`maximum` などの値の範囲の指定は使わない（Anthropic が 400 を返す）。

受け取った文字列は、`JSON.parse` してから、形を手で検査する（`tasks.ts`）。
縛りが効かない実装で、JSON の前後に文が付いて返る場合に備え、解析に失敗したら最初の `{` から最後の `}` までを取り出してもう一度解析する。
それでも形に合わなければ、「AI の応答が期待した形ではありません」として、受け取った文を詳細に付けて返す。

### タスク

AI に頼む仕事を、タスクとして3つ定める。
指示文（システムプロンプト）は英語で書き、説明の文は要望と同じ言語で書くよう指示する。

| タスク | 渡すもの | 返す形 |
| --- | --- | --- |
| `chooseObjects` | 要望、組織のオブジェクトの一覧（API 名とラベル、クエリできるものだけ） | `{"objects": string[]}`（多くて3つ） |
| `generateSoql` | 要望、オブジェクトの項目（後述）、エディタの内容（ある場合）、Tooling API を使うか | `{"soql": string, "explanation": string}` |
| `fixSoql` | エディタの SOQL、エラー文、オブジェクトの項目 | `{"soql": string, "explanation": string}` |

オブジェクトの項目として渡すのは、項目ごとの API 名、ラベル、型、参照先（`referenceTo`）、リレーション名、選択リストの有効な値（多くて50個）と、オブジェクトの子リレーションの名前と子オブジェクトである。
クエリの結果とレコードは渡さない。

AI に渡す情報は、画面が describe の結果から組み立てて送り、サーバーが指示文と合わせて AI に渡す。
サーバーは、受け取った情報の大きさが 400 KB を超えたら、AI を呼ばずに 413 を返す。
料金が思いがけず膨らまないようにするためである。

### API

| エンドポイント | 内容 |
| --- | --- |
| `POST /api/ai/generate` | `{ "task", "input" }` を受け、検査済みの出力を `{ "output" }` で返す |
| `POST /api/ai/test` | 保存済みの設定で、`generateSoql` を小さな入力で1回呼ぶ。成功すれば、モデル名と所要時間を返す |

接続の確認には、料金のかからない `/models` の一覧ではなく、実際の生成を1回行う。
キーと URL だけでなく、選んだモデルが出力の形の縛りを受け付けるかまで確かめられるからである。
料金は数トークン分かかるので、設定画面にその旨を書く（screens.md）。

エラーは次のコードで返す。

| コード | 状態 | 場面 |
| --- | --- | --- |
| `AI_NOT_CONFIGURED` | 400 | AI が未設定か Off |
| `AI_ERROR` | 502 | AI の API がエラーを返した。`message` に API のエラー文を入れる |
| `AI_BAD_OUTPUT` | 502 | 応答が期待した形でない。`details` に受け取った文を入れる |
| `AI_TIMEOUT` | 504 | 待つ時間を超えた |
| `PAYLOAD_TOO_LARGE` | 413 | 渡す情報が大きすぎる |

AI の応答を待つ時間は300秒にする。
Salesforce の応答を待つ時間（設定、既定120秒）とは分ける。
手元で動かすモデルは、生成に数分かかることがあるからである。
画面の Cancel で要求を切ると、サーバーは AI への要求も中止する（`AbortController`）。

## 画面

### AI の入力欄

エディタの上に置く（screens.md）。

- 1行の入力欄と Generate ボタンを置く。入力欄で Enter を押すと Generate と同じである。日本語入力の変換を確定する Enter では送らない（`isComposing` を見る）。
- 入力欄の下に、AI に送る情報をチップで並べる。チップは × で外せる。
  - **「<オブジェクト> fields」**：左の一覧で開いているオブジェクト（FROM のオブジェクト）
  - **「Editor text」**：エディタが空でないとき
- 右端に、使う AI（提供元とモデル）を出す。
- 組織を選んでいないときは使えない。

### Generate の流れ

1. 「<オブジェクト> fields」のチップがあれば、そのオブジェクトを使う。なければ `chooseObjects` で AI にオブジェクトを選ばせる（進み具合: 「オブジェクトを選んでいます」）。
2. 選んだオブジェクトの describe を取得する（進み具合: 「項目を読み込んでいます」）。describe は区切り2のキャッシュを使う。
3. `generateSoql` を呼ぶ（進み具合: 「SOQL を組んでいます」）。
4. 提案カードを出す。

チップがないときに AI を2回呼ぶのは、組織のオブジェクトすべての項目を渡すと大きすぎるからである。
オブジェクトの一覧（API 名とラベル）だけなら、千数百個でも数十 KB に収まる。
生成の間は、進み具合と Cancel ボタンを出す。

### Fix with AI

実行エラーの表示（結果の位置）に「Fix with AI」ボタンを置く（AI が未設定か Off のときは出さない）。
押すと、エディタの SOQL、エラー文、FROM のオブジェクトの項目を渡して `fixSoql` を呼び、提案カードを出す。
FROM のオブジェクトが組織にない（エラーの原因がそれである）ときは、項目を渡さずに呼ぶ。

### 提案カード

AI の入力欄とエディタの間に出す（screens.md）。

- **差分**：エディタに中身があれば、エディタの内容と提案の差分を出す。語（空白と記号で区切る）の単位で、消えた語を取り消し線と赤、増えた語を緑で示す。差分は最長共通部分列で求める関数を `src/web/ai/diff.ts` に自分で書く（ライブラリは足さない）。エディタが空なら提案だけを出す。
- **説明**：AI の `explanation` を出す。
- **ボタン**：Discard、Replace、Replace & Run を置く。Replace はエディタを提案で置き換える（取り消せる1回の変更として）。Replace & Run は置き換えてすぐ実行する。押すまでエディタは書き換えない。

### 最近のクエリへの記録

Replace か Replace & Run で置き換えたとき、そのときの要望とエディタの内容を覚えておく。
実行したときにエディタの内容が置き換えたときのまま（前後の空白を除いて一致）なら、`POST /query` に要望を `prompt` として付け、サーバーは最近のクエリに一緒に残す。
手で書き換えたあとの実行には付けない。
要望が指すクエリと、実際に実行したクエリがずれないようにするためである。

### 設定画面の AI の欄

screens.md のとおり、Off、Anthropic API、OpenAI 互換 API から選び、モデル、Base URL（OpenAI 互換のみ）、API キーを入れる。

- API キーの欄は、保存済みなら空のまま「保存済み」と表示する。入力すれば置き換え、「キーを消す」で消す。
- 提供元か Base URL を変えると、保存済みのキーが消えることを、欄の下に書く。
- Test connection は、いま入力中の内容ではなく保存済みの設定で試す。入力中の内容で試すには、キーを画面からサーバーへ送り直す必要があり、保存の流れと二重になるからである。押したときに未保存の変更があれば、先に保存するよう案内する。

## テスト

- `anthropic.ts` と `openaiCompatible.ts` は、`fetch` を差し替え、記録した応答（成功、エラー、200 の中のエラー、拒否、形に合わない出力）で確かめる。
- `tasks.ts` の検査は、形に合う出力、合わない出力、前後に文の付いた JSON で確かめる。
- 設定の API は、キーを返さないこと、提供元や Base URL を変えるとキーが消えることを確かめる。
- 画面は API を差し替えて、Generate の流れ（チップあり、なし）、Cancel、提案カードの各ボタン、Fix with AI、最近のクエリへの記録を確かめる。
- 実際の AI の API を呼ぶ確認は手で行う（Anthropic と、手元で動かせるなら Ollama）。

## 進め方

| PR | 内容 |
| --- | --- |
| 3a | 設定（保存、API、設定画面の AI の欄）、提供元ごとの呼び出し、タスク、`/api/ai/generate`、`/api/ai/test` |
| 3b | AI の入力欄、Generate の流れ、提案カード、Fix with AI、最近のクエリへの記録 |
