import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMetadata, dedupeByLineUserId, needsUpdate, normalizeItem } from './plan.js'
import { SyncAbort, syncVisits, type FriendLike, type HarnessLike } from './sync.js'
import { hmacHex, verifyWebhook } from './webhook.js'

const U1 = 'U' + 'a'.repeat(32)
const U2 = 'U' + 'b'.repeat(32)

test('normalizeItem: 正常系と不正系', () => {
  assert.deepEqual(normalizeItem({ lineUserId: U1, visitCount: 3, lastVisitAt: '2026-09-11' }), {
    lineUserId: U1,
    visitCount: 3,
    lastVisitAt: '2026-09-11',
    firstVisitAt: null,
  })
  assert.equal(normalizeItem({ lineUserId: 'not-a-user', visitCount: 3 }), null)
  assert.equal(normalizeItem({ lineUserId: U1, visitCount: -1 }), null)
  assert.equal(normalizeItem({ lineUserId: U1, visitCount: 1.5 }), null)
  assert.equal(normalizeItem({ lineUserId: U1, visitCount: 3, lastVisitAt: 'yesterday' }), null)
  assert.equal(normalizeItem({ lineUserId: U1, visitCount: '4' })?.visitCount, 4)
})

test('needsUpdate: visitSyncedAt だけの差は書かない', () => {
  const next = buildMetadata({ lineUserId: U1, visitCount: 3, lastVisitAt: '2026-09-11' }, '2026-09-11T00:00:00Z')
  assert.equal(needsUpdate({ visitCount: 3, lastVisitAt: '2026-09-11', visitSyncedAt: 'old' }, next), false)
  assert.equal(needsUpdate({ visitCount: 2, lastVisitAt: '2026-09-11' }, next), true)
  assert.equal(needsUpdate(undefined, next), true)
})

test('dedupeByLineUserId: 後勝ち', () => {
  const out = dedupeByLineUserId([
    { lineUserId: U1, visitCount: 1 },
    { lineUserId: U1, visitCount: 2 },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].visitCount, 2)
})

function fakeClient(friends: FriendLike[], written: Array<{ id: string; fields: Record<string, unknown> }>): HarnessLike {
  return {
    friends: {
      async list({ limit, offset }) {
        const items = friends.slice(offset, offset + limit)
        return { items, hasNextPage: offset + limit < friends.length }
      },
      async setMetadata(id, fields) {
        written.push({ id, fields })
        return {}
      },
    },
  }
}

test('syncVisits: 差分だけ書く・dryRun は書かない・未一致を数える', async () => {
  const friends: FriendLike[] = [
    { id: 'f1', lineUserId: U1, metadata: { visitCount: 2 } },
    { id: 'f2', lineUserId: U2, metadata: { visitCount: 5, lastVisitAt: '2026-09-01' } },
  ]
  const items = [
    { lineUserId: U1, visitCount: 3, lastVisitAt: '2026-09-11' },
    { lineUserId: U2, visitCount: 5, lastVisitAt: '2026-09-01' },
    { lineUserId: 'U' + 'c'.repeat(32), visitCount: 1 },
    { lineUserId: 'broken' },
  ]
  const dry: Array<{ id: string; fields: Record<string, unknown> }> = []
  const s1 = await syncVisits(fakeClient(friends, dry), items, { dryRun: true, maxFriends: 100, now: () => 'T', pageSize: 1 })
  assert.deepEqual(s1, { dryRun: true, received: 4, invalid: 1, scanned: 2, matched: 2, unmatched: 1, unchanged: 1, updated: 1, failed: 0 })
  assert.equal(dry.length, 0)

  const wet: Array<{ id: string; fields: Record<string, unknown> }> = []
  const s2 = await syncVisits(fakeClient(friends, wet), items, { dryRun: false, maxFriends: 100, now: () => 'T', pageSize: 1 })
  assert.equal(s2.updated, 1)
  assert.deepEqual(wet, [{ id: 'f1', fields: { visitCount: 3, lastVisitAt: '2026-09-11', visitSyncedAt: 'T' } }])
})

test('syncVisits: 別アカウントの友だちが混ざったら書き込み前に止まる', async () => {
  const friends: FriendLike[] = [{ id: 'f1', lineUserId: U1, metadata: {}, lineAccountId: 'other' }]
  const written: Array<{ id: string; fields: Record<string, unknown> }> = []
  await assert.rejects(
    syncVisits(fakeClient(friends, written), [{ lineUserId: U1, visitCount: 1 }], { accountId: 'mine', dryRun: false, maxFriends: 100 }),
    SyncAbort,
  )
  assert.equal(written.length, 0)
})

test('verifyWebhook: 正しい署名は通り、古いタイムスタンプと改ざんは落ちる', async () => {
  const secret = 's3cret'
  const body = '{"items":[]}'
  const ts = '1000000'
  const sig = await hmacHex(secret, `${ts}.${body}`)
  assert.deepEqual(await verifyWebhook({ secret, timestamp: ts, signature: sig, rawBody: body, nowSeconds: 1000010 }), { ok: true })
  assert.equal((await verifyWebhook({ secret, timestamp: ts, signature: sig, rawBody: body, nowSeconds: 1000900 })).ok, false)
  assert.equal((await verifyWebhook({ secret, timestamp: ts, signature: sig, rawBody: body + ' ', nowSeconds: 1000010 })).ok, false)
  assert.equal((await verifyWebhook({ secret, timestamp: ts, signature: null, rawBody: body, nowSeconds: 1000010 })).ok, false)
})
