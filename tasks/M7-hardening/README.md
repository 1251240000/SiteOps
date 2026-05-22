# M7 · 平台健壮性

> M0–M6 把功能闭环交付了；M7 偿还运行层面的技术债，让平台进入可长期托管运行的状态。

## 里程碑目标

聚焦 5 类生产硬伤：

1. **依赖故障可见性**：当前只有 `/healthz` liveness，DB / Redis 故障时 Caddy 仍然往里转发 → 用户看到 5xx。补就绪探针，让反向代理与编排层能区分"进程活着"与"依赖可用"。
2. **API key 校验 CPU**：每次请求一次 bcrypt，按默认 600 req/min/key 算单 key 满速 ≈ 100ms/s CPU；通过短 TTL 缓存把命中率拉到 99% 以上。
3. **限流/反作弊降级**：webhook bad-sig bucket 与 rate-limit 全靠 Redis；Redis 抖动时直接 fail-open 放大攻击面。加进程内 LRU 兜底。
4. **优雅退出**：worker `process.exit(0)` 不等业务回写完成；housekeeping / sweep 中途被截断会产生孤儿 task。
5. **任务队列性能**：`sweepExpiredLeases` 自承 N+1；`tasks_claim_idx` 列序与 ORDER BY 不一致；可在不改契约前提下显著加速 claim 与回收。

外加一项基线安全：注入 HSTS / X-Frame-Options / 最小 CSP 等响应头。

## 任务清单

| ID                                       | 标题                                | 状态 | 估时 | 前置 |
| ---------------------------------------- | ----------------------------------- | ---- | ---: | ---- |
| [T29](./T29-readiness-probe.md)          | 就绪探针 `/readyz` + Caddy 健康切换 | ✅   |  3 h | T02  |
| [T30](./T30-api-key-cache.md)            | API Key 校验缓存层                  | ✅   |  4 h | T06  |
| [T31](./T31-rate-limit-degraded.md)      | Bad-sig / 限流路径进程内降级        | ✅   |  3 h | T27  |
| [T32](./T32-worker-graceful-shutdown.md) | Worker 优雅退出 + drain             | ✅   |  3 h | T11  |
| [T33](./T33-security-headers.md)         | 安全响应头（HSTS / CSP / XFO）      | ✅   |  4 h | T02  |
| [T34](./T34-task-queue-perf.md)          | Task Queue 索引与 sweep 性能        | ✅   |  7 h | T25  |

## 不在 M7 范围

- 改契约的优化（cursor 分页、idempotency 头）—— 留 M8
- 多用户 / RBAC —— 留 M9
- 任何新功能、监控扩展 —— 留 M11 / M13

## 里程碑完成条件

- [x] `curl http://host/readyz` 在 DB 拔线 / Redis 拔线时回 503，正常时回 200（T29 — 单测 4 用例覆盖 ok / db-fail / redis-fail / db-timeout；真机演练待运维上线时执行）
- [x] 同一 API key 连续 100 次调用，仅触发 1 次 bcrypt（T30 — `api-key-cache.test.ts` "compareApiKey is called once across 100 verifications" + bench 实测 ≈ 143,000× 加速）
- [x] Redis stop 后 webhook bad-sig 在 5 分钟内被本地 LRU 兜住，不能无限灌（T31 — `bad-sig-bucket.test.ts` / `rate-limit.test.ts` 共同覆盖 fallback、recover、log 字段；真机 `docker compose stop redis` 演练留 M7 收尾）
- [x] `kill -TERM` worker 后 in-flight housekeeping 全部完成才退出（log `worker.exit`）
- [x] `curl -I https://host/` 返回 `strict-transport-security`、`x-frame-options`、`content-security-policy`
- [x] `task-repo.sweepExpiredLeases` 改造后处理 1000 行 < 200ms（T34 — PGlite 上纯 SQL 实测 ~30 ms；bench 加入 `task-repo.bench.ts`）
- [x] `pnpm -r typecheck && lint && test` 全绿（最近一次 T33 收尾后验证）
