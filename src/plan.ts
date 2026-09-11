/**
 * 純粋関数だけを置く。ネットワークも環境変数も触らないのでテストしやすい。
 */

import type { VisitItem, VisitMetadata } from './types.js'

const LINE_USER_ID = /^U[0-9a-f]{32}$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** 外部ソースの1件を検証して正規化する。不正なら null。 */
export function normalizeItem(raw: unknown): VisitItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const lineUserId = typeof r.lineUserId === 'string' ? r.lineUserId.trim() : ''
  if (!LINE_USER_ID.test(lineUserId)) return null
  const visitCount = typeof r.visitCount === 'number' ? r.visitCount : Number(r.visitCount)
  if (!Number.isInteger(visitCount) || visitCount < 0) return null
  const lastVisitAt = normalizeDate(r.lastVisitAt)
  const firstVisitAt = normalizeDate(r.firstVisitAt)
  if (lastVisitAt === false || firstVisitAt === false) return null
  return { lineUserId, visitCount, lastVisitAt, firstVisitAt }
}

/** 日付文字列の検証。未指定は null、不正は false。 */
function normalizeDate(v: unknown): string | null | false {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') return false
  const s = v.trim()
  if (DATE_ONLY.test(s)) return s
  if (!Number.isNaN(Date.parse(s))) return s
  return false
}

/** 書き込むフィールドを組み立てる。undefined のキーは送らない（本体は null をキー削除と解釈する）。 */
export function buildMetadata(item: VisitItem, syncedAt: string): VisitMetadata {
  const m: VisitMetadata = { visitCount: item.visitCount, visitSyncedAt: syncedAt }
  if (item.lastVisitAt) m.lastVisitAt = item.lastVisitAt
  if (item.firstVisitAt) m.firstVisitAt = item.firstVisitAt
  return m
}

/**
 * 現在の metadata と比較して、書き込みが必要かを判定する。
 * `visitSyncedAt` は比較に含めない（毎回変わるので、それだけのために書かない）。
 */
export function needsUpdate(current: Record<string, unknown> | undefined, next: VisitMetadata): boolean {
  const cur = current ?? {}
  if (cur.visitCount !== next.visitCount) return true
  if ((cur.lastVisitAt ?? undefined) !== next.lastVisitAt) return true
  if ((cur.firstVisitAt ?? undefined) !== next.firstVisitAt) return true
  return false
}

/** 同じ lineUserId が複数あれば後勝ちで1件にまとめる。 */
export function dedupeByLineUserId(items: VisitItem[]): VisitItem[] {
  const map = new Map<string, VisitItem>()
  for (const it of items) map.set(it.lineUserId, it)
  return [...map.values()]
}
