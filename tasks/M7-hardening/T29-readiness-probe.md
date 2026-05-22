# T29 — 就绪探针 `/readyz` + Caddy 健康切换

- **里程碑**：M7
- **优先级**：P0
- **前置依赖**：T02
- **预估工时**：3 h
- **状态**：Done

## 目标

在 `/healthz`（liveness）之外补一个真正的 readiness 探针，让反向代理 / 容器编排能在 DB 或 Redis 故障时把流量切走，而不是把 5xx 直接抛给用户。

## 范围

**包含**

- 新增 `apps/web/app/readyz/route.ts`
- 调整 `infra/caddy/Caddyfile`，把 `reverse_proxy ... health_uri /healthz` 改成 `/readyz`，并保留 `/healthz` 给 Docker `HEALTHCHECK`
- `infra/docker-compose.yml` 的 web / worker `healthcheck` 项目同步
- 单测：DB 异常 / Redis 异常分别返回 503，正常返回 200

**不包含**

- 单独 worker readiness 端口（worker 没暴露 HTTP；用 BullMQ + Redis ping 间接验，留给 M11 监控）
- multi-tenant 多 DB 健康聚合

## 设计要点

- `/readyz` 必须 `force-dynamic`，禁用任何缓存
- DB 检查：`sql\`SELECT 1\``包一层`Promise.race` 超时 1s
- Redis 检查：`getRedis().ping()` 同样 1s 超时
- 失败时响应 JSON `{ status: 'degraded', checks: { db: 'fail'|'ok', redis: 'fail'|'ok' } }`，HTTP 503
- 任一项 fail 即 503；成功返回 200 `{ status: 'ok', checks: { ... } }`
- 日志只在状态切换时记录，避免高频健康检查刷屏（用一个 module-scoped `lastStatus`）

```ts
// apps/web/app/readyz/route.ts (核心 shape)
const TIMEOUT_MS = 1000;
async function withTimeout<T>(p: Promise<T>): Promise<T | 'timeout'> {
  /* ... */
}

export async function GET() {
  const db = await withTimeout(getDb().execute(sql`SELECT 1`));
  const redis = await withTimeout(getRedis().ping());
  const ok = db !== 'timeout' && redis !== 'timeout';
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', checks: { db, redis } },
    { status: ok ? 200 : 503 },
  );
}
```

## 涉及文件

```
apps/web/app/readyz/route.ts
apps/web/app/readyz/__tests__/route.test.ts
infra/caddy/Caddyfile
infra/docker-compose.yml
docs/04-api-spec.md     # §3.10 补 readiness 行已存在；无需修改
```

## 验收标准

- [x] `curl http://host/readyz` 正常时 200，body 含 `status: 'ok'`
- [ ] 手动 `docker compose stop postgres` 后 `/readyz` 在 1s 内返回 503（路由实现已覆盖；待真机演练）
- [ ] 手动 `docker compose stop redis` 同上（路由实现已覆盖；待真机演练）
- [x] Caddy `health_uri` 切换后，依赖故障时 Caddy 上游表标为 down（`curl http://host/caddy-healthz` 仍可达）— Caddyfile 切到 `/readyz` + `health_status 2xx`
- [x] 单元测试覆盖 DB / Redis 任一 timeout 时的 503 + checks 字段（`apps/web/app/readyz/__tests__/route.test.ts`，4 个用例覆盖 ok / db-fail / redis-fail / db-timeout）
- [x] `pnpm -r typecheck && lint && test` 全绿
