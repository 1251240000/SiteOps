# 03 · 数据模型

> 所有表使用 PostgreSQL 16 + Drizzle ORM。命名 `snake_case`；主键统一 `id` 为 `uuid` (`gen_random_uuid()`)；时间字段统一 `created_at` / `updated_at` (`timestamptz`)，由 trigger 自动维护 `updated_at`。

## 1. 表清单（MVP）

```
users                  -- 单 admin（MVP 仅 1 行）
api_keys               -- 外部 Agent 调用本平台用
sites                  -- 被管站点主表
domains                -- 域名（与站点 N:1 或 1:1）
deployments            -- 每次部署记录
uptime_checks          -- HTTP 健康检查结果
audit_runs             -- 一次审计任务（SEO 或 Lighthouse）
audit_findings         -- 审计中发现的问题
metrics_daily          -- 每日聚合指标（PV/UV/收入/RPM）
search_console_daily   -- GSC 每日数据
adsense_daily          -- AdSense 每日数据
errors                 -- 站点错误（接收 + 列表）
alerts                 -- 已触发的告警
alert_rules            -- 告警规则配置
alert_channels         -- 通知通道（webhook、邮件）
jobs_log               -- BullMQ job 执行历史
agent_runs             -- 外部 Agent 调用记录（M5）
```

## 2. 关系图

```
users ──< api_keys

sites ──< domains
      ──< deployments
      ──< uptime_checks
      ──< audit_runs ──< audit_findings
      ──< metrics_daily
      ──< search_console_daily
      ──< adsense_daily
      ──< errors
      ──< alerts

alert_rules ──< alerts
alert_channels ──< alerts (notification target)
```

## 3. 表结构（关键字段）

> 完整 Drizzle schema 在 T03 任务中产出。下面只列字段、类型与说明，作为评审基线。

### 3.1 `users`

| 字段          | 类型        | 约束             | 说明     |
| ------------- | ----------- | ---------------- | -------- |
| id            | uuid        | PK               |          |
| email         | text        | unique, not null | 登录账号 |
| password_hash | text        | not null         | bcrypt   |
| name          | text        |                  |          |
| created_at    | timestamptz | default now()    |          |
| updated_at    | timestamptz |                  |          |

### 3.2 `api_keys`

| 字段         | 类型        | 约束             | 说明                                       |
| ------------ | ----------- | ---------------- | ------------------------------------------ |
| id           | uuid        | PK               |                                            |
| name         | text        | not null         | 备注（如 "trend-agent"）                   |
| key_hash     | text        | not null, unique | bcrypt(key)                                |
| key_prefix   | text        | not null         | 前 8 位明文，便于识别                      |
| scopes       | text[]      | not null         | 例如 `['sites:read', 'deployments:write']` |
| last_used_at | timestamptz |                  |                                            |
| expires_at   | timestamptz |                  | nullable                                   |
| revoked_at   | timestamptz |                  |                                            |
| created_at   | timestamptz |                  |                                            |

### 3.3 `sites`

| 字段                    | 类型        | 约束                       | 说明                                                         |
| ----------------------- | ----------- | -------------------------- | ------------------------------------------------------------ |
| id                      | uuid        | PK                         |                                                              |
| slug                    | text        | unique, not null           | URL safe，便于路由                                           |
| name                    | text        | not null                   | 站点显示名                                                   |
| primary_url             | text        | not null                   | 主 URL（含 https://）                                        |
| site_type               | text        | not null                   | enum: `directory` / `tool` / `content` / `forum` / `landing` |
| status                  | text        | not null, default `active` | enum: `active` / `paused` / `archived`                       |
| target_country          | text        |                            | ISO 3166-1 alpha-2                                           |
| target_language         | text        |                            | ISO 639-1                                                    |
| tech_stack              | jsonb       |                            | `{framework, hosting, db?}`                                  |
| repo_url                | text        |                            | git repo                                                     |
| repo_provider           | text        |                            | enum: `github` / `gitlab` / `gitee`                          |
| cf_account_id           | text        |                            |                                                              |
| cf_pages_project        | text        |                            |                                                              |
| analytics_provider      | text        |                            | enum: `ga4` / `plausible` / `none`                           |
| analytics_id            | text        |                            | property/site id                                             |
| search_console_property | text        |                            | sc-domain:xxx 或 https://xxx                                 |
| adsense_publisher_id    | text        |                            | pub-xxx                                                      |
| adsense_status          | text        |                            | enum: `pending` / `approved` / `rejected` / `not_applied`    |
| health_score            | smallint    | default 100                | 0–100，自动计算                                              |
| tags                    | text[]      | default `{}`               | 自定义标签                                                   |
| notes                   | text        |                            |                                                              |
| created_at              | timestamptz |                            |                                                              |
| updated_at              | timestamptz |                            |                                                              |

索引：`(site_type)`, `(status)`, `(target_country)`, `tags GIN`。

### 3.4 `domains`

| 字段           | 类型        | 约束             | 说明                         |
| -------------- | ----------- | ---------------- | ---------------------------- |
| id             | uuid        | PK               |                              |
| site_id        | uuid        | FK sites.id      | nullable（域名可暂未关联）   |
| domain         | text        | unique, not null | apex 或 subdomain            |
| is_primary     | boolean     | default false    | 站点的主域                   |
| registrar      | text        |                  | namecheap/cloudflare/godaddy |
| registered_at  | date        |                  |                              |
| expires_at     | date        |                  | 续费提醒源                   |
| auto_renew     | boolean     |                  |                              |
| dns_provider   | text        |                  | cloudflare/route53           |
| ssl_issuer     | text        |                  | last seen issuer             |
| ssl_expires_at | timestamptz |                  | last seen NotAfter           |
| created_at     | timestamptz |                  |                              |

索引：`(site_id)`, `(expires_at)`, `(ssl_expires_at)`.

### 3.5 `deployments`

| 字段                   | 类型        | 约束     | 说明                                                                        |
| ---------------------- | ----------- | -------- | --------------------------------------------------------------------------- |
| id                     | uuid        | PK       |                                                                             |
| site_id                | uuid        | FK       |                                                                             |
| provider               | text        |          | enum: `cloudflare_pages` / `github_pages` / `vercel` / `netlify` / `manual` |
| provider_deployment_id | text        |          |                                                                             |
| commit_sha             | text        |          |                                                                             |
| commit_message         | text        |          |                                                                             |
| branch                 | text        |          |                                                                             |
| status                 | text        | not null | enum: `queued` / `building` / `success` / `failed` / `cancelled`            |
| started_at             | timestamptz |          |                                                                             |
| finished_at            | timestamptz |          |                                                                             |
| duration_ms            | integer     |          |                                                                             |
| build_log_url          | text        |          |                                                                             |
| triggered_by           | text        |          | enum: `human` / `git_push` / `agent` / `schedule`                           |
| created_at             | timestamptz |          |                                                                             |

索引：`(site_id, started_at desc)`, `(status)`.

### 3.6 `uptime_checks`

| 字段             | 类型        | 约束            | 说明                        |
| ---------------- | ----------- | --------------- | --------------------------- |
| id               | bigserial   | PK              | 高频写入用 bigserial        |
| site_id          | uuid        | FK              |                             |
| checked_at       | timestamptz | not null        |                             |
| url              | text        | not null        | 实际请求的 URL              |
| status_code      | smallint    |                 | nullable on network err     |
| response_time_ms | integer     |                 |                             |
| ok               | boolean     | not null        | 业务判定（2xx/3xx 视为 ok） |
| error            | text        |                 | 网络错误信息                |
| region           | text        | default `local` | 多地区检查后用              |

索引：`(site_id, checked_at desc)`.
保留：滚动 90 天，旧数据归档到日聚合（见 `metrics_daily`）。

### 3.7 `audit_runs`

| 字段            | 类型        | 约束     | 说明                                                |
| --------------- | ----------- | -------- | --------------------------------------------------- |
| id              | uuid        | PK       |                                                     |
| site_id         | uuid        | FK       |                                                     |
| audit_type      | text        | not null | enum: `seo` / `lighthouse` / `links` / `compliance` |
| status          | text        |          | enum: `running` / `success` / `failed`              |
| started_at      | timestamptz |          |                                                     |
| finished_at     | timestamptz |          |                                                     |
| score           | smallint    |          | 0–100，类型相关                                     |
| summary         | jsonb       |          | 各维度分数                                          |
| raw_report_path | text        |          | 大报告存文件，DB 只存路径                           |
| created_at      | timestamptz |          |                                                     |

### 3.8 `audit_findings`

| 字段         | 类型        | 约束     | 说明                                            |
| ------------ | ----------- | -------- | ----------------------------------------------- |
| id           | uuid        | PK       |                                                 |
| audit_run_id | uuid        | FK       |                                                 |
| site_id      | uuid        | FK       | denormalized                                    |
| severity     | text        | not null | enum: `info` / `warning` / `error` / `critical` |
| code         | text        | not null | 例如 `seo.missing_meta_description`             |
| title        | text        | not null |                                                 |
| message      | text        |          |                                                 |
| url          | text        |          | 出问题的页面                                    |
| meta         | jsonb       |          | 额外上下文                                      |
| created_at   | timestamptz |          |                                                 |

索引：`(site_id, severity)`, `(code)`.

### 3.9 `metrics_daily`

每站每日一行的聚合（来自 GA/Plausible + 内部计算）。

| 字段                  | 类型          | 说明         |
| --------------------- | ------------- | ------------ |
| id                    | bigserial     | PK           |
| site_id               | uuid          | FK           |
| date                  | date          | not null     |
| pv                    | integer       | default 0    |
| uv                    | integer       | default 0    |
| sessions              | integer       | default 0    |
| bounce_rate           | numeric(5,4)  |              |
| avg_session_sec       | integer       |              |
| revenue_usd           | numeric(10,4) | 全部货源汇总 |
| ad_revenue_usd        | numeric(10,4) |              |
| affiliate_revenue_usd | numeric(10,4) |              |
| uptime_pct            | numeric(5,4)  |              |
| created_at            | timestamptz   |              |

unique `(site_id, date)`.

### 3.10 `search_console_daily`

| 字段        | 类型         | 说明                             |
| ----------- | ------------ | -------------------------------- |
| id          | bigserial    | PK                               |
| site_id     | uuid         | FK                               |
| date        | date         |                                  |
| query       | text         | nullable（聚合行 query 为 null） |
| country     | text         | nullable                         |
| device      | text         | nullable                         |
| clicks      | integer      |                                  |
| impressions | integer      |                                  |
| ctr         | numeric(5,4) |                                  |
| position    | numeric(6,2) |                                  |

unique `(site_id, date, query, country, device)`.

### 3.11 `adsense_daily`

| 字段         | 类型          | 说明 |
| ------------ | ------------- | ---- |
| id           | bigserial     | PK   |
| site_id      | uuid          | FK   |
| date         | date          |      |
| earnings_usd | numeric(10,4) |      |
| page_views   | integer       |      |
| impressions  | integer       |      |
| clicks       | integer       |      |
| rpm          | numeric(10,4) |      |
| ctr          | numeric(5,4)  |      |

unique `(site_id, date)`.

### 3.12 `errors`

简化版错误聚合。

| 字段          | 类型        | 说明                                    |
| ------------- | ----------- | --------------------------------------- |
| id            | uuid        | PK                                      |
| site_id       | uuid        | FK                                      |
| source        | text        | enum: `js` / `build` / `api` / `worker` |
| level         | text        | enum: `error` / `warning`               |
| fingerprint   | text        | 用于聚合的哈希                          |
| message       | text        |                                         |
| stack         | text        |                                         |
| count         | integer     | default 1                               |
| first_seen_at | timestamptz |                                         |
| last_seen_at  | timestamptz |                                         |
| resolved_at   | timestamptz | nullable                                |
| meta          | jsonb       | url, ua, etc.                           |

unique `(site_id, fingerprint)`.

### 3.13 `alert_rules`

| 字段           | 类型        | 说明                                                                                          |
| -------------- | ----------- | --------------------------------------------------------------------------------------------- |
| id             | uuid        | PK                                                                                            |
| name           | text        |                                                                                               |
| scope          | text        | enum: `global` / `site`                                                                       |
| site_id        | uuid        | nullable when scope=global                                                                    |
| metric         | text        | enum: `uptime` / `ssl_expiry` / `domain_expiry` / `lighthouse_perf` / `error_rate` / `custom` |
| operator       | text        | enum: `lt` / `lte` / `gt` / `gte` / `eq`                                                      |
| threshold      | numeric     |                                                                                               |
| window_minutes | integer     | nullable                                                                                      |
| consecutive    | smallint    | default 1                                                                                     |
| enabled        | boolean     | default true                                                                                  |
| channel_ids    | uuid[]      | FK refs alert_channels.id                                                                     |
| created_at     | timestamptz |                                                                                               |

### 3.14 `alert_channels`

| 字段       | 类型        | 说明                                                                     |
| ---------- | ----------- | ------------------------------------------------------------------------ |
| id         | uuid        | PK                                                                       |
| name       | text        |                                                                          |
| type       | text        | enum: `webhook` / `email` / `feishu` / `dingtalk` / `slack` / `telegram` |
| config     | jsonb       | 加密存储                                                                 |
| enabled    | boolean     |                                                                          |
| created_at | timestamptz |                                                                          |

`config` 解密后按 `type` 取不同 shape：

| type       | shape                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook`  | `{ url: string; headers?: Record<string,string> }`                                                                                              |
| `email`    | `{ to: string \| string[]; subjectPrefix?: string }` — 实际 transport（resend/smtp/disabled）由进程级 env (`EMAIL_PROVIDER` 等) 决定（M10/T44） |
| `feishu`   | `{ webhookUrl: string; secret?: string }`                                                                                                       |
| `dingtalk` | `{ webhookUrl: string; secret?: string }`                                                                                                       |
| `slack`    | `{ webhookUrl: string }`                                                                                                                        |
| `telegram` | `{ botToken: string; chatId: string \| number }`                                                                                                |

### 3.15 `alerts`

| 字段              | 类型        | 说明                                 |
| ----------------- | ----------- | ------------------------------------ |
| id                | uuid        | PK                                   |
| rule_id           | uuid        | FK                                   |
| site_id           | uuid        | nullable                             |
| status            | text        | enum: `firing` / `resolved`          |
| value             | numeric     | 触发时的指标值                       |
| message           | text        |                                      |
| fired_at          | timestamptz |                                      |
| resolved_at       | timestamptz |                                      |
| notified_channels | jsonb       | `[{channel_id, sent_at, ok, error}]` |

索引：`(status)`, `(site_id, fired_at desc)`.

### 3.16 `jobs_log`

| 字段        | 类型        | 说明                       |
| ----------- | ----------- | -------------------------- |
| id          | bigserial   | PK                         |
| queue       | text        |                            |
| job_name    | text        |                            |
| job_id      | text        | BullMQ id                  |
| status      | text        | enum: `success` / `failed` |
| attempts    | smallint    |                            |
| started_at  | timestamptz |                            |
| finished_at | timestamptz |                            |
| duration_ms | integer     |                            |
| error       | text        |                            |
| meta        | jsonb       |                            |

保留 30 天。

### 3.17 `agent_runs`（M5）

| 字段        | 类型        | 说明                                        |
| ----------- | ----------- | ------------------------------------------- |
| id          | uuid        | PK                                          |
| api_key_id  | uuid        | FK                                          |
| agent_name  | text        |                                             |
| action      | text        | 例如 `ideas.propose` / `deployments.report` |
| input       | jsonb       |                                             |
| output      | jsonb       |                                             |
| status      | text        | enum: `success` / `failed`                  |
| duration_ms | integer     |                                             |
| created_at  | timestamptz |                                             |

## 4. 数据规范

- **时间**：全部 `timestamptz`，DB 设为 UTC，前端按用户时区展示。
- **金额**：`numeric(10,4)` USD 为基准币种。展示时再换算。
- **枚举**：用 `text + check constraint` 而非 PG enum，避免迁移噩梦。
- **JSONB**：仅用于结构频繁变化、不被强类型查询的字段。
- **软删除**：MVP 不做软删除；归档用 `status='archived'` 标记。
- **审计字段**：所有"变更敏感"表（sites/alert_rules/alert_channels）加 `updated_by uuid`，记录最后修改人。

## 5. 容量估算（粗）

| 表                   | 100 站点/年增长                         | 备注                               |
| -------------------- | --------------------------------------- | ---------------------------------- |
| uptime_checks        | 100 × 288/天 × 365 ≈ 10.5M 行           | 5 min 间隔；90 天后归档可降到 2.6M |
| metrics_daily        | 100 × 365 = 36.5K 行                    | 极轻                               |
| search_console_daily | 100 × 365 × 平均 50 query/day = 1.8M 行 | 主要数据量                         |
| audit_runs           | 100 × 2/天 × 365 = 73K 行               | 配 audit_findings ~10×             |
| jobs_log             | 30 天滚动 ≈ 数十万行                    | 定时清理                           |

PG 16 单实例毫无压力。
