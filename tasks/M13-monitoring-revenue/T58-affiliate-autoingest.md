# T58 — 联盟收入自动抓取

- **里程碑**：M13
- **优先级**：P2
- **前置依赖**：T23
- **预估工时**：5 h
- **状态**：Todo

## 目标

为 affiliate_entries 表增加自动数据源：Amazon Associates + ShareASale 各一个，每天同步前一天数据，免去手动 CRUD。

## 范围

**包含**

- 新表 `affiliate_programs`：
  ```sql
  CREATE TABLE affiliate_programs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    program       TEXT NOT NULL,             -- 'amazon' | 'shareasale' | 'manual'
    credentials   JSONB NOT NULL,            -- 加密的 key/secret/tracking_id
    last_sync_at  TIMESTAMPTZ,
    active        BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
- Integration clients 新增：
  - `packages/integrations/src/amazon-associates/client.ts`
  - `packages/integrations/src/shareasale/client.ts`
- BullMQ queue `affiliate-sync`，scheduler 每天 02:30 入队所有 active programs
- worker job：调对应客户端，把每行数据 upsert 到 `affiliate_entries`（dedupe by (program, site_id, period_start, transaction_id)）
- UI：`/(dashboard)/sites/[id]/revenue` 加 "联盟程序" 子模块 配置入口

**不包含**

- 其他 program（Impact、CJ Affiliate 等）—— 加一个就当新任务
- 实时同步（每日一次足够）
- 自动汇率换算（T63 处理）

## 设计要点

### 加密 credentials

- 复用 T43 的 `WEBHOOK_SECRET_ENC_KEY` 加密思路；env 单独 `AFFILIATE_ENC_KEY`
- DB 存加密 JSON，service 解密后传给 client

### Amazon Associates client

- 用 Product Advertising API 5（PAAPI 5），endpoint 因 marketplace 而异
- 关键参数：AccessKey、SecretKey、PartnerTag、Marketplace
- 调 `GetReport` operation 拉前一日订单（earnings + clicks）

### ShareASale client

- HTTP API + token auth
- 调 `merchantList.json`（先拿合作 merchant）→ `report` endpoint 拉每日数据

### 入库 upsert

```sql
INSERT INTO affiliate_entries (site_id, program, period_start, period_end, transaction_id, clicks, conversions, commission_cents, currency)
VALUES (...)
ON CONFLICT (site_id, program, period_start, transaction_id)
DO UPDATE SET clicks = EXCLUDED.clicks, conversions = EXCLUDED.conversions, commission_cents = EXCLUDED.commission_cents;
```

需要确保 `affiliate_entries` 表有对应唯一索引（T23 已建？检查）。

## 涉及文件

```
packages/db/migrations/00XX_affiliate_programs.sql
packages/db/migrations/00XX+1_affiliate_entries_index.sql     # 若缺
packages/db/migrations/meta/_journal.json
packages/db/src/schema/affiliate-programs.ts
packages/db/src/repositories/affiliate-program-repo.ts
packages/integrations/src/amazon-associates/client.ts
packages/integrations/src/amazon-associates/signer.ts        # AWS Signature v4
packages/integrations/src/amazon-associates/__tests__/client.test.ts
packages/integrations/src/shareasale/client.ts
packages/integrations/src/shareasale/__tests__/client.test.ts
packages/services/src/revenue/affiliate-sync-service.ts
apps/worker/src/jobs/affiliate-sync.ts
apps/worker/src/schedulers/affiliate-sync-scheduler.ts
apps/worker/src/queues.ts                                       # +affiliate-sync
apps/worker/src/index.ts
apps/web/app/api/v1/affiliate-programs/route.ts
apps/web/app/api/v1/affiliate-programs/[id]/route.ts
apps/web/app/api/v1/affiliate-programs/[id]/sync/route.ts
apps/web/app/(dashboard)/sites/[id]/revenue/_components/affiliate-programs.tsx
apps/web/lib/env.ts                                              # +AFFILIATE_ENC_KEY
docs/18-affiliate-integration.md
```

## 验收标准

- [ ] admin 配置 Amazon Associates 凭据 → 24h 内首次同步入库
- [ ] 手动 `POST /affiliate-programs/{id}/sync` 立即触发
- [ ] 重复 sync 不产生重复行（dedupe 工作正常）
- [ ] ShareASale 同上
- [ ] 凭据 DB 中加密存储（DEC key 缺失时报错）
- [ ] sync 失败时 `affiliate_programs.last_error` 写入 + alert
- [ ] `pnpm -r typecheck && lint && test` 全绿
