/**
 * 来店実績同期プラグインの型定義。
 *
 * 外部（予約・POS・来院チェックイン等）から受け取る「来店実績」と、
 * L Harness の友だち metadata に書き込むフィールドをここで固定する。
 * metadata キー `visitCount` は公式プラグイン「条件タグ付け」が読む名前に合わせている。
 */

/** 外部ソースが返す1件。lineUserId は LINE の userId（"U" 始まり）。 */
export interface VisitItem {
  lineUserId: string
  /** 来店回数（0以上の整数）。 */
  visitCount: number
  /** 最終来店日。YYYY-MM-DD または ISO8601。省略可。 */
  lastVisitAt?: string | null
  /** 初回来店日。省略可。 */
  firstVisitAt?: string | null
}

/** 外部ソースのレスポンス。`nextCursor` があれば `?cursor=` を付けて続きを取る。 */
export interface VisitFeed {
  items: VisitItem[]
  nextCursor?: string | null
}

/** 友だち metadata に書き込むフィールド。null は本体側でキー削除になるので使わない。 */
export interface VisitMetadata {
  visitCount: number
  lastVisitAt?: string
  firstVisitAt?: string
  /** このプラグインが最後に書き込んだ時刻（ISO8601）。 */
  visitSyncedAt: string
}

/** 1回の同期の集計。個人情報は含めない（ログ・レスポンスにそのまま出す）。 */
export interface SyncSummary {
  dryRun: boolean
  /** 外部ソースから受け取った件数。 */
  received: number
  /** 形式不正で捨てた件数。 */
  invalid: number
  /** 本体で照合した友だち数。 */
  scanned: number
  /** lineUserId が本体の友だちに一致した件数。 */
  matched: number
  /** 一致しなかった件数（未友だち・ブロック後の削除など）。 */
  unmatched: number
  /** 書き込み内容が現在値と同じで飛ばした件数。 */
  unchanged: number
  /** 書き込んだ件数（dryRun のときは「書き込むはずだった」件数）。 */
  updated: number
  /** 書き込みに失敗した件数。 */
  failed: number
}
