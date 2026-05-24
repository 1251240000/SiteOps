# T42 — 管理动作审计日志

- **里程碑**：M9
- **优先级**：P1
- **前置依赖**：T40
- **预估工时**：8 h
- **状态**：Todo

## 目标

把所有"人类发起的管理动作"（不仅是 Agent / API key 调用）落进 `audit_logs` 表，提供 dashboard 查询入口；与现有 `agent_runs`（机器调用审计）区分但风格统一。

## 范围

**包含**

- 新表 `audit_logs`：
  ```sql
  CREATE TABLE audit_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID NOT NULL REFERENCES users(id),
    actor_role   TEXT NOT NULL,
    action       TEXT NOT NULL,                -- e.g. 'site.create', 'api_key.revoke'
    resource     TEXT NOT NULL,                -- 'site', 'api_key', 'alert_rule'
    resource_id  TEXT,                         -- 关联记录主键
    before       JSONB,                        -- mutation 前 snapshot
    after        JSONB,                        -- mutation 后 snapshot
    ip           INET,
    user_agent   TEXT,
    request_id   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC);
  CREATE INDEX audit_logs_resource_idx ON audit_logs (resource, resource_id);
  CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);
  ```
- service：`packages/services/src/audit/audit-service.ts.record(deps, entry)`
- `with-api.ts.withAudit(action, resource)` 包装：自动 diff before/after
- 在所有 mutation 服务（siteService, alertRuleService, apiKeyService, userService, integrationService）调用点埋点
- 路由 `GET /api/v1/audit-logs`（admin 全部、其他用户仅本人）
- UI：`/(dashboard)/settings/audit` —— 列表 + actor / action / resource 过滤

**不包含**

- 业务表自带 `created_by` / `updated_by`（现状大部分表无此列；本任务集中走 audit_logs 不改业务表）
- 跨实例日志聚合 / SIEM 推送（留 M11 - OTel/Prom）

## 设计要点

### Audit decorator

```ts
// services/src/audit/with-audit.ts
export function withAudit<TArgs extends unknown[], TResult>(
  config: {
    action: string;
    resource: string;
    resourceId: (args: TArgs, result: TResult) => string;
  },
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args) => {
    const before = await captureBefore(config, args);
    const result = await fn(...args);
    const after = await captureAfter(config, result);
    void auditService
      .record({
        action: config.action,
        resource: config.resource,
        resourceId: config.resourceId(args, result),
        before,
        after,
        actorUserId: getActor().id /* ... */,
      })
      .catch((e) => log.warn('audit failed', e));
    return result;
  };
}
```

- 失败的 audit 不阻断业务流，只 log warn
- 自动 diff：用 deep-equal + `picomatch` 排除敏感字段（password_hash, key_hash, totp_secret）

### Action 命名

`{resource}.{verb}`，例：

- `site.create`、`site.update`、`site.archive`
- `api_key.create`、`api_key.revoke`
- `alert_rule.create`、`alert_rule.update`、`alert_rule.delete`
- `user.invite`、`user.role_change`、`user.suspend`
- `integration.connect`、`integration.disconnect`
- `webhook.replay`

### 查询 UI

```
/settings/audit
  ?actor=user_id
  &action=site.create
  &resource=alert_rule
  &fromTs=ISO
  &toTs=ISO
  &limit=20&cursor=...
```

走 T36 cursor 分页。

## 涉及文件

```
packages/db/migrations/00XX_audit_logs.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/audit-logs.ts                      # 新
packages/db/src/schema/index.ts                            # 导出
packages/db/src/repositories/audit-log-repo.ts             # 新
packages/services/src/audit/audit-service.ts               # 新
packages/services/src/audit/with-audit.ts                   # decorator
packages/services/src/index.ts                              # 加 namespace
packages/services/src/sites/site-service.ts                 # 用 withAudit
packages/services/src/alerts/alert-rule-service.ts          # 同
packages/services/src/auth/api-key-service.ts               # 同
packages/services/src/users/user-service.ts                 # 同
packages/services/src/integrations/*.ts                     # 同（connect/disconnect）
apps/web/lib/with-api.ts                                    # 注入 actor context
apps/web/app/api/v1/audit-logs/route.ts                     # 新
apps/web/app/(dashboard)/settings/audit/page.tsx            # 新
apps/web/app/(dashboard)/settings/audit/_components/*.tsx
apps/web/lib/queries/audit-logs.ts
```

## 验收标准

- [ ] 迁移 apply 成功，3 条 index 建立
- [ ] 单测：withAudit 包装后 mutation 既成功又写入 audit_logs
- [ ] 单测：audit 写失败不影响业务返回
- [ ] 单测：敏感字段（password_hash 等）不出现在 before/after
- [ ] e2e：admin 改 alert rule → 在 `/settings/audit` 看到对应行 + before/after diff
- [ ] e2e：viewer 仅看到自己的行（操作受限）
- [ ] `pnpm -r typecheck && lint && test && test:e2e` 全绿
