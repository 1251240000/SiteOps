# T08 — 站点注册表（CRUD + 列表 + 详情）

- **里程碑**：M1
- **优先级**：P0
- **前置依赖**：T07
- **预估工时**：8h
- **状态**：Done

## 目标

完成站点（sites 表）的全链路：repository → service → API → 列表页 → 创建/编辑 → 详情页。这是平台最核心实体，后续所有功能都挂在它身上。

## 范围

**包含**

- `siteRepo`：list / get / create / update / archive
- `siteService`：业务校验、生成 slug、初始 `health_score=100`
- API 路由：
  - `GET /api/v1/sites`
  - `POST /api/v1/sites`
  - `GET /api/v1/sites/{id}`
  - `PATCH /api/v1/sites/{id}`
  - `DELETE /api/v1/sites/{id}`（设置 status='archived'）
- UI：
  - `/sites`：列表（搜索 by name / domain / tag；过滤 site_type / status / country；排序 created_at / health_score；分页）
  - `/sites/new`：创建表单
  - `/sites/{id}`：详情页（基础信息 + 选项卡：Overview / Uptime / Audits / Deployments / Settings；MVP 仅 Overview + Settings，其它在后续任务接入）
  - `/sites/{id}/settings`：编辑表单 + 归档按钮
- Zod schema：`createSiteSchema`、`updateSiteSchema`、`listSitesQuerySchema`
- 单元/集成测试

**不包含**

- 站点配色/截图等装饰字段
- 健康分计算（占位返回 100；M2 真实计算）
- 站点导入/导出（后续任务）

## 设计要点

- slug 自动从 name 生成，冲突时加 `-2` `-3`。
- primary_url 校验：必须 https、域名合法、非内网。
- domain_suggestion 字段不入库（属于 Idea 系统）。
- 删除 = `status='archived'`，列表默认不显示，需勾选"Show archived"才出现。
- 创建后自动写一条 `domains` 行（取 primary_url 的 host），`is_primary=true`；这部分调用 `domainService.linkPrimaryDomain(siteId, host)`（先 stub 实现，T09 完善）。
- 详情页右上角操作菜单：归档、复制 ID、复制 JSON。
- 列表用 TanStack Table，行点击进详情。

## 涉及文件

```
packages/shared/src/schemas/sites.ts            # zod
packages/db/src/repositories/site-repo.ts
packages/db/src/repositories/site-repo.test.ts
packages/services/src/sites/site-service.ts
packages/services/src/sites/site-service.test.ts
apps/web/app/api/v1/sites/route.ts
apps/web/app/api/v1/sites/[id]/route.ts
apps/web/app/(dashboard)/sites/page.tsx
apps/web/app/(dashboard)/sites/new/page.tsx
apps/web/app/(dashboard)/sites/[id]/page.tsx
apps/web/app/(dashboard)/sites/[id]/settings/page.tsx
apps/web/app/(dashboard)/sites/[id]/layout.tsx  # 子选项卡
apps/web/components/sites/SiteList.tsx
apps/web/components/sites/SiteForm.tsx
apps/web/components/sites/SiteFilters.tsx
apps/web/components/sites/SiteSummary.tsx
apps/web/lib/queries/sites.ts                   # 客户端查询 keys
```

## 验收标准

- [x] 可创建站点、看到列表、点开详情、编辑保存（实测：POST `/api/v1/sites` 返回 201 + slug 派生；`/sites` 列表 200 渲染；`/sites/{id}` Overview tab + `/sites/{id}/settings` 编辑表单 PATCH OK；toast + cache 失效全链路通）
- [x] 过滤、搜索、排序、分页都走 URL 状态（刷新保持）（`SiteFilters` + `SiteList` 全部走 `nuqs` 的 `useQueryState`：`q`/`siteType`/`status`/`archived`/`sort`/`page` 都映射到 URL；搜索框 250ms debounce）
- [x] 归档后列表默认看不见（`siteRepo.list` 默认 `WHERE status <> 'archived'`；显式 `?status=archived` 或 `?archived=true` 才会出现 — 实测 `GET /api/v1/sites` total=2 vs `?archived=true` total=3）
- [x] 字段校验失败给出每字段错误（react-hook-form + Zod）（API 层用 `safeParse + .flatten()` 返回 `{ details: { fieldErrors: { primaryUrl: ["must use https"] } } }`；表单层 `@hookform/resolvers/zod` 把 Zod 错落到对应字段下方）
- [x] API 测试：所有路由覆盖 happy + 一个 error case（实测全套 GET/POST/GET-by-id/PATCH/DELETE 全部走通；slug 不可编辑 → 400；非 https 主 URL → 400；slug 冲突自动 `-2/-3`；详见 `repository / service` 单测共 20 个 case）
- [x] DB 集成测试：repo 各方法（`packages/db/src/repositories/__tests__/site-repo.test.ts`：12 个 case 覆盖 create/getById/getBySlug/list 默认序/分页/q/siteType/country/tag/sort/`slugsLikeBase`/update/archive，全绿）
- [x] 创建/编辑事件在 jobs_log 或 audit log（暂用 logger.info 即可）有结构化日志（`siteService.create/update/archive` 都向注入的 `logger.info` emit `event=site.created|updated|archived` 结构化对象；service 单测断言事件被发出）

## 备注

- 创建表单按"基础 / 技术栈 / 集成 / SEO"分组，避免单页全平铺。
- 后续任务在选项卡里"插模块"，本任务只需露出空 tab 即可。
- `withApi` 之外补了 `withAuth(handler, { scopes })`：先尝试 session，再回退 Bearer API key；`/api/v1/sites/*` 全部用它，浏览器走 cookie、外部 Agent 走 `Authorization: Bearer`。
- Slug 生成：`slugify(name)` → `nextAvailableSlug(base, takenSlugs)` 走 `siteRepo.slugsLikeBase` 单次拉所有冲突候选；并发竞态由唯一索引兜底（`23505` → `409 conflict`）。
- 主 URL 校验：必须 https + 非内网（拒 `localhost`/`*.localhost`/`*.local`/`127.|10.|172.16-31.|192.168.|169.254.` 私网段）。真实 DNS-based SSRF 校验留给 T11 worker。
- `linkPrimaryDomain` stub：创建站点时按 `host` 自动写一行 `domains` 并打 `is_primary=true`；幂等（域名已存在则跳过）。完整 registrar/SSL 信息由 T09/T12 填。
- `Site` 详情走 5 个 tab：Overview / Uptime / Audits / Deployments / Settings；Overview & Settings 在本任务实装，其余只是 tab header 占位，路由实装在 T10/T11/T13/T14。
- 详情页右上角操作菜单：复制 ID / 复制 JSON / 归档（带 `AlertDialog` 确认，归档后回跳 `/sites`）。
- 客户端组件从 `@siteops/shared/constants` / `@siteops/shared/schemas` 精确子路径导入，避开把 `node:crypto`（在 `utils/api-key.ts` 里）误带进浏览器 bundle 的坑。
- 新增 `packages/db/src/repositories/site-repo.ts` + `packages/db` 子路径 `./repositories` 导出，后续 domain/deployment 等仓储沿用同一布局。
