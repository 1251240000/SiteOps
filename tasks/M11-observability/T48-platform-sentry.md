# T48 — 平台自身错误监控接 Sentry

- **里程碑**：M11
- **优先级**：P1
- **前置依赖**：T01
- **预估工时**：4 h
- **状态**：Todo

## 目标

把 web 与 worker 的未捕获异常推到 Sentry（或兼容协议如 GlitchTip），让运维方在平台自己崩溃时能立即看到 stack，而不是只能依赖日志聚合。

## 范围

**包含**

- 装 `@sentry/nextjs` + `@sentry/node`
- 配置 `apps/web/sentry.{client,server,edge}.config.ts`
- worker 端 `apps/worker/src/sentry.ts` 初始化
- env：`SENTRY_DSN`、`SENTRY_ENVIRONMENT`、`SENTRY_TRACES_SAMPLE_RATE`（默认 0，不采）
- 包装 BullMQ worker 的 `failed` event 上报错误
- 让 `withApi` 的 `handleError` 在 5xx 时 `Sentry.captureException`
- 自动屏蔽敏感字段：与 T46 的脱敏复用 `redactKeys`

**不包含**

- Sentry 自托管部署（提供 dsn 即可）
- Performance / Replay（不开，只用 Error）

## 设计要点

### 初始化

```ts
// apps/web/sentry.server.config.ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
  enabled: !!process.env.SENTRY_DSN,
  beforeSend(event) {
    return redactSentryEvent(event);
  },
});
```

```ts
// apps/worker/src/sentry.ts
export function initSentry() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    /* 同上 */
  });
  process.on('uncaughtException', (err) => Sentry.captureException(err));
  process.on('unhandledRejection', (err) => Sentry.captureException(err));
}
```

### 业务集成

```ts
// with-api.ts handleError
function handleError(err, requestId, log) {
  if (isAppError(err)) { /* 5xx 不算业务错误 */ return jsonError(...); }
  Sentry.captureException(err, { tags: { requestId } });
  log.error(...);
  return jsonError(500, ...);
}
```

```ts
// worker job
worker.on('failed', (job, err) => {
  Sentry.captureException(err, { tags: { queue: job?.queueName, jobId: job?.id } });
});
```

### 数据脱敏

复用 T46 的 redact，beforeSend 中扫描 `request.headers / data` 把 token / password 替换 [REDACTED]。

## 涉及文件

```
apps/web/sentry.client.config.ts                          # 新
apps/web/sentry.server.config.ts                          # 新
apps/web/sentry.edge.config.ts                            # 新
apps/web/next.config.mjs                                   # withSentryConfig 包装
apps/web/lib/with-api.ts                                   # captureException 调用
apps/web/lib/env.ts                                        # +SENTRY_*
apps/worker/src/sentry.ts                                  # 新
apps/worker/src/index.ts                                   # initSentry 调用
apps/worker/src/jobs/*.ts                                  # worker.on('failed') 增加
docs/11-observability.md                                   # 加 Sentry 章节
```

## 验收标准

- [ ] env `SENTRY_DSN=` 未设置时初始化静默不报错
- [ ] env `SENTRY_DSN=...` 设置后人为 throw → 在 Sentry 收到
- [ ] worker 抛 unhandledRejection → Sentry 收到
- [ ] 上报的 event 中 `request.headers.authorization` / `cookie` / body 内 password 字段被脱敏
- [ ] performance 不报（traces sample 默认 0）
- [ ] `pnpm -r typecheck && lint && test` 全绿
