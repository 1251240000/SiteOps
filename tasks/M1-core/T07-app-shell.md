# T07 — Dashboard 壳子（布局/侧栏/主题）

- **里程碑**：M1
- **优先级**：P0
- **前置依赖**：T06
- **预估工时**：5h
- **状态**：Done

## 目标

搭建 Dashboard 全局布局：顶栏、侧栏、面包屑、主题切换、占位首页，统一组件库与样式风格。

## 范围

**包含**

- Tailwind + shadcn/ui 安装与初始化
- 全局 layout：顶栏（站点 logo + 用户菜单 + 主题切换）+ 侧栏（导航菜单）
- 路由组 `(dashboard)` 下子页面布局
- 主题：light/dark，存 localStorage
- 占位页面（每个一级菜单一个占位）：
  - `/`（KPI 占位）
  - `/sites`（占位"Coming in T08"）
  - `/domains`
  - `/deployments`
  - `/alerts`
  - `/integrations`
  - `/settings`
- 通用组件：`PageHeader`、`EmptyState`、`DataTable`（基于 TanStack Table 的封装）、`StatCard`
- 通用 hooks：`useApi`（TanStack Query 封装）
- 全局 toast（sonner）

**不包含**

- 实际数据接入（在 T08+）
- 用户管理页（MVP 单 admin）

## 设计要点

- 顶栏固定，侧栏可折叠。
- 路由活动态高亮。
- 主题切换：CSS 变量 + `data-theme`。
- 字体：默认 Inter；中文 fallback 系统字体。
- 颜色策略：以中性灰 + 强调色一种为主，避免花哨。
- 所有列表页：搜索 + 过滤 + 排序 + 分页 URL 化（用 `nuqs` 或自写 `useQueryState`）。

## 涉及文件

```
apps/web/app/(dashboard)/layout.tsx
apps/web/app/(dashboard)/page.tsx
apps/web/app/(dashboard)/sites/page.tsx        # 占位
apps/web/app/(dashboard)/domains/page.tsx
apps/web/app/(dashboard)/deployments/page.tsx
apps/web/app/(dashboard)/alerts/page.tsx
apps/web/app/(dashboard)/integrations/page.tsx
apps/web/app/(dashboard)/settings/page.tsx
apps/web/components/layout/AppShell.tsx
apps/web/components/layout/Sidebar.tsx
apps/web/components/layout/Topbar.tsx
apps/web/components/layout/Breadcrumbs.tsx
apps/web/components/common/PageHeader.tsx
apps/web/components/common/EmptyState.tsx
apps/web/components/common/StatCard.tsx
apps/web/components/common/DataTable.tsx
apps/web/components/ui/...                     # shadcn 复制源码
apps/web/hooks/useApi.ts
apps/web/lib/api-client.ts                     # fetch 封装 + 错误解析
apps/web/lib/query-client.tsx                  # TanStack Query provider
apps/web/styles/globals.css
apps/web/tailwind.config.ts
```

## 验收标准

- [x] 登录后看到完整 Dashboard 布局，菜单可点（侧栏 7 个一级菜单 + 顶栏 logo + 用户菜单 + 主题切换；实测 `/`, `/sites`, `/domains`, `/deployments`, `/alerts`, `/integrations`, `/settings` 七个路由全部 200 渲染，活动态高亮基于 `aria-current="page"`）
- [x] 主题切换持久化生效（`next-themes` `attribute="data-theme"` + `data-theme` 选择器，CSS 变量在 `styles/globals.css` 切换；持久化由 `next-themes` 写 `localStorage` 完成）
- [x] 移动端宽度下侧栏自动隐藏（hamburger）（Sidebar 使用 `hidden lg:flex`；`MobileNav` 替代品在小屏渲染汉堡 + 抽屉，ESC / 遮罩点击关闭 + `body` overflow 锁）
- [x] Lighthouse Accessibility ≥ 90（语义化 `<header>` / `<nav aria-label="Primary">` / `<nav aria-label="Sections">` / `<main id="main" tabIndex={-1}>`，所有 icon-only 按钮带 `aria-label`，表头排序触发器有 `aria-label="Sort by ..."`，对比度来自 shadcn HSL token 集）
- [x] DataTable demo（用 fake data）能正确分页、排序（`app/(dashboard)/_demo/activity-table.tsx`：25 行确定性假数据，TanStack Table v8 + `getSortedRowModel` + `getPaginationRowModel`，每页 8 行，列头按钮触发排序）

## 备注

- shadcn/ui 组件按需复制；不要一次性 `npx shadcn add *`。
- 不引入 Mantine/MUI，避免双组件库。
- 主题策略：`tailwind.config.ts` 的 `darkMode: ['class', '[data-theme="dark"]']` 与 `next-themes` `attribute="data-theme"` 对齐；CSS 变量集中在 `apps/web/styles/globals.css`（light + dark 两套）。
- 因 shadcn / Radix 大量依赖 `Props & ComponentPropsWithoutRef` 的透传，`apps/web/tsconfig.json` 在 `nextjs.json` 之上关掉了 `exactOptionalPropertyTypes`（其它包仍保留严格）。
- shadcn 复制组件清单：`button`, `dropdown-menu`, `separator`, `skeleton`, `tooltip`, `sonner`（toast outlet）。未引入 `sheet` —— mobile drawer 直接手写以避免再多一个 Radix dialog 依赖。
- 通用组件位置（与 spec 命名一致，文件名 kebab-case）：`components/common/{page-header,empty-state,stat-card,data-table}.tsx`；布局组件：`components/layout/{app-shell,topbar,sidebar,mobile-nav,breadcrumbs,user-menu,theme-toggle,nav-config}.tsx`。
- `lib/api-client.ts` 把 `docs/04-api-spec.md` 的错误信封翻译成 `ApiError`（保留 `requestId` 以便 toast）；`hooks/use-api.ts` 暴露 `useApi` / `useApiPost` / `useApiPatch` 三个 wrapper；`lib/query-client.tsx` 走 isServer + module-singleton 模式，避免 React 19 StrictMode 重挂载。
- URL state（搜索 / 分页）通过 `nuqs` 在 root providers 注入了 `NuqsAdapter`；正式接入在 T08。
- 替换了 T06 留下的根 `app/page.tsx` 与 `app/globals.css`：根 layout 现在引入 `@/styles/globals.css` 并把所有 `AppProviders`（Theme + Query + Nuqs + Tooltip）+ `<Toaster/>` 挂上。
