/**
 * 外部ソース（来店チェックイン・予約・POS など）から来店実績を取り出す。
 *
 * 契約は1本だけ:
 *   GET {SOURCE_URL}[?cursor=...]   Authorization: Bearer {SOURCE_TOKEN}（任意）
 *   → { "items": [ { "lineUserId": "U...", "visitCount": 12, "lastVisitAt": "2026-09-11", "firstVisitAt": "2024-01-05" } ],
 *       "nextCursor": "..." | null }
 *
 * 外部側が返すのは lineUserId と来店回数・日付だけ。氏名や連絡先は受け取らない。
 */

const MAX_PAGES = 50

export interface SourceOptions {
  url: string
  token?: string
  fetchImpl?: typeof fetch
}

export async function fetchVisitFeed(options: SourceOptions): Promise<unknown[]> {
  const doFetch = options.fetchImpl ?? fetch
  const items: unknown[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(options.url)
    if (cursor) url.searchParams.set('cursor', cursor)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    const res = await doFetch(url.toString(), { headers })
    if (!res.ok) throw new Error(`外部ソースの取得に失敗しました: HTTP ${res.status}`)
    const body = (await res.json()) as { items?: unknown; nextCursor?: unknown }
    if (!body || !Array.isArray(body.items)) throw new Error('外部ソースの応答に items 配列がありません。')
    items.push(...body.items)
    cursor = typeof body.nextCursor === 'string' && body.nextCursor !== '' ? body.nextCursor : null
    if (!cursor) return items
  }
  throw new Error(`外部ソースのページ数が上限 (${MAX_PAGES}) を超えました。`)
}
