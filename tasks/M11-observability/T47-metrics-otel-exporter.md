# T47 — Prometheus + OpenTelemetry 导出器

- **里程碑**：M11
- **优先级**：P1
- **前置依赖**：T11
- **预估工时**：10 h
- **状态**：Todo

## 目标

为 web + worker 引入 Prometheus 指标导出 + OpenTelemetry traces，让运维方能用 Grafana / Tempo / Jaeger 看到 HTTP p95、queue depth、cache 命中率、DB 慢查询等关键信号。

## 范围

**包含**

- `packages/observability/`（新包）：
  - 封装 `prom-client` Registry
  - 封装 `@opentelemetry/sdk-node` SDK
  - 标准指标：
    - `siteops_http_request_duration_seconds`（histogram, labels: method, route, status）
    - `siteops_http_requests_total`（counter）
    - `siteops_bullmq_jobs{queue,state}`（gauge）
    - `siteops_apikey_cache{hit,miss,evict}`（counter）
    - `siteops_bcrypt_duration_seconds`（histogram）
    - `siteops_db_query_duration_seconds`（histogram, label: op）
- Web 集成：
  - `apps/web/instrumentation.ts` 引入 OTel SDK
  - `apps/web/app/metrics/route.ts` 暴露 Prom 格式（只允许 `127.0.0.1` 或同 docker 网络内调用）
  - `withApi` 内 wrap 计时
- Worker 集成：
  - 独立的 HTTP server（`http.createServer`）只服务 `/metrics`，端口由 env `WORKER_METRICS_PORT`（默认 9091）
  - BullMQ Worker 的 `completed/failed` event 写 metric
- DB 集成：Drizzle middleware 计时
- docker-compose 暴露 worker 9091 给同网内

**不包含**

- 自带 Grafana dashboard JSON（提供少量示例查询，dashboard 留运维做）
- Trace 自定义 span 大改造（OTel SDK auto-instrument 已经覆盖 fetch / pg / ioredis / pino）

## 设计要点

### 包结构

```
packages/observability/src/
  index.ts                    # public surface
  registry.ts                 # prom-client 全局 Registry
  metrics/http.ts             # HTTP histograms
  metrics/queue.ts            # BullMQ gauges
  metrics/cache.ts            # API key cache counters
  metrics/db.ts               # DB op histograms
  otel/sdk.ts                 # NodeSDK 初始化
  otel/tracing.ts             # 手动 span helper（少用）
```

### Web 集成

```ts
// apps/web/instrumentation.ts
import { initOtel } from '@siteops/observability';

export async function register() {
  if (process.env.OTEL_ENABLED !== 'false') {
    await initOtel({
      serviceName: 'siteops-web',
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    });
  }
}
```

```ts
// apps/web/app/metrics/route.ts
import { registry } from '@siteops/observability';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // 简易 ACL：只允许 docker 内网 / loopback
  const ip = req.headers.get('x-forwarded-for') ?? '';
  if (!isAllowed(ip)) return new Response('forbidden', { status: 403 });
  return new Response(await registry.metrics(), {
    headers: { 'content-type': registry.contentType },
  });
}
```

### Worker 集成

```ts
// apps/worker/src/metrics-server.ts
import http from 'node:http';
import { registry } from '@siteops/observability';

export function startMetricsServer(port: number) {
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/metrics') {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', registry.contentType);
    res.end(await registry.metrics());
  });
  server.listen(port);
  return server;
}
```

### Drizzle DB 计时

`postgres-js` 配置 `onnotice` / `onparameter` 不够；包一层 query log 用 OTel auto-instrumentation 的 `pg` 替代，或手动 wrap `db.execute`。

## 涉及文件

```
packages/observability/                                      # 新包
packages/observability/package.json
packages/observability/src/index.ts
packages/observability/src/registry.ts
packages/observability/src/metrics/*.ts
packages/observability/src/otel/*.ts
pnpm-workspace.yaml                                          # 加新包
apps/web/instrumentation.ts                                  # 启 OTel
apps/web/app/metrics/route.ts                                # 暴露 prom
apps/web/lib/with-api.ts                                     # HTTP 时长 metric
apps/web/lib/api-key-cache.ts                                # cache metric（T30）
apps/worker/src/metrics-server.ts                            # worker http
apps/worker/src/index.ts                                     # 启 startMetricsServer
apps/worker/src/env.ts                                       # +WORKER_METRICS_PORT
apps/worker/src/jobs/*.ts                                    # job metric on completed/failed
infra/docker-compose.yml                                     # 暴露 worker 9091
docs/11-observability.md                                     # 新文档（quickstart + 推荐查询）
```

## 验收标准

- [ ] `curl http://web:3000/metrics` 返回 Prom 格式，含所有 6 类指标
- [ ] `curl http://worker:9091/metrics` 同上
- [ ] 触发 100 次 HTTP 请求后 `siteops_http_requests_total` 累计正确
- [ ] BullMQ 队列 enqueue 后 `siteops_bullmq_jobs{state="waiting"}` 反映
- [ ] OTel SDK 启用后 trace 推到 `OTEL_EXPORTER_OTLP_ENDPOINT`（用 collector 本地接收验证）
- [ ] env `OTEL_ENABLED=false` 时不影响业务
- [ ] `/metrics` 端点在生产环境只允许内网访问（403 验证）
- [ ] `pnpm -r typecheck && lint && test` 全绿
