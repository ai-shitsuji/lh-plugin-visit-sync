# 来店実績同期プラグイン (visit-sync)

外部の来店実績（来院・来店・利用の記録。来店チェックイン、予約システム、POS など）を、L Harness の友だち metadata に同期する独立した Cloudflare Worker です。治療院・サロン・店舗など、業種は問いません。本体のコードもD1スキーマも触りません。

書き込むのは次の3つだけです。

| metadata キー | 内容 |
| --- | --- |
| `visitCount` | 来店回数（整数）。公式プラグイン「[条件タグ付け](https://github.com/Shudesu/line-harness-oss/tree/main/examples/plugins/tag-rules)」がそのまま読む名前です |
| `lastVisitAt` | 最終来店日（`YYYY-MM-DD` または ISO8601） |
| `firstVisitAt` | 初回来店日（任意） |

加えて `visitSyncedAt`（最後に書き込んだ時刻）を残します。**タグ付けはしません。** 「来店3回以上にタグを付けてシナリオを流す」は、このプラグインで `visitCount` を入れたうえで、公式「条件タグ付け」を組み合わせてください。

## 構成

```text
来店チェックイン / 予約 / POS（あなたのシステム）
    ↓ JSON（lineUserId・来店回数・日付だけ）
visit-sync Worker（このプラグイン・自分のCloudflare）
    ↓ SDK（friends.list / friends.setMetadata）
L Harness 本体（公式アップデートの対象・触らない）
    ↓ metadata.visitCount
公式「条件タグ付け」 → タグ → シナリオ配信
```

動かし方は2通りあります。どちらか一方でも、両方でも使えます。

- **定期取得（pull）**: cron で `SOURCE_URL` を読みに行く。1時間に1回など
- **プッシュ（webhook）**: 来店した瞬間に、外部側から `POST /webhook` へ署名付きで送る

## 外部ソースの契約

外部側は次の形の JSON を返す（または送る）だけです。氏名・電話番号などは含めません。

```json
{
  "items": [
    { "lineUserId": "Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "visitCount": 12, "lastVisitAt": "2026-09-11", "firstVisitAt": "2024-01-05" }
  ],
  "nextCursor": null
}
```

- `lineUserId`: LINE の userId（`U` + 32桁の16進）。本体の友だちと照合するキー
- `visitCount`: 0以上の整数。文字列の `"3"` も受け付けます
- `lastVisitAt` / `firstVisitAt`: 省略可。不正な日付の行は捨てられ、`invalid` に数えられます
- `nextCursor`: 続きがあれば文字列。プラグインは `?cursor=` を付けて最大50ページまで追います

定期取得のときは `GET {SOURCE_URL}` に、`SOURCE_TOKEN` があれば `Authorization: Bearer` を付けて取りに行きます。

## セットアップ

Node.js 22 以上。

```bash
npm install
npm run typecheck
npm test
```

1. 本体側の LINE アカウントIDを確認します。これは友だち追加リンクの `account=` の数字ではなく、`GET /api/friends` が返す `lineAccountId`（UUID 形式）です。`curl -H 'Authorization: Bearer <APIキー>' https://<本体>/api/friends?limit=1` で確認できます。
2. `wrangler.toml` の `LINE_HARNESS_API_URL`（本体APIのオリジン。管理画面の `/console` は付けない）、`LINE_ACCOUNT_ID`、定期取得を使うなら `SOURCE_URL` を設定します。
3. ローカルだけの `.dev.vars` を作り（`dev.vars.example` を参照）、`LINE_HARNESS_API_KEY` を入れます。Git には含めません。
4. `DRY_RUN` は `"true"` のまま、ローカルで定期処理を呼んで件数を確認します。

```bash
npm run dev
# 別のターミナルで（本体ではなく、起動したプラグインのローカルURL）
curl 'http://localhost:8787/__scheduled?cron=0+*+*+*+*'
```

ログに次の集計が出ます。

```json
{"event":"visit-sync.completed","trigger":"cron","dryRun":true,"received":120,"invalid":0,"scanned":480,"matched":97,"unmatched":23,"unchanged":90,"updated":7,"failed":0}
```

| 項目 | 意味 |
| --- | --- |
| `received` / `invalid` | 外部から受け取った件数 / 形式不正で捨てた件数 |
| `scanned` | 本体で走査した友だち数 |
| `matched` / `unmatched` | lineUserId が友だちに一致した / しなかった件数（未友だち・削除済みなど） |
| `unchanged` | 現在値と同じで書かなかった件数 |
| `updated` | 書き込んだ件数。`dryRun` のときは「書くはずだった」件数 |
| `failed` | 書き込みに失敗した件数。1件でもあれば実行は失敗扱い |

## 有効化・停止

`updated` の数に納得したら `DRY_RUN` を `"false"` にし、まずテスト用の本体で実行します。`visitCount` の変化は公式「条件タグ付け」経由でシナリオ配信を開始することがあるので、接続先の配信設定も確認してください。

定期取得を有効にするには `triggers.crons` を `["0 * * * *"]`（毎時）などに変更します。公開先は本体と異なる Worker 名を使います。

```bash
npx wrangler secret put LINE_HARNESS_API_KEY
npx wrangler secret put SOURCE_TOKEN      # 外部ソースに認証がある場合
npm run deploy
```

停止は `triggers.crons` を `[]` にして再デプロイします。停止しても書き込み済みの metadata は残ります。

## プッシュ（POST /webhook）

`WEBHOOK_SECRET` を secret に入れると有効になります（未設定なら 501 を返します）。

```text
POST https://<このWorker>/webhook
x-visit-sync-timestamp: <UNIX秒>
x-visit-sync-signature: <hex( HMAC-SHA256( WEBHOOK_SECRET, "<timestamp>.<本文そのまま>" ) )>
Content-Type: application/json

{"items":[{"lineUserId":"U...","visitCount":4,"lastVisitAt":"2026-09-11"}]}
```

- 5分より古い、または未来のタイムスタンプは拒否します（401）
- 1回あたり100件まで（413）
- 応答は上と同じ集計です。`DRY_RUN` はプッシュにも効きます

## 使用するAPI・権限・外部送信

- 本体API: `GET /api/friends`（一覧・ページング）、`PUT /api/friends/:id/metadata`（差分があるときだけ）
- 本体のAPIキーはプラグイン専用の権限制限を受けません。Worker の secret にだけ保存し、ブラウザや配布物に入れないでください
- 外部へ送る情報: 外部ソースへは認証ヘッダのみ。本体へは `visitCount` / `lastVisitAt` / `firstVisitAt` / `visitSyncedAt` のみ
- ログに出すのは件数だけです。lineUserId・表示名・友だちの内部IDは出しません

## 動作範囲

- 指定アカウントの友だちだけが対象。別アカウントの友だちが返った場合は書き込み前に停止します
- 友だちの照合は一覧の全走査です（本体の検索は表示名のみのため）。`MAX_FRIENDS`（既定 5000）を超えると書き込み前に停止します。それ以上の規模では差分同期への拡張が必要です
- 同じ実行内で同じ lineUserId が複数あれば後勝ちです
- 書き込みは冪等です。同じ値なら書きません。再実行しても同じ結果になります
- タグの付与・削除、メッセージ送信はしません

## 本体アップデート時

独自ソースは本体の外に残ります。API互換性は別に確認が必要です。本体の更新前にテスト用環境で `DRY_RUN="true"` の結果（`scanned` / `matched` が以前と同じ水準か）を確認し、SDKを変えるときは `npm run typecheck` と `npm test` を実施します。本体のD1に独自テーブルは作りません。プラグイン自身の状態も持ちません（毎回、外部ソースと本体から読み直します）。

| 項目 | 動作確認したバージョン |
| --- | --- |
| L Harness 本体 | 0.24.1 |
| `@line-harness/sdk` | 0.24.0 |
| 動作確認日 | 2026-09-14（検証用インスタンスに対し DRY_RUN・実書き込み・冪等再実行・null での復元を確認） |

## 変更履歴

- 0.1.0 (2026-09-11) 初版。定期取得・プッシュ・DRY_RUN・差分書き込み

ライセンス: MIT
