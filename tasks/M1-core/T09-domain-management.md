# T09 — 域名管理与到期提醒（数据层）

- **里程碑**：M1
- **优先级**：P0
- **前置依赖**：T08
- **预估工时**：6h
- **状态**：Done

## 目标

完成 domains 表的 CRUD、与站点的关联、域名注册/SSL 到期日的录入与可视化。SSL/到期巡检的自动同步任务在 T12 完成。

## 范围

**包含**

- `domainRepo` + `domainService`
- API：
  - `GET /api/v1/domains`
  - `POST /api/v1/domains`
  - `PATCH /api/v1/domains/{id}`
  - `DELETE /api/v1/domains/{id}`
  - `GET /api/v1/sites/{id}/domains`
- UI：
  - 全局页 `/domains`：列表（按到期时间排序），高亮 30 天内到期
  - 站点详情下嵌入"Domains"子模块（在 `(dashboard)/sites/[id]/page.tsx` 的 Overview 卡片中）
- 表单字段：domain, registrar, registered_at, expires_at, auto_renew, dns_provider
- `is_primary` 切换（同站只允许一个 primary，service 内做事务处理）
- 域名名规范化（小写、去末尾点、不带 scheme/path）

**不包含**

- WHOIS 自动拉取（M3 可选扩展）
- DNS 记录管理
- SSL 证书自动续期

## 设计要点

- 切换 primary：`UPDATE domains SET is_primary=false WHERE site_id=$1; UPDATE domains SET is_primary=true WHERE id=$2`，事务包裹。
- 域名校验用 `is-valid-domain` 或简单正则 + Public Suffix List（先简单正则，足够）。
- 全局视图：标记字段 `daysUntilDomainExpiry` / `daysUntilSslExpiry`（service 层算）。
- 列表性能：100 域名以内一次查全；超过加分页。

## 涉及文件

```
packages/shared/src/schemas/domains.ts
packages/db/src/repositories/domain-repo.ts
packages/db/src/repositories/domain-repo.test.ts
packages/services/src/domains/domain-service.ts
packages/services/src/domains/domain-service.test.ts
apps/web/app/api/v1/domains/route.ts
apps/web/app/api/v1/domains/[id]/route.ts
apps/web/app/api/v1/sites/[id]/domains/route.ts
apps/web/app/(dashboard)/domains/page.tsx
apps/web/components/domains/DomainList.tsx
apps/web/components/domains/DomainForm.tsx
apps/web/components/domains/DomainCard.tsx     # 用于 site 详情页
apps/web/lib/queries/domains.ts
```

## 验收标准

- [x] 可在站点详情录入主域 + 备用域（`DomainCard` 在 `/sites/[id]` Overview tab 提供 Add/Make-primary/Delete；实测站点创建后 primary 自动 attach，再加 alt/future/past 三条都成功 201）
- [x] 切换 primary 后旧 primary 自动清零（`domainService.update({isPrimary:true})` 走事务：先 `UPDATE … SET isPrimary=false WHERE site_id=$ AND isPrimary=true`，再 `UPDATE … SET isPrimary=true WHERE id=$`；实测 PATCH alt → primary 后 listForSite 仅 alt 为 primary，countPrimary=1）
- [x] `/domains` 列表按到期排序，30 天内到期行标红（默认 `sort=expires_at` ASC，行 className 三档：已过期 `bg-destructive/5`、≤30d `bg-warning/5`、其余正常；`ExpiryCell` 显示 "in Nd" / "today" / "Nd ago" 徽章）
- [x] 删除域名前若是 primary 给出二次确认（`DomainCard` 在 primary 行或最后一行点删除会弹 `AlertDialog` 询问；非 primary 直接删除）
- [x] 单测：normalizeDomain、setPrimary 事务（`packages/shared/__tests__/domain.test.ts` 16 case 覆盖 normalize/isValidDomain；`packages/db/repositories/__tests__/domain-repo.test.ts` 13 case 覆盖 list/listForSite/CRUD/setPrimary 事务/`countPrimary`；`packages/services/domains/__tests__/domain-service.test.ts` 18 case 覆盖 daysUntil 计算 / 转主域事务 / attachPrimary 幂等）

## 备注

- expires_at 字段用 `date` 而非 `timestamptz`，避免时区误差。
- SSL 探测在 T12 接入；T09 只显示已录入的值（手动或后续 worker 写入）。
- 域名规范化 `normalizeDomain`：剥 scheme / userinfo / port / path / query / fragment / 末尾点；`isValidDomain` 用 RFC 1035-ish 正则 + 长度上限 + 黑名单（localhost / \*.local）。`HOSTNAME_RE` 接受 punycode 标签（`xn--…`）。
- `domainService.attachPrimary` 替代了 T08 临时 stub `linkPrimaryDomain` 直接 `INSERT`：现在统一走 attachPrimary（已存在 → 同站点幂等返回；同站点已存在但非 primary → setPrimary 提升；属于其他站点 → null + warn 日志）。
- API 路由：`GET/POST /api/v1/domains`、`GET/PATCH/DELETE /api/v1/domains/{id}`、`GET/POST /api/v1/sites/{id}/domains`（后者会忽略 body 的 siteId，以路径为准）。`expiringWithinDays` 过滤用 PG `current_date + N::integer`，避免 JS 端 timezone 误差。
- 客户端：`components/domains/{domain-list,domain-filters,domain-card,expiry-cell}.tsx`；URL state 用 `nuqs`（`q` / `expiringWithinDays` / `sort` / `page`）。
- 计算字段：`domainService` 在 list/get/listForSite 输出 `daysUntilDomainExpiry` 与 `daysUntilSslExpiry`，UI 直接拿来上色，不在浏览器再算 timezone。
