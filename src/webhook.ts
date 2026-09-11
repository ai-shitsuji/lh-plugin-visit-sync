/**
 * 外部ソースからのプッシュ（来院した瞬間に1件送る）用の署名検証。
 *
 * ヘッダ:
 *   x-visit-sync-timestamp: UNIX秒
 *   x-visit-sync-signature: hex( HMAC-SHA256( secret, `${timestamp}.${rawBody}` ) )
 * 5分より古い・未来のタイムスタンプは拒否する（再送攻撃の抑止）。
 */

const TOLERANCE_SECONDS = 300

export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 長さが同じ文字列を定数時間で比較する。 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export interface VerifyInput {
  secret: string
  timestamp: string | null
  signature: string | null
  rawBody: string
  nowSeconds?: number
}

export async function verifyWebhook(input: VerifyInput): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!input.timestamp || !input.signature) return { ok: false, reason: 'missing headers' }
  const ts = Number(input.timestamp)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad timestamp' }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > TOLERANCE_SECONDS) return { ok: false, reason: 'stale timestamp' }
  const expected = await hmacHex(input.secret, `${input.timestamp}.${input.rawBody}`)
  const given = input.signature.replace(/^sha256=/, '').toLowerCase()
  if (!safeEqual(expected, given)) return { ok: false, reason: 'bad signature' }
  return { ok: true }
}
