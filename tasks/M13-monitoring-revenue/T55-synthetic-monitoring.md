# T55 — Synthetic transaction monitoring

- **里程碑**：M13
- **优先级**：P2
- **前置依赖**：T11
- **预估工时**：8 h
- **状态**：Todo

## 目标

让站点能配置"多步骤合成监控脚本"（Playwright），平台定时跑、捕获结果、失败时触发 alert；超出现有 uptime GET 探活的能力。

## 范围

**包含**

- 新表 `synthetic_checks`：
  ```sql
  CREATE TABLE synthetic_checks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    script      TEXT NOT NULL,                  -- TypeScript Playwright 脚本
    interval_min INT NOT NULL DEFAULT 15,       -- 跑间隔（分钟）
    timeout_sec INT NOT NULL DEFAULT 60,
    active      BOOLEAN NOT NULL DEFAULT true,
    last_run_at TIMESTAMPTZ,
    last_status TEXT,                            -- 'success' | 'failed'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
- 新表 `synthetic_runs`：
  ```sql
  CREATE TABLE synthetic_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    check_id    UUID NOT NULL REFERENCES synthetic_checks(id) ON DELETE CASCADE,
    started_at  TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    status      TEXT NOT NULL,                   -- 'success' | 'failed' | 'timeout'
    duration_ms INT,
    error       TEXT,
    screenshot_path TEXT,                         -- 本地 / S3
    trace_path  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX synthetic_runs_check_idx ON synthetic_runs (check_id, started_at DESC);
  ```
- BullMQ 队列 `synthetic-check`，scheduler 按每个 check.interval_min 入队
- worker 端：`playwright` 已在 dev deps；新建 sandbox 进程 spawn 隔离脚本运行
- 失败后自动通过 alert 通道
- UI：
  - `/(dashboard)/sites/[id]/synthetic` 列表 + 编辑
  - `/(dashboard)/sites/[id]/synthetic/[id]/runs` 历史 + 失败时的 screenshot/trace 查看

**不包含**

- 脚本可视化编辑器（直接 monaco TS 编辑）
- 多浏览器（仅 chromium）
- 自定义断言 DSL（脚本直接抛 throw 即视为失败）

## 设计要点

### 沙盒执行

```ts
// apps/worker/src/jobs/synthetic-check.ts
import { spawn } from 'node:child_process';

async function runScript(script: string, timeoutMs: number): Promise<RunResult> {
  // 把 script 写到 tmp 文件 + 用 `pnpm tsx` spawn 跑
  const child = spawn('pnpm', ['tsx', tmpFile], { env: { ...process.env, NODE_ENV: 'test' } });
  // 收集 stdout / stderr / exit code，超时 kill
}
```

- 用 `playwright.chromium.launch` + `browser.newContext` + `tracing.start`
- failure 时自动 `page.screenshot()` 与 `tracing.stop({ path })` 落本地（与 T70 storage 抽象一致 → S3 可选）

### Script API

提供 helper 让脚本简短：

```ts
// scripts/synthetic-helpers.ts
export async function checkout(page, { product, email }) {
  /* 抽公共动作 */
}
```

脚本示例：

```ts
import { test, expect } from '@siteops/synthetic';

test('checkout flow', async ({ page }) => {
  await page.goto('https://shop.example.com');
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('checkout-email').fill('test@example.com');
  await expect(page.getByTestId('order-success')).toBeVisible();
});
```

### Scheduler

复用现有 scheduler 模式：每分钟扫描 active checks，按 `last_run_at + interval_min` 决定入队。

## 涉及文件

```
packages/db/migrations/00XX_synthetic_checks.sql
packages/db/migrations/00XX+1_synthetic_runs.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/synthetic-checks.ts
packages/db/src/schema/synthetic-runs.ts
packages/db/src/repositories/synthetic-check-repo.ts
packages/db/src/repositories/synthetic-run-repo.ts
packages/services/src/synthetic/synthetic-service.ts
packages/services/src/synthetic/script-runner.ts
packages/shared/src/schemas/synthetic.ts
apps/worker/src/jobs/synthetic-check.ts
apps/worker/src/schedulers/synthetic-scheduler.ts
apps/worker/src/queues.ts                                    # +synthetic-check
apps/worker/src/index.ts
apps/web/app/api/v1/sites/[id]/synthetic/route.ts
apps/web/app/api/v1/sites/[id]/synthetic/[checkId]/route.ts
apps/web/app/api/v1/sites/[id]/synthetic/[checkId]/runs/route.ts
apps/web/app/(dashboard)/sites/[id]/synthetic/page.tsx
apps/web/app/(dashboard)/sites/[id]/synthetic/[checkId]/page.tsx
apps/web/components/synthetic-script-editor.tsx
infra/Dockerfile.worker                                       # 已含 chromium，无需改
docs/16-synthetic-monitoring.md                                # 新文档
```

## 验收标准

- [ ] 迁移 apply 成功
- [ ] admin 上传一个简单脚本（page.goto）→ scheduler 入队 → worker 跑 → run 入库
- [ ] 失败脚本生成 screenshot + trace 文件，dashboard 可下载查看
- [ ] alert 通道收到 "synthetic failed: <name>"
- [ ] 超时脚本 status='timeout'，duration_ms ≈ timeout_sec\*1000
- [ ] interval=15 时按 15min 自动重跑
- [ ] `pnpm -r typecheck && lint && test` 全绿
