/**
 * 同期本体。外部ソースの来店実績を、本体の友だち metadata に書き込む。
 *
 * - 友だちの照合は `friends.list` を全ページ走査して lineUserId で引く（本体の検索は表示名のみのため）。
 * - 書き込みは差分があるときだけ。dryRun なら読み取りだけで「書くはずだった件数」を返す。
 * - 個人情報（lineUserId・表示名）はログにもレスポンスにも出さない。件数だけ。
 */

import { buildMetadata, dedupeByLineUserId, needsUpdate, normalizeItem } from './plan.js'
import type { SyncSummary, VisitItem } from './types.js'

/** SDK のうち、このプラグインが使う口だけ。テストでは偽物を差し込む。 */
export interface FriendLike {
  id: string
  lineUserId: string
  metadata?: Record<string, unknown>
  lineAccountId?: string | null
}

export interface HarnessLike {
  friends: {
    list(params: { accountId?: string; limit: number; offset: number }): Promise<{
      items: FriendLike[]
      hasNextPage: boolean
    }>
    setMetadata(friendId: string, fields: Record<string, unknown>): Promise<unknown>
  }
}

export interface SyncOptions {
  /** 本体側の LINE アカウントID。複数アカウント環境では必須。 */
  accountId?: string
  dryRun: boolean
  /** 走査する友だちの上限。超えたら書き込み前に停止する。 */
  maxFriends: number
  /** 書き込み時刻（テストで固定するため注入可能）。 */
  now?: () => string
  pageSize?: number
}

export class SyncAbort extends Error {}

/**
 * 友だち一覧を全走査して lineUserId → 友だち の対応表を作る。
 * 指定アカウント以外の友だちが混ざっていたら、書き込み前に止める（公式プラグインと同じ姿勢）。
 */
export async function buildFriendIndex(
  client: HarnessLike,
  options: Pick<SyncOptions, 'accountId' | 'maxFriends' | 'pageSize'>,
): Promise<Map<string, FriendLike>> {
  const pageSize = options.pageSize ?? 100
  const index = new Map<string, FriendLike>()
  let offset = 0
  for (;;) {
    const page = await client.friends.list({ accountId: options.accountId, limit: pageSize, offset })
    for (const f of page.items) {
      if (options.accountId && f.lineAccountId && f.lineAccountId !== options.accountId) {
        throw new SyncAbort('指定した LINE_ACCOUNT_ID 以外の友だちが返されました。設定を確認してください。')
      }
      if (f.lineUserId) index.set(f.lineUserId, f)
    }
    offset += page.items.length
    if (index.size > options.maxFriends) {
      throw new SyncAbort(`友だち数が MAX_FRIENDS (${options.maxFriends}) を超えました。差分同期への拡張が必要です。`)
    }
    if (!page.hasNextPage || page.items.length === 0) break
  }
  return index
}

/** 外部ソースから受け取った生データを同期する。戻り値は件数の集計のみ。 */
export async function syncVisits(
  client: HarnessLike,
  rawItems: unknown[],
  options: SyncOptions,
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    dryRun: options.dryRun,
    received: rawItems.length,
    invalid: 0,
    scanned: 0,
    matched: 0,
    unmatched: 0,
    unchanged: 0,
    updated: 0,
    failed: 0,
  }

  const items: VisitItem[] = []
  for (const raw of rawItems) {
    const item = normalizeItem(raw)
    if (item) items.push(item)
    else summary.invalid += 1
  }
  const deduped = dedupeByLineUserId(items)
  if (deduped.length === 0) return summary

  const index = await buildFriendIndex(client, options)
  summary.scanned = index.size

  const syncedAt = (options.now ?? (() => new Date().toISOString()))()
  for (const item of deduped) {
    const friend = index.get(item.lineUserId)
    if (!friend) {
      summary.unmatched += 1
      continue
    }
    summary.matched += 1
    const next = buildMetadata(item, syncedAt)
    if (!needsUpdate(friend.metadata, next)) {
      summary.unchanged += 1
      continue
    }
    if (options.dryRun) {
      summary.updated += 1
      continue
    }
    try {
      await client.friends.setMetadata(friend.id, { ...next })
      summary.updated += 1
    } catch (error) {
      summary.failed += 1
      // 個人を特定できる情報は出さない。友だちの内部IDも出さない。
      console.error('[visit-sync] setMetadata failed:', error instanceof Error ? error.message : String(error))
    }
  }
  return summary
}
