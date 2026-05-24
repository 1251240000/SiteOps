# T45 — Outbound Webhook 通道

- **里程碑**：M10
- **优先级**：P1
- **前置依赖**：T11, T16
- **预估工时**：10 h
- **状态**：Todo

## 目标

为平台关键事件提供 outbound HTTP 推送：客户在 dashboard 配置 URL + secret + 订阅事件，平台事件触发时签名 POST 过去，失败按指数退避重试 24h；保留完整投递记录以便回放。

## 范围

**包含**

- 新表 `outbound_webhooks`：
  ```sql
  CREATE TABLE outbound_webhooks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    url         TEXT NOT NULL,
    secret_hash TEXT NOT NULL,             -- aes-encrypted（解密时签名用）
    events      TEXT[] NOT NULL,           -- ['deployment.failed', 'alert.fired', ...]
    active      BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
- 新表 `outbound_webhook_deliveries`：
  ```sql
  CREATE TABLE outbound_webhook_deliveries (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id     UUID NOT NULL REFERENCES outbound_webhooks(id) ON DELETE CASCADE,
    event_type     TEXT NOT NULL,
    payload        JSONB NOT NULL,
    status         TEXT NOT NULL,           -- 'pending' | 'success' | 'failed'
    attempts       INT NOT NULL DEFAULT 0,
    last_status    INT,                     -- HTTP status code
    last_response  TEXT,                    -- 前 2000 字符
    next_retry_at  TIMESTAMPTZ,
    succeeded_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
- 事件类型列表（shared 常量）：`deployment.success/failed/building`, `alert.fired/resolved`, `ssl.expiring/expired`, `error.spike`, `roi.below_threshold`
- BullMQ 新 queue：`outbound-webhook-dispatch`
- Service：`outboundWebhookService.dispatch(eventType, payload)` —— enqueue + 持久化 deliveries
- 触发点埋入：alert fired、deployment service 创建、SSL scheduler、roi rules
- Dashboard：`/(dashboard)/settings/webhooks/outbound` —— CRUD + 测试发送 + delivery 历史
- HMAC 签名：header `x-siteops-signature: sha256=<hex>`，body = canonical JSON

**不包含**

- 客户端 SDK 验证示例（README 给一段示例代码即可）
- 复杂事件过滤（除 events[] 之外的字段匹配）

## 设计要点

### Dispatch 流程

```ts
// outbound-webhook-service.ts
async function dispatch(deps, eventType: string, payload: object) {
  const hooks = await outboundWebhookRepo.listMatching(deps.db, eventType); // active + events 包含
  for (const hook of hooks) {
    const delivery = await deliveryRepo.create(deps.db, {
      webhookId: hook.id,
      eventType,
      payload,
      status: 'pending',
    });
    await dispatchQueue.add(
      'deliver',
      { deliveryId: delivery.id },
      {
        attempts: 8,
        backoff: { type: 'exponential', delay: 5000 }, // 5s → 10s → ... → 21min
      },
    );
  }
}
```

### Worker 处理

```ts
// apps/worker/src/jobs/outbound-webhook-dispatch.ts
async function processDispatch({ data: { deliveryId } }) {
  const delivery = await deliveryRepo.getById(db, deliveryId);
  if (!delivery || delivery.status === 'success') return;
  const hook = await outboundWebhookRepo.getById(db, delivery.webhookId);
  if (!hook?.active) return;

  const body = JSON.stringify(delivery.payload);
  const secret = decryptSecret(hook.secretHash);
  const signature = `sha256=${hmacSha256(secret, body)}`;
  const res = await fetch(hook.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-siteops-signature': signature,
      'x-siteops-event': delivery.eventType,
      'x-siteops-delivery': delivery.id,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) {
    await deliveryRepo.markSuccess(db, deliveryId, res.status);
  } else {
    await deliveryRepo.markFailed(db, deliveryId, res.status, await res.text());
    throw new Error(`HTTP ${res.status}`); // BullMQ 自动重试
  }
}
```

- 失败重试上限 8 次 ≈ 35 分钟总跨度（指数 5s 起步）
- 全部用尽后 status='failed'，admin 可手动重放

## 涉及文件

```
packages/db/migrations/00XX_outbound_webhooks.sql
packages/db/migrations/00XX+1_outbound_webhook_deliveries.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/outbound-webhooks.ts
packages/db/src/schema/outbound-webhook-deliveries.ts
packages/db/src/schema/index.ts
packages/db/src/repositories/outbound-webhook-repo.ts
packages/db/src/repositories/outbound-webhook-delivery-repo.ts
packages/services/src/webhooks/outbound-webhook-service.ts
packages/services/src/webhooks/index.ts                  # 导出
packages/shared/src/constants/webhook-events.ts           # 事件 enum
packages/shared/src/schemas/outbound-webhooks.ts
# 触发埋点（service 层）
packages/services/src/deployments/deployment-service.ts
packages/services/src/alerts/alert-fire-service.ts
packages/services/src/integrations/ssl-service.ts
packages/services/src/roi/roi-service.ts
# Worker
apps/worker/src/jobs/outbound-webhook-dispatch.ts
apps/worker/src/queues.ts                                  # +outbound-webhook-dispatch
apps/worker/src/index.ts                                   # 注册
# UI / 路由
apps/web/app/api/v1/outbound-webhooks/route.ts
apps/web/app/api/v1/outbound-webhooks/[id]/route.ts
apps/web/app/api/v1/outbound-webhooks/[id]/test/route.ts
apps/web/app/api/v1/outbound-webhooks/[id]/deliveries/route.ts
apps/web/app/api/v1/outbound-webhooks/[id]/deliveries/[deliveryId]/replay/route.ts
apps/web/app/(dashboard)/settings/webhooks/outbound/page.tsx
apps/web/app/(dashboard)/settings/webhooks/outbound/[id]/page.tsx
docs/04-api-spec.md                                       # §4.5 outbound
docs/outbound-webhook-payloads.md                          # 各事件 payload 形态文档
```

## 验收标准

- [ ] 迁移 apply 成功，外键级联生效
- [ ] 单测：dispatch 把事件入队 + 创建 delivery
- [ ] 单测：HMAC 签名格式正确（与 GitHub 同算法）
- [ ] e2e：配置 webhook → 触发 deployment.failed → 用本地 ngrok / mockttp 接收 → 验签通过
- [ ] 投递失败重试 3 次后仍失败 → delivery.status='failed' 且 attempts=8
- [ ] admin replay 失败 delivery 可恢复成功
- [ ] `/(dashboard)/settings/webhooks/outbound/[id]` 显示最近 50 次 delivery
- [ ] `pnpm -r typecheck && lint && test && test:e2e` 全绿
