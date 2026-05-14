# T03 — Drizzle Schema 与首次迁移

- **里程碑**：M0
- **优先级**：P0
- **前置依赖**：T01
- **预估工时**：5h
- **状态**：Done

## 目标

按 `docs/03-data-model.md` 定义全部 MVP 表的 Drizzle schema，产出 SQL 迁移，并提供 seed 脚本创建初始 admin 用户。

## 范围

**包含**

- 所有 17 张表的 Drizzle schema 文件
- 各表索引与 check constraint
- `updated_at` 自动维护 trigger（用迁移 SQL 补一段）
- `drizzle.config.ts`
- `db client` 工厂（接受 `DATABASE_URL`，复用单例）
- 初始 admin seed 脚本（从 env 读 email/password）
- `pnpm db:generate` / `db:migrate` / `db:seed` / `db:studio` 脚本

**不包含**

- Repository 层（在 T04）
- 业务 service（在 T04）
- 数据归档逻辑（M2 housekeeping job）

## 设计要点

- 主键统一 `uuid("id").defaultRandom().primaryKey()`，依赖 `pgcrypto` 扩展（在第一份迁移启用 `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`）。
- 高频写入表（uptime_checks、search_console_daily、metrics_daily、jobs_log）用 `bigserial`。
- 枚举：用 Drizzle 的 `text(...).$type<...>()` + check constraint，便于扩展。
- 索引在 schema 文件中声明（drizzle 支持），不要手写裸 SQL 索引。
- 时间字段：`timestamp({ withTimezone: true, mode: "date" })`。
- jsonb 字段类型用 `jsonb().$type<...>()` 给到 TS 类型。
- 不引入外键级联 delete；归档用 status 字段。

## 涉及文件

```
packages/db/src/schema/index.ts
packages/db/src/schema/users.ts
packages/db/src/schema/api-keys.ts
packages/db/src/schema/sites.ts
packages/db/src/schema/domains.ts
packages/db/src/schema/deployments.ts
packages/db/src/schema/uptime-checks.ts
packages/db/src/schema/audits.ts             # audit_runs + audit_findings
packages/db/src/schema/metrics.ts            # metrics_daily + search_console_daily + adsense_daily
packages/db/src/schema/errors.ts
packages/db/src/schema/alerts.ts             # alert_rules + alert_channels + alerts
packages/db/src/schema/jobs-log.ts
packages/db/src/schema/agent-runs.ts
packages/db/src/client.ts
packages/db/src/seed.ts
packages/db/drizzle.config.ts
packages/db/migrations/0000_init.sql         # drizzle-kit 生成
packages/db/migrations/meta/_journal.json
packages/db/package.json                     # scripts: generate/migrate/seed/studio
```

## 验收标准

- [x] `pnpm db:generate` 产出 `0000_init.sql`，内容包含全部表 + 索引 + pgcrypto 扩展 + updated_at trigger
- [x] `pnpm db:migrate` 在空库上成功执行（PGlite 集成测试覆盖；真 PG 待 T02 docker 起来后手动验）
- [x] `pnpm db:seed` 读 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 在 users 表插入 1 行（bcrypt 哈希）
- [x] `pnpm db:studio` 能打开 schema 浏览（drizzle-kit 配置已就绪）
- [x] schema 单元测试：每张表至少一个 "插一行 + 读回来" 的 smoke test
- [x] 重复执行 migrate 是幂等的（migrate.test.ts 用 `__drizzle_migrations` 行数确认）

## 备注

- 若日后增表，命名 `NNNN_<desc>.sql`，永不修改已合并的迁移。
- updated_at trigger 用通用 `moddatetime` 扩展或自写 `BEFORE UPDATE` trigger，选自写以减少扩展依赖。

### 落地说明（2026-05-12 完成）

- **技术栈**：`drizzle-orm@0.45.2` + `drizzle-kit@0.31.10`；运行时驱动 `postgres@3.4.9`；测试驱动 `@electric-sql/pglite@0.4.5`（启用 `pgcrypto` 扩展）；密码 hash 用 `bcryptjs@3.x` cost=12。
- **17 张表全部落地**，按业务域聚合为 12 个 schema 文件：`users` / `api-keys` / `sites` / `domains` / `deployments` / `uptime-checks` / `audits`（含 `audit_runs` + `audit_findings`）/ `metrics`（含 `metrics_daily` + `search_console_daily` + `adsense_daily`）/ `errors` / `alerts`（含 `alert_rules` + `alert_channels` + `alerts`）/ `jobs-log` / `agent-runs`。统一 `src/schema/index.ts` 重导出。
- **枚举一律 `text + CHECK constraint`**，避免 PG enum 迁移噩梦；常量数组从 schema 文件导出（如 `SITE_TYPES`），供 T04 shared 与 UI 复用。
- **主键**：业务表 `uuid().defaultRandom()`（即 `gen_random_uuid()`，由迁移头部 `CREATE EXTENSION IF NOT EXISTS pgcrypto` 兜底）；高频写入表 `uptime_checks` / `metrics_daily` / `search_console_daily` / `adsense_daily` / `jobs_log` 用 `bigserial`。
- **`updated_at` 触发器**：仅 `users` 与 `sites` 两张表需要（数据模型里只有这两表声明了 `updated_at`）。trigger 函数 `set_updated_at()` 写在 `0000_init.sql` 末尾，零额外扩展依赖。
- **外键无级联**：所有 `references()` 走默认 `NO ACTION`；归档语义用 `status = 'archived'`，符合 `docs/03-data-model.md §4`。
- **特殊约束**：`alert_rules` 增加 `alert_rules_scope_site_consistency` CHECK，强制 `scope='global'⇔site_id IS NULL`；`sites_health_score_range` 限制 0–100；`audit_runs_score_range` 同理。
- **迁移文件**：`drizzle-kit generate` 产出后人工重命名为 `0000_init.sql` 并同步 `meta/_journal.json` 的 `tag`；头部追加 `CREATE EXTENSION pgcrypto`，尾部追加 trigger 函数与 `users`/`sites` 触发器绑定。后续每次 `db:generate` 仍会产生随机名文件，约定**合并前手工重命名**为 `NNNN_<desc>.sql` 并修正 journal。
- **客户端**：`createDb(url)` 用 `postgres-js` + URL 单例缓存；`closeDb()` 关闭全部池。CLI 脚本（migrate/seed）刻意用独立 `max=1` 短连接，避免与应用池争用。
- **测试**：`@siteops/db/testing` 暴露 `createTestDb()`（PGlite + 自动迁移）；smoke test 覆盖 17 张表 + `updated_at` trigger 行为 + 迁移幂等性，共 20 个用例，单跑 ~3.5s，无需 docker。
- **子路径导出**：`@siteops/db`（主入口，re-export schema + client）/ `@siteops/db/schema`（纯 schema）/ `@siteops/db/client`（连接池工具）/ `@siteops/db/testing`（PGlite 工具）。
- **package.json scripts**：`db:generate` / `db:migrate` / `db:seed` / `db:studio` / `db:drop` 全部就绪。`db:migrate` 与 `db:seed` 通过 `tsx` 直接跑 `src/scripts/*.ts`，不依赖 build 产物。
- **build/typecheck 分离**：`tsconfig.build.json` 仅编译 src 业务源码（排除 `__tests__/`、`*.test.ts`），`tsconfig.json` 是 typecheck 配（覆盖测试与 `drizzle.config.ts`/`vitest.config.ts`）。
- **未涉及**（按范围）：Repository 层（T04）、housekeeping 归档 job（M2）、`updated_by` 审计字段（T08+ 接入 admin 上下文后再补）。
