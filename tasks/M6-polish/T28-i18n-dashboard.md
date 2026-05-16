# T28 — Dashboard UI 国际化（zh-CN 默认 + en-US）

- **里程碑**：M6
- **优先级**：P2
- **前置依赖**：T07（dashboard 壳子），M1–M4 的所有 UI 组件
- **预估工时**：6h
- **状态**：Todo

## 目标

把 dashboard 的所有硬编码英文字符串抽到 message catalog，支持 **zh-CN（默认）** 与 **en-US** 双语切换。后端 API 错误码 / 错误 message 仍保持英文（机器消费），不在本任务范围。

## 范围

**包含**

- 引入 `next-intl@^3` 作为 i18n 运行时（与 Next.js 15 App Router + RSC 一等对接）
- middleware 链路：在已有的 NextAuth middleware 之外，加 locale 解析（cookie > `Accept-Language` > 默认 `zh-CN`）
- 提供商：`<NextIntlClientProvider messages={...}>` 挂在 `app/layout.tsx`，server 组件用 `getTranslations()`，client 组件用 `useTranslations()`
- 两份 catalog：`apps/web/messages/zh-CN.json` 与 `apps/web/messages/en-US.json`，按特性命名空间组织
- 全量重构 `apps/web/app/(auth)` + `apps/web/app/(dashboard)` + `apps/web/components/**` 下的硬编码英文字符串到 `t()` 调用
- 顶栏语言切换器（globe icon → 中文 / English），切换通过 `POST /api/v1/me/preferences/locale` 写 cookie + `router.refresh()`
- 单一非破坏性 API：`POST /api/v1/me/preferences/locale` 写 `siteops_locale` cookie；session 不变（locale 与登录解耦，未登录的 `/login` 也能切语言）
- 文档：`docs/02-tech-stack.md` 加一段 i18n；`docs/05-coding-standards.md` 补"新页面禁止硬编码 UI 字符串"

**不包含**

- API 错误 message 本地化（`AppError.message` 仍是英文，详见"设计要点 §3"）
- 邮件 / 飞书 / 钉钉等告警通道的文案 i18n（保留 v2）
- 站点详情按 `sites.target_language` 切换内容标签（独立另议；本任务只动 dashboard chrome）
- 服务器端日期 / 货币本地化（沿用 `Intl.DateTimeFormat` / `Intl.NumberFormat`，组件层按当前 locale 自动切换；不引入新依赖）
- 翻译记忆 / 自动化翻译流水线（catalog 由人工维护）
- RTL 布局支持（zh-CN 与 en-US 都是 LTR）

## 数据模型

不动 schema。locale 通过 cookie 持久化：

| 名称             | 类型        | 默认    | 备注                                               |
| ---------------- | ----------- | ------- | -------------------------------------------------- |
| `siteops_locale` | HTTP cookie | `zh-CN` | `Path=/; SameSite=Lax; HttpOnly=false; Max-Age=1y` |

为什么 **不存** `users.locale` 列：

- single-admin 项目，cookie 即是用户偏好
- 未登录时也能切语言（catalog 加载不依赖 session）
- 如果未来真的要"绑定到用户"，加列即可，cookie fallback 仍兼容

## API 响应 shape

```ts
// POST /api/v1/me/preferences/locale
type SetLocaleRequest = { locale: 'zh-CN' | 'en-US' };
type SetLocaleResponse = { data: { locale: 'zh-CN' | 'en-US' } }; // 同时 Set-Cookie: siteops_locale=...
```

错误：传入未知 locale → 400 `validation_failed`，沿用项目通用 envelope。

## 涉及文件

```
apps/web/package.json                                  # +next-intl
apps/web/i18n.ts                                       # next-intl getRequestConfig
apps/web/middleware.ts                                 # 链 locale 解析 + 已有 auth gate
apps/web/lib/i18n/locales.ts                           # SUPPORTED_LOCALES, DEFAULT_LOCALE, isLocale()
apps/web/lib/i18n/pick-locale.ts                       # cookie > header > default 的纯函数 + 单测
apps/web/lib/i18n/pick-locale.test.ts

apps/web/messages/zh-CN.json
apps/web/messages/en-US.json

apps/web/app/layout.tsx                                # 包 NextIntlClientProvider，传 messages + locale
apps/web/app/(auth)/login/login-form.tsx               # 字符串改 t()
apps/web/app/(dashboard)/**/*.tsx                      # 全量重构
apps/web/components/**/*.tsx                           # 全量重构

apps/web/components/layout/topbar.tsx                  # 加 LocaleSwitcher
apps/web/components/layout/locale-switcher.tsx         # 新组件：globe icon + dropdown
apps/web/app/api/v1/me/preferences/locale/route.ts     # POST 写 cookie

apps/web/e2e/login-and-create-site.spec.ts             # 用 i18n key 取代硬编码（或 force 'en-US' cookie 保持稳定）
apps/web/app/api/v1/me/preferences/__tests__/locale.test.ts

docs/02-tech-stack.md                                  # +i18n 段
docs/05-coding-standards.md                            # +硬编码字符串禁令
```

## 设计要点

### 1. middleware 链：locale 不能破坏现有 auth gate

`next-intl` 默认提供基于路由前缀的 middleware，但本任务**不**走 `[locale]/...` 段（避免对 M1–M4 已经稳定的 75+ 路由做大重构）。改用 cookie 驱动的纯解析中间件：

```ts
// apps/web/middleware.ts
import NextAuth from 'next-auth';
import { NextResponse, type NextRequest } from 'next/server';

import { authConfig } from './lib/auth.config';
import { pickLocale } from './lib/i18n/pick-locale';

const { auth: authMiddleware } = NextAuth(authConfig);

export default async function middleware(req: NextRequest) {
  // 1. let auth decide redirect/allow
  const res = (await authMiddleware(req as never)) as NextResponse | undefined;
  const out = res ?? NextResponse.next();

  // 2. ensure a locale cookie is set (never overrides an existing one)
  if (!req.cookies.get('siteops_locale')) {
    const locale = pickLocale({
      cookie: undefined,
      acceptLanguage: req.headers.get('accept-language'),
    });
    out.cookies.set('siteops_locale', locale, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return out;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|healthz|login).*)'],
};
```

注：`/login` 路径在 matcher 之外，但 `login-form.tsx` 仍会通过 `getRequestConfig` 拿到默认 locale —— 这就够了，未登录访问者一进 dashboard 就会被 set-cookie 一次。

### 2. catalog 命名约定

每个特性一个顶层 namespace；扁平 key 用 `.` 分隔；插值用 ICU MessageFormat（`next-intl` 默认支持）：

```jsonc
// messages/zh-CN.json
{
  "common": {
    "save": "保存",
    "cancel": "取消",
    "delete": "删除",
    "edit": "编辑",
    "loading": "加载中…",
    "errorRetry": "出错了，请重试",
    "rowsSelected": "{count, plural, =0 {未选中} other {已选 # 行}}",
  },
  "auth": {
    "signInTitle": "登录 siteops",
    "signInDescription": "单 admin 账号登录。种子用户见 .env.example。",
    "email": "邮箱",
    "password": "密码",
    "submit": "登录",
    "submitting": "登录中…",
  },
  "nav": {
    "dashboard": "概览",
    "sites": "站点",
    "deployments": "部署",
    "traffic": "流量",
    "revenue": "收入",
    "roi": "ROI",
    "agentRuns": "Agent 调用",
    "alerts": "告警",
    "integrations": "集成",
  },
  "sites": {
    "title": "站点",
    "description": "本控制台管理的所有站点登记。",
    "new": "新建站点",
    "filters": { "status": "状态", "siteType": "类型" },
    /* ... 见完整 catalog */
  },
}
```

en-US 同结构：

```jsonc
{
  "common": { "save": "Save", "cancel": "Cancel" /* ... */ },
  "auth": { "signInTitle": "Sign in to siteops" /* ... */ },
  "nav": { "dashboard": "Overview", "sites": "Sites" /* ... */ },
}
```

约定：

- 顶层 namespace 与功能模块一一对应（`auth`、`nav`、`sites`、`deployments`、`traffic`、`revenue`、`roi`、`alerts`、`integrations`、`agentRuns`、`common`）
- key 使用 lowerCamelCase；嵌套深度 ≤ 2 层（再深就拆 namespace）
- 缺失 key：`next-intl` 在 `NODE_ENV=production` 下静默回退到 key string，dev 抛错——所以 review PR 时漏翻必须补
- 数字 / 货币 / 日期一律不进 catalog，组件层用 `useFormatter()` 调 `Intl.*`

### 3. 为什么 API 错误 **不** i18n

按用户选择的范围，`AppError.message` 保持英文（machine-readable 优先）：

- code（如 `validation_failed`）已经是稳定的契约
- 前端在 `with-api.ts` 错误处理处把 code 映射到本地化文案：`messages.errors.validation_failed = "校验失败"`
- detail（zod 的 path/message）在前端按字段名查 catalog 即可

这层"前端把后端 code 翻成本地化文本"的映射放在 `lib/i18n/error-message.ts`，所有 toast / inline error 经此走。

### 4. 切语言体验

- 顶栏 `LocaleSwitcher`：globe 图标 + 当前语言文字（中 / EN），点击展开 dropdown 两个选项
- 选中后：
  ```ts
  await fetch('/api/v1/me/preferences/locale', {
    method: 'POST',
    body: JSON.stringify({ locale: 'en-US' }),
  });
  router.refresh(); // RSC 重新渲染，messages 重新加载
  ```
- 不刷新整页（preserve scroll / form state）；`next-intl` 的 server-side `getRequestConfig` 每次都会读 cookie，refresh 即生效

API 端：

```ts
// app/api/v1/me/preferences/locale/route.ts
export const POST = withApi(async (req) => {
  const body = setLocaleSchema.parse(await req.json());
  const res = ok({ locale: body.locale });
  res.cookies.set('siteops_locale', body.locale, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
});
```

注意：用 `withApi`（session-only）而非 `withAuth` —— locale 是 dashboard 偏好，无需暴露给 API key。未登录用户切语言走 `/api/public/locale`（如果需要）；当前 MVP 直接在 `/login` 页面用纯 client cookie 操作即可。

### 5. e2e 测试稳定性

`apps/web/e2e/login-and-create-site.spec.ts` 当前用 `getByText('Sites')` 之类硬匹配。语言切换后会失败。两条出路：

- **A**：playwright `beforeEach` 强制 set cookie `siteops_locale=en-US`，spec 仍然按英文断言
- **B**：spec 改用 `data-testid`，文案不再参与断言

选 **A**：改动小、可读性高；e2e 本来就是英文环境的 smoke。

### 6. 增量迁移策略

不一次性改完所有页面（这会让 PR 难审）：

1. 先落基础设施（middleware / provider / catalog 骨架 + 5 条 common key）→ 单独提交
2. 按页面顺序迁移：`/login` → 顶栏 + 侧栏 → `/sites` → `/deployments` → `/traffic` → `/revenue` → `/roi` → `/alerts` → `/integrations` → 其余
3. 每个页面一份 commit，便于 review；最后一个 commit 加"硬编码字符串禁令"的 ESLint 规则（用 `eslint-plugin-no-literal-string` 或自定义 AST 规则）打底，防回归

ESLint 规则可放后续 PR；本任务只要全部页面迁移完成即可。

## 验收标准

- [ ] `pnpm dev` 下默认渲染中文；浏览器 `Accept-Language: en` 且无 cookie → 自动渲染英文
- [ ] 顶栏切换语言后页面立即换文（不整页刷新），cookie `siteops_locale` 更新
- [ ] `/login`、`/sites`、`/sites/[id]`、`/sites/new`、`/traffic`、`/revenue`、`/roi`、`/alerts`、`/integrations`、`/agent-runs`（T26 完成后）所有 UI 文本均无英文残留（中文模式下）
- [ ] 表单 zod 错误用 catalog 里的本地化文案显示（不直接显示英文 zod message）
- [ ] `messages/zh-CN.json` 与 `messages/en-US.json` key 集合**完全一致**（CI 加一条比对脚本：`pnpm i18n:check`）
- [ ] `apps/web/lib/i18n/pick-locale.test.ts` 单测覆盖：cookie 优先、header 协商、未知 locale 回退默认、empty header
- [ ] e2e Playwright 套件强制 `en-US` cookie 后仍全绿
- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm format:check` 全绿

## 备注

- 选 `next-intl` 而不是 `i18next`：前者对 App Router + RSC 是头等公民，server 组件直接 `await getTranslations()` 就能拿到，不需要 `'use client'` 包装；后者在 RSC 下要走 `i18next-resources-to-backend` + 自家 hydrate，复杂度翻倍。
- 选 cookie + `localePrefix: 'never'` 而不是 `[locale]/...` 路由段：避免 75+ 现有路由文件的物理迁移；future 若要做 SEO 友好的 URL，再切到段式即可（`next-intl` 同一套 catalog 不需要重写）。
- 数字 / 货币：`useFormatter().number(v, { style: 'currency', currency: 'USD' })`；当 locale=zh-CN 时会输出 `US$ 1,234.56`，符合 Chrome / Firefox 默认 ICU 行为。如果 PM 想要"中国大陆习惯用 `¥`"再单独 override（非本任务范围）。
- "硬编码字符串禁令" ESLint 规则的实现示例：自定义 rule，遍历 JSXText / 字符串 prop（仅 `title` / `aria-label` / `placeholder` / `alt`），白名单纯标点 / 数字 / 单字英文（如 `OK` 这种通用缩写）。后续单独 PR 落地。
- catalog 文件量级估算（参考一个类似规模的内部工具）：每语言约 600–800 个 key，~30 KB。打包进 client bundle 不到 10 KB（gzip 后），可接受；后续若涨到 200 KB 再做按页 lazy import。
