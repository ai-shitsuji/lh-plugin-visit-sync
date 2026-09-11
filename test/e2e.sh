#!/usr/bin/env bash
# ローカルE2E: 偽の本体/外部ソースに対して cron(pull) と webhook(push) を DRY_RUN=true/false で通す
set -u
cd "$(dirname "$0")/.."
python test/mock-servers.py > test/mock.log 2>&1 & MOCK=$!
run_case() { # $1=DRY_RUN $2=label
  npx wrangler dev -c test/wrangler.local.toml --port 8787 --test-scheduled --var DRY_RUN:"$1" > "test/wrangler-$2.log" 2>&1 & WR=$!
  for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8787/health && break; sleep 1; done
  echo "== [$2] health: $(curl -s http://127.0.0.1:8787/health)"
  echo "== [$2] cron(pull):"; curl -s 'http://127.0.0.1:8787/__scheduled?cron=0+*+*+*+*'; echo
  BODY='{"items":[{"lineUserId":"Ucccccccccccccccccccccccccccccccc","visitCount":1,"lastVisitAt":"2026-09-11"}]}'
  TS=$(date +%s); SIG=$(python -c "import hmac,hashlib,sys;print(hmac.new(b'hook-secret', f'{sys.argv[1]}.{sys.argv[2]}'.encode(), hashlib.sha256).hexdigest())" "$TS" "$BODY")
  echo "== [$2] webhook(push) ok-sig: $(curl -s -X POST http://127.0.0.1:8787/webhook -H "content-type: application/json" -H "x-visit-sync-timestamp: $TS" -H "x-visit-sync-signature: $SIG" --data "$BODY")"
  echo "== [$2] webhook bad-sig: $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8787/webhook -H "x-visit-sync-timestamp: $TS" -H "x-visit-sync-signature: deadbeef" --data "$BODY")"
  echo "== [$2] webhook stale-ts: $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8787/webhook -H "x-visit-sync-timestamp: 1000" -H "x-visit-sync-signature: $SIG" --data "$BODY")"
  sleep 1
  echo "== [$2] worker log summary lines:"; grep -o '{"event":"visit-sync.completed[^}]*}' "test/wrangler-$2.log"
  echo "== [$2] writes recorded by mock LH: $(curl -s -H 'Authorization: Bearer test-key' http://127.0.0.1:8790/__writes)"
  kill $WR 2>/dev/null; wait $WR 2>/dev/null
  # wrangler が子プロセス(workerd)を残す場合に備えてポートを空ける
  for p in $(netstat -ano 2>/dev/null | grep ':8787 ' | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //PID $p //F >/dev/null 2>&1; done
  sleep 1
}
run_case true dry
run_case false wet
kill $MOCK 2>/dev/null
echo "E2E DONE"
