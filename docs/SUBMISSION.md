# 掲載申請の下書き（plugin-submission.yml の各欄にそのまま貼る）

> 公開Issueになるので、APIキー・顧客データは絶対に書かない。

## プラグイン名・バージョン

来店実績同期 (visit-sync) 0.1.0

## 解決する課題・できること

治療院・サロン・店舗が持っている「来店実績」（来店チェックイン、予約システム、POS）を、L Harness の友だち metadata `visitCount` / `lastVisitAt` / `firstVisitAt` に同期する独立 Cloudflare Worker です。

公式プラグイン「条件タグ付け」は `visitCount` を読んでタグを付けますが、その値を誰が入れるかは「事前に本体APIなどから登録」となっていました。このプラグインはその入れる側です。外部側は lineUserId と来店回数・日付だけを返すJSONを用意すれば、あとは公式プラグインとシナリオ配信につながります。

- 定期取得（cron で外部の JSON を読む）と、来店した瞬間のプッシュ（署名付き webhook）の2経路
- `DRY_RUN`（既定 true）で件数を確認してから書き込み
- 差分があるときだけ書き込む冪等な動作。再実行しても同じ結果
- タグの付与・削除、メッセージ送信はしない（本体の公式機能に委ねる）

## ソースコードURL・ライセンス

（GitHub リポジトリの URL を入れる）
ライセンス: MIT

## 導入・停止手順のURL

（README.md の URL を入れる）

## 動作確認した本体・SDK・実行環境のバージョン

- L Harness 本体 0.24.1（艦隊3環境を 2026-09-11 に更新して確認）
- `@line-harness/sdk` 0.24.0（`pnpm plugin:create` の生成どおり固定）
- Node.js 22 / wrangler 3 / Cloudflare Workers
- 実行したテスト: `npm test`（純粋関数と署名検証の単体テスト6本）、ローカルE2E（偽の本体・外部ソースに対し pull/push を DRY_RUN あり・なしで実行）、本番相当の本体（検証用インスタンス・0.24.1）に対する DRY_RUN → 実書き込み → 同値での再実行が unchanged になること → null でのキー削除による復元
- 既知の制限: 友だちの照合は一覧の全走査（本体の検索が表示名のみのため）。`MAX_FRIENDS`（既定 5000）超で書き込み前に停止。管理画面のUIは持たない

## 使用するAPI・データ・外部送信先

- 使用API: `GET /api/friends`（一覧・ページング）、`PUT /api/friends/:id/metadata`（差分があるときだけ）
- 必要なキー: 本体の API キー（Worker secret `LINE_HARNESS_API_KEY`）。外部ソースの Bearer（任意 `SOURCE_TOKEN`）。プッシュ用の HMAC 秘密（任意 `WEBHOOK_SECRET`）
- 読む情報: 友だちの `id` / `lineUserId` / `metadata` / `lineAccountId`。外部からは lineUserId と来店回数・日付のみ
- 書く情報: metadata の `visitCount` / `lastVisitAt` / `firstVisitAt` / `visitSyncedAt` のみ
- 外部送信先: 外部ソースへの取得リクエスト（認証ヘッダのみ）。それ以外に送信しない。ログは件数だけで個人情報を出さない
- 通知の重複防止: 通知は送らない。プッシュは timestamp+HMAC で再送・改ざんを拒否、同一 lineUserId は後勝ち
- 停止後に残るデータ: 書き込み済みの metadata は残る（本体側で編集・削除可能）。プラグイン自身は状態を持たない

## 作者名・サポート窓口URL

株式会社ひまわり（加藤貴之）／（サポート窓口 URL または GitHub Issues の URL）

---

## 併記する小さな提案（別Issueでも可）

`GET /api/friends` に `lineUserId` の完全一致フィルタ（例 `?lineUserId=U...`）があると、外部連携プラグインは一覧の全走査をせずに済みます。現状の `search` は表示名のみなので、来院チェックインのように「LINEのuserIdだけを持っている」外部システムは全件を舐めるしかありません。
