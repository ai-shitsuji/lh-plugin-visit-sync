/**
 * L Harness Plugin: 来院実績同期 (visit-sync)
 *
 * 外部の来院実績（来院チェックイン・予約・POS など）を、本体の友だち metadata
 * `visitCount` / `lastVisitAt` / `firstVisitAt` に同期する独立 Cloudflare Worker。
 * タグ付けはしない。公式プラグイン「条件タグ付け」が `visitCount` を読んでタグを付ける。
 *
 * 動かし方は2通り:
 *   - 定期取得: cron で SOURCE_URL を読む（初期状態では cron 無効）
 *   - プッシュ: 外部から POST /webhook に署名付きで1件〜数件送る（WEBHOOK_SECRET 未設定なら 501）
 */

import { LineHarness } from '@line-harness/sdk'
import { fetchVisitFeed } from './source.js'
import { syncVisits } from './sync.js'
import { verifyWebhook } from './webhook.js'

const PLUGIN_NAME = 'visit-sync'
const PLUGIN_VERSION = '0.1.0'

export interface Env {
  LINE_HARNESS_API_URL: string
  LINE_HARNESS_API_KEY: string
  LINE_ACCOUNT_ID?: string
  SOURCE_URL?: string
  SOURCE_TOKEN?: string
  WEBHOOK_SECRET?: string
  DRY_RUN: string
  MAX_FRIENDS?: string
}

function assertEnv(env: Env): { dryRun: boolean; maxFriends: number } {
  if (!env.LINE_HARNESS_API_KEY) throw new Error('LINE_HARNESS_API_KEY を secret に設定してください。')
  if (env.DRY_RUN !== 'true' && env.DRY_RUN !== 'false') throw new Error('DRY_RUN は true / false を指定してください。')
  let url: URL
  try {
    url = new URL(env.LINE_HARNESS_API_URL)
  } catch {
    throw new Error('LINE_HARNESS_API_URL が URL ではありません。')
  }
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if ((url.protocol !== 'https:' && !isLocal) || url.hostname === 'your-line-harness.example.com') {
    throw new Error('LINE_HARNESS_API_URL に本体の HTTPS API URL を設定してください（localhost は検証用に http 可）。')
  }
  const maxFriends = env.MAX_FRIENDS ? Number(env.MAX_FRIENDS) : 5000
  if (!Number.isInteger(maxFriends) || maxFriends <= 0) throw new Error('MAX_FRIENDS は正の整数を指定してください。')
  return { dryRun: env.DRY_RUN === 'true', maxFriends }
}

function createClient(env: Env): LineHarness {
  return new LineHarness({
    apiUrl: env.LINE_HARNESS_API_URL,
    apiKey: env.LINE_HARNESS_API_KEY,
    lineAccountId: env.LINE_ACCOUNT_ID || undefined,
  })
}

async function runSync(env: Env, rawItems: unknown[], trigger: 'cron' | 'webhook') {
  const { dryRun, maxFriends } = assertEnv(env)
  const client = createClient(env)
  const summary = await syncVisits(client, rawItems, {
    accountId: env.LINE_ACCOUNT_ID || undefined,
    dryRun,
    maxFriends,
  })
  console.log(JSON.stringify({ event: 'visit-sync.completed', trigger, ...summary }))
  if (summary.failed > 0) throw new Error(`書き込みに失敗した件数: ${summary.failed}`)
  return summary
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!env.SOURCE_URL) throw new Error('SOURCE_URL を設定してください（定期取得を使わない場合は cron を空にしてください）。')
    const items = await fetchVisitFeed({ url: env.SOURCE_URL, token: env.SOURCE_TOKEN || undefined })
    await runSync(env, items, 'cron')
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'ok', plugin: PLUGIN_NAME, version: PLUGIN_VERSION })
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      if (!env.WEBHOOK_SECRET) {
        return Response.json({ error: 'Webhook is not configured' }, { status: 501 })
      }
      const rawBody = await request.text()
      const verdict = await verifyWebhook({
        secret: env.WEBHOOK_SECRET,
        timestamp: request.headers.get('x-visit-sync-timestamp'),
        signature: request.headers.get('x-visit-sync-signature'),
        rawBody,
      })
      if (!verdict.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 })

      let body: { items?: unknown }
      try {
        body = JSON.parse(rawBody) as { items?: unknown }
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 })
      }
      if (!Array.isArray(body.items)) return Response.json({ error: 'items must be an array' }, { status: 400 })
      if (body.items.length > 100) return Response.json({ error: 'too many items (max 100)' }, { status: 413 })

      try {
        const summary = await runSync(env, body.items, 'webhook')
        return Response.json({ ok: true, summary })
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : 'sync failed' }, { status: 500 })
      }
    }

    return new Response('Not Found', { status: 404 })
  },
}
