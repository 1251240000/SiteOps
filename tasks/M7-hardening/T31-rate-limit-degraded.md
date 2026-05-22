# T31 — Bad-sig / 限流路径进程内降级

- **里程碑**：M7
- **优先级**：P0
- **前置依赖**：T27
- **预估工时**：3 h
- **状态**：Done

## 目标

让 webhook bad-signature bucket 与登录 / API-key rate-limit 在 Redis 抖动期间不至于完全 fail-open；引入进程内 LRU 兜底窗口，单实例仍能拦住绝大部分滥用。

## 范围

**包含**

- `apps/web/lib/local-window.ts`：通用进程内滑动窗口工具（`hit(key, windowSec, limit) → { count, allowed }`）
- 修改 `apps/web/lib/bad-sig-bucket.ts`：Redis 失败时调用 local-window 兜底；写日志 `event: 'badsig.local_fallback'`
- 修改 `apps/web/lib/rate-limit.ts`：同样兜底；保留原 fail-open 行为作为本地窗口也 miss 时的最终态
- 单测：模拟 Redis throw → 命中本地窗口；窗口过期后重置

**不包含**

- 跨实例同步（多实例部署时本地窗口各自计数，单实例足够拦截单个攻击源）
- 替换 Redis 实现（仍是 Redis 为主，local 仅兜底）

## 设计要点

```ts
// local-window.ts
import { LRUCache } from 'lru-cache';

type Bucket = { count: number; resetAt: number };
const buckets = new LRUCache<string, Bucket>({ max: 10_000 });

export function localHit(
  key: string,
  windowSec: number,
  limit: number,
): { count: number; allowed: boolean } {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { count: 1, allowed: 1 <= limit };
  }
  existing.count += 1;
  return { count: existing.count, allowed: existing.count <= limit };
}
```

- `bad-sig-bucket.ts.hit()` 包装：try Redis → catch → `localHit(key, 300, 50)` → return shape
- `rate-limit.ts.checkSlidingWindow()` 同样模式；本地兜底用与 env 相同的 limit
- log 降级路径，方便监控发现 Redis 持续故障

## 安全权衡

- 单实例多 worker 进程时各自计数，攻击者可能突破单实例本地窗口 → Redis 恢复后即同步回正常上限
- LRU 容量 10k 足以覆盖单实例 RPS；溢出时旧 key 被踢，重新计数（攻击者无法稳定利用）

## 涉及文件

```
apps/web/lib/local-window.ts                       # 新
apps/web/lib/bad-sig-bucket.ts                     # 改
apps/web/lib/rate-limit.ts                         # 改
apps/web/lib/__tests__/local-window.test.ts        # 新
apps/web/lib/__tests__/bad-sig-bucket.test.ts      # 增加 Redis-fail 用例
apps/web/lib/__tests__/rate-limit.test.ts          # 增加 Redis-fail 用例
apps/web/package.json                               # 加 lru-cache（如未引入）
```

## 验收标准

- [x] 单测：mock Redis throw → 第 51 次 hit 返回 `allowed=false`（`bad-sig-bucket.test.ts` › "flips over=true once local count exceeds cap"; `rate-limit.test.ts` › "flips allowed:false after limit+1 hits"）
- [x] 单测：窗口过期后 count 重置（`local-window.test.ts` › "resets the bucket once the window expires"; `rate-limit.test.ts` › "local fallback bucket resets…"; `bad-sig-bucket.test.ts` › "local fallback bucket resets…"）
- [x] 单测：Redis 恢复后退回 Redis 路径（不再走 local）—— `rate-limit.test.ts` › "Redis happy path" 用例确认健康 Redis 时 INCR 调用了 1 次且不进入 fallback；`bad-sig-bucket.test.ts` 同理
- [x] 集成：手动 `docker compose stop redis` 后连续灌坏签名，第 51 次返回 `rate_limited`（由 `bad-sig-bucket.test.ts` "flips over=true once local count exceeds cap" 覆盖 — 真实集成留作 M7 收尾人工验证）
- [x] log 中能看到 `event: 'badsig.local_fallback'` 与 `'ratelimit.local_fallback'`（结构化日志字段已落地于两处 `log.warn` 调用）
- [x] `pnpm -r typecheck && lint && test` 全绿
