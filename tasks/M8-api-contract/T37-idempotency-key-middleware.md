# T37 — Idempotency-Key HTTP 中间件

- **里程碑**：M8
- **优先级**：P1
- **前置依赖**：T06
- **预估工时**：5 h
- **状态**：Done

## 目标

实现 spec §1 §9 约定的 `Idempotency-Key` 头：客户端 POST/PUT/PATCH 重试时回放首次响应，避免重复创建。覆盖所有非幂等写入端点（sites / deployments / alert-rules / api-keys / 等）。

## 范围

**包含**

- `apps/web/lib/idempotency.ts`：基于 Redis 的请求/响应缓存
- 改造 `withApi` / `withAuth` / `withApiKey`：感知 `Idempotency-Key` 头，POST/PUT/PATCH 时启用
- 单测覆盖：相同 key 重复请求只执行 handler 一次；不同 key 各自执行
- 文档：spec §1 标注实现已完成、可选用法

**不包含**

- 客户端自动重试（由调用方决定）
- 跨 method 复用 key（key 同时绑定 method+path，避免 POST 与 PATCH 用同 key 误命中）
- 业务级幂等（task dedupe_key 等保留）

## 设计要点

```ts
// idempotency.ts
const PREFIX = 'idem:';
const TTL_SEC = 24 * 60 * 60;

type Stored = {
  status: number;
  body: string;
  headers: Record<string, string>;
  bodyHash: string; // sha256(request body) — 防同 key 用不同 body
  createdAt: number;
};

export async function checkIdempotency(ctx: {
  idempotencyKey: string;
  method: string;
  path: string;
  requestBody: string;
  principalId: string;
}): Promise<{ replay: Stored } | { proceed: true; save: (res: Response) => Promise<void> }> {
  const k = `${PREFIX}${ctx.principalId}:${ctx.method}:${ctx.path}:${ctx.idempotencyKey}`;
  const cached = await redis.get(k);
  if (cached) {
    const stored: Stored = JSON.parse(cached);
    const reqHash = sha256(ctx.requestBody);
    if (stored.bodyHash !== reqHash) {
      throw new AppError('Idempotency-Key reused with different body', {
        code: 'idempotency_conflict',
        status: 422,
      });
    }
    return { replay: stored };
  }
  return {
    proceed: true,
    save: async (res) => {
      const body = await res.clone().text();
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      const stored: Stored = {
        status: res.status,
        body,
        headers,
        bodyHash: sha256(ctx.requestBody),
        createdAt: Date.now(),
      };
      await redis.setex(k, TTL_SEC, JSON.stringify(stored));
    },
  };
}
```

### Wrapper 集成

```ts
// with-api.ts (简化伪码)
export function withApi(handler) {
  return async (req) => {
    const idem = req.headers.get('idempotency-key');
    if (idem && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const out = await checkIdempotency({ idempotencyKey: idem /* ... */ });
      if ('replay' in out) {
        return new NextResponse(out.replay.body, {
          status: out.replay.status,
          headers: { ...out.replay.headers, 'idempotent-replay': 'true' },
        });
      }
      const res = await handler(req, ctx);
      if (res.status < 500) await out.save(res); // 5xx 不缓存，重试还能再试
      return res;
    }
    return handler(req, ctx);
  };
}
```

- key TTL = 24h（spec 标准）
- 校验 key 长度 ≤ 256 字符 + `^[A-Za-z0-9._-]+$`
- 5xx 响应不缓存，让客户端重试还能命中下一个尝试

## 涉及文件

```
apps/web/lib/idempotency.ts                            # 新
apps/web/lib/with-api.ts                                # 改 withApi / withAuth / withApiKey
apps/web/lib/__tests__/idempotency.test.ts             # 新
packages/shared/src/utils/sha256.ts                    # 如尚无，新增简单 helper
docs/04-api-spec.md                                    # §1 状态更新
```

## 验收标准

- [x] 单测：相同 `Idempotency-Key` + 相同 body → handler 仅执行 1 次
- [x] 单测：相同 key + 不同 body → 返回 422 `idempotency_conflict`
- [x] 单测：5xx 响应不缓存，下一次相同 key 仍触发 handler
- [x] 集成测：`POST /sites` 重复同 key 5 次，DB 中只有 1 行 site
- [x] 单测：key 格式非法 → 400 validation_failed
- [x] `pnpm -r typecheck && lint && test` 全绿

## 实现笔记

- 主模块：`apps/web/lib/idempotency.ts`；`checkIdempotency()` 返回 `{ replay }` 或 `{ proceed, save }` 二选一，wrapper 据此决定回放或新跑 handler。
- Wrapper 集成点：`apps/web/lib/with-api.ts#resolveIdempotency`，三个 wrapper（`withApi` / `withApiKey` / `withAuth`）共用。`withApiKeyAudited` 通过堆叠在 `withApiKey` 之上自动继承，无需单独改动；replay 命中时内层 handler 不再执行，因此 `agent_runs` 不会被重复写入。
- Per-request 头剥离：缓存时丢弃 `x-request-id` / `x-ratelimit-*` / `retry-after` / `date`；回放后 wrapper 重新写入当前请求的值。
- Redis 故障降级：读 / 写失败时 `checkIdempotency` 返回 `{ proceed, save: noop }`——handler 照常执行，不阻断主写入路径。
- 共享 sha256 helper：`packages/shared/src/utils/sha256.ts`（导出 `sha256Hex(text)`），方便其它需要 stable content digest 的地方复用。
- 文档：`docs/04-api-spec.md` §1 已指向 §9，§2 错误码表新增 `idempotency_conflict (422)`，§9 完整描述了 key 格式 / 作用域 / TTL / 验证 curl。
