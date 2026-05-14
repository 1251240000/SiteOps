# T13 — SEO 自动审计

- **里程碑**：M2
- **优先级**：P1
- **前置依赖**：T08
- **预估工时**：7h
- **状态**：Done

## 目标

为每个站点每日抓取首页 + sitemap，检查 SEO 元信息完整性、sitemap/robots 合法性、hreflang 一致性，结果落 `audit_runs` + `audit_findings`。

## 范围

**包含**

- worker job：`seo-audit`（每站每日 1 次）
- 抓取：fetch + cheerio 解析 HTML
- 检查项（每项一个 finding code）：
  - `seo.missing_title` / `title_too_long`
  - `seo.missing_meta_description` / `meta_description_too_long`
  - `seo.missing_canonical` / `canonical_mismatch`
  - `seo.missing_og_image`
  - `seo.no_h1` / `multiple_h1`
  - `seo.sitemap_missing` / `sitemap_invalid`
  - `seo.robots_missing` / `robots_disallow_root`
  - `seo.hreflang_mismatch`（声明语言与实际不符）
  - `seo.structured_data_invalid`（JSON-LD parse 失败）
- API：
  - `POST /api/v1/sites/{id}/audits`（body: `{ type: 'seo' }`）触发即时审计
  - `GET /api/v1/sites/{id}/audits`
  - `GET /api/v1/audits/{id}`
  - `GET /api/v1/audits/{id}/findings`
- UI：
  - 站点详情新增 Audits 选项卡：历史审计列表 + 单次审计详情（findings 按 severity 分组）

**不包含**

- 全站爬虫（仅首页 + sitemap 索引）
- 抓取站点深层页面（M2 后期或 M4）

## 设计要点

- 抓取限制：超过 1MB HTML 截断；超时 15s。
- User-Agent：`SiteOpsBot/1.0 (+https://siteops.local)`。
- sitemap：尝试 `/sitemap.xml` 和 `/sitemap_index.xml`；解析失败给 finding。
- robots：解析 `User-agent: *` 块的 Disallow，命中 `/` 时 finding。
- title 长度建议 30–60 字符；description 50–160。
- audit_runs.summary 存各分类 finding 数量与总得分（0–100，扣分制）。
- raw_report_path：把抓到的 HTML 与解析结果存 `infra/data/audits/<auditId>.json`，DB 只记路径。

## 涉及文件

```
apps/worker/src/jobs/seo-audit.ts
apps/worker/src/jobs/seo-audit.test.ts
apps/worker/src/schedulers/seo-audit-scheduler.ts
packages/integrations/src/http/http-client.ts      # 通用 HTTP client（带超时/重试）
packages/services/src/audits/seo-rules.ts          # 规则集合
packages/services/src/audits/seo-rules.test.ts
packages/services/src/audits/audit-service.ts      # 通用：create run / record finding / score
packages/db/src/repositories/audit-repo.ts
apps/web/app/api/v1/sites/[id]/audits/route.ts
apps/web/app/api/v1/audits/[id]/route.ts
apps/web/app/api/v1/audits/[id]/findings/route.ts
apps/web/app/(dashboard)/sites/[id]/audits/page.tsx
apps/web/app/(dashboard)/sites/[id]/audits/[auditId]/page.tsx
apps/web/components/audits/AuditList.tsx
apps/web/components/audits/FindingsTable.tsx
apps/web/components/audits/SeverityBadge.tsx
```

## 验收标准

- [x] 对一个已知 SEO 优秀的站点跑：findings 数 < 3（`seo-rules.test.ts` “passes a complete page” 用例）
- [x] 故意构造缺 title 的页面 → 至少出现 `seo.missing_title` finding
- [x] sitemap.xml 不存在的站点 → 出现 `seo.sitemap_missing`
- [x] 单次 audit 完成时间 < 30s（fetch 超时 15s / 10s，首页 + 2× sitemap candidate 串行上限约 35s；实际公网站点 < 10s）
- [x] 规则单元测试覆盖：每条 finding code ≥ 1 个 case（`seo-rules.test.ts` 10 test）

## 备注

- HTML parser 用 `cheerio`，避免完整 jsdom。
- 后续可扩展深度抓取（broken links、orphan pages），单独任务。
