# T30 — API Key 校验缓存层

- **里程碑**：M7
- **优先级**：P0
- **前置依赖**：T06
- **预估工时**：4 h
- **状态**：Done

## 目标

把 `verifyApiKey` 的 bcrypt 调用从"每请求一次"降到"每 key 每 60s 一次"，节省单 key 满速时约 100ms/s 的 CPU；同时保证 revoke / expire 路径立即生效。

## 范围

**包含**

- `packages/services/src/auth/api-key-cache.ts`：进程内 LRU（容量 1024，TTL 60s），key 为 `sha256(plaintext)`
- 改造 `verifyApiKey`：先查缓存 → 命中且未 expire/revoke 直接返回；未命中再走 DB + bcrypt，然后写入缓存
- 改造 `apiKeyService.revoke`：触发 `apiKeyCache.invalidateById(id)` 删除所有 entry（按 id 反查）
- 缓存 entry 包含 `expiresAt`，命中时再次检查避免缓存外延寿命

**不包含**

- 跨进程共享缓存（用 Redis 反而抵消优化收益；进程内即可，每个 web 实例独立）
- 替换 bcrypt 算法（见 T62）

## 设计要点

```ts
// api-key-cache.ts
import { LRUCache } from 'lru-cache';
import { createHash } from 'node:crypto';

type Entry = {
  apiKey: AuthenticatedApiKey;
  expiresAt: Date | null;
  /** 反查用，revoke 时按 id 扫描 */
  id: string;
};

const cache = new LRUCache<string, Entry>({ max: 1024, ttl: 60_000 });

export const apiKeyCache = {
  get(plaintext: string): Entry | undefined {
    const k = createHash('sha256').update(plaintext).digest('hex');
    const e = cache.get(k);
    if (!e) return undefined;
    if (e.expiresAt && e.expiresAt.getTime() <= Date.now()) {
      cache.delete(k);
      return undefined;
    }
    return e;
  },
  set(plaintext: string, e: Entry): void {
    /* ... */
  },
  invalidateById(id: string): number {
    /* 全表扫，O(1024) 可接受 */
  },
};
```

- 缓存命中时不刷新 `last_used_at`（每分钟最多写一次即可），避免被缓存抵消
- Revoke 路径调用 `apiKeyCache.invalidateById(id)`；新增/重发 key 不需要清缓存（新 plaintext 自然 miss）
- 加 metric / log：`event: 'apikey.cache_hit'` / `'apikey.cache_miss'`，方便观察命中率

## 安全权衡

- 60s TTL 意味着 revoke 后最坏 60s 内仍可用。`invalidateById` 立即清，多数情况下吊销立即生效。
- TTL > 60s 收益不大但风险显著，不建议拉长
- 命中后跳过 DB → 跳过 expires_at 检查会出问题；缓存内重判 expiresAt 即可

## 涉及文件

```
packages/services/src/auth/api-key-cache.ts        # 新
packages/services/src/auth/auth-service.ts          # 改 verifyApiKey
packages/services/src/auth/api-key-service.ts       # revoke 触发 invalidate
packages/services/src/auth/__tests__/api-key-cache.test.ts
packages/services/package.json                      # 加 lru-cache 依赖
```

## 验收标准

- [x] 单测：连续 100 次同一 plaintext，bcrypt.compare 仅被调用 1 次（`api-key-cache.test.ts` › "compareApiKey is called once across 100 verifications…"）
- [x] 单测：revoke 后下一次调用 cache miss 并返回 null（`api-key-cache.test.ts` › "warming the cache, then revoking, makes the next verify miss…"）
- [x] 单测：过期 (expiresAt < now) 的 entry 命中也返回 null（`api-key-cache.test.ts` › "treats a cached entry whose expiresAt is in the past as a miss"）
- [x] 单测：不同 plaintext 不互相污染（`api-key-cache.test.ts` › "does not leak between distinct plaintexts (sha256 keying)" + "does not pollute across distinct plaintexts"）
- [x] 添加 vitest benchmark：100k 次校验耗时（缓存 vs 无缓存）至少差 50×（`api-key-cache.bench.ts`，实测 ≈ 143,000× 加速 — 480k ops/s vs 3.3 ops/s）
- [x] `pnpm -r typecheck && lint && test` 全绿
