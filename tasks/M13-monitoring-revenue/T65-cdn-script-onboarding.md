# T65 — CDN Script 接入与埋点配置片段

- **里程碑**：M13
- **优先级**：P2
- **前置依赖**：T64
- **预估工时**：4 h
- **状态**：Done

## 目标

把 T64 已完成的 `@siteops/tracker` npm SDK 补齐为“站点复制一段 `<script>` 即可接入”的低门槛方案：平台提供 browser/IIFE bundle、静态分发入口、`data-site-key` 自动初始化，以及站点设置页的一键复制接入代码。

## 范围

**包含**

- 为 `@siteops/tracker` 增加 browser/IIFE 构建产物，例如 `dist/siteops-tracker.iife.js`
- 新增 bootstrap 入口，自动读取当前 `<script>` 标签上的 `data-*` 配置
- 支持最小接入片段：
  ```html
  <script async src="https://ops.example.com/tracker.js" data-site-key="site_pk_xxx"></script>
  ```
- `data-site-key` 使用 `sites.public_analytics_key`，不暴露内部 `sites.id`
- `data-endpoint` 可选；默认根据 `script.src` 推导到同源 `/api/v1/collect`
- 支持常用可选配置：`data-auto-pageview`、`data-sample-rate`、`data-debug`
- Web 侧提供 `/tracker.js` 静态分发或 rewrite 到构建产物，并设置长期缓存头
- 站点设置页展示 public analytics key、CDN script 代码片段、复制按钮和接入说明
- 增加基础测试：bootstrap 读取 dataset、endpoint 默认推导、缺少 site key 时不发送事件

**不包含**

- npm 包发布到公开 registry（仍可作为 monorepo private package）
- 第三方 CDN 发布流程（先由 SiteOps Web 自己托管 `/tracker.js`）
- 可视化埋点配置、热力图、录屏、自动点击采集
- 更复杂的 SPA framework adapter（React/Next/Vue 插件后续再做）

## 设计要点

### Script 配置约定

推荐平台生成的接入片段：

```html
<script async src="https://ops.example.com/tracker.js" data-site-key="site_pk_xxx"></script>
```

高级配置：

```html
<script
  async
  src="https://ops.example.com/tracker.js"
  data-site-key="site_pk_xxx"
  data-endpoint="https://ops.example.com/api/v1/collect"
  data-auto-pageview="true"
  data-sample-rate="1"
  data-debug="false"
></script>
```

- `data-site-key` 必填，来自 `sites.public_analytics_key`
- `data-endpoint` 可选，缺省为 `new URL('/api/v1/collect', script.src).toString()`
- `data-auto-pageview` 默认 `true`
- `data-sample-rate` 默认 `1`，非法值回退为 `1`
- `data-debug` 默认 `false`

### Bootstrap 入口

```ts
// packages/tracker/src/browser.ts
import { createTracker } from './index.js';

function boolAttr(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function numberAttr(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

export function bootFromScript(
  script: HTMLScriptElement | null = document.currentScript as HTMLScriptElement | null,
) {
  const siteKey = script?.dataset.siteKey;
  if (!siteKey) {
    console.warn('[siteops-tracker] missing data-site-key');
    return null;
  }

  const endpoint = script.dataset.endpoint ?? new URL('/api/v1/collect', script.src).toString();
  return createTracker({
    siteKey,
    endpoint,
    autoPageview: boolAttr(script.dataset.autoPageview, true),
    sampleRate: numberAttr(script.dataset.sampleRate, 1),
    debug: boolAttr(script.dataset.debug, false),
  });
}

const tracker = bootFromScript();
if (tracker) {
  window.SiteOpsTracker = tracker;
}
```

### 类型声明

```ts
declare global {
  interface Window {
    SiteOpsTracker?: import('./index.js').Tracker;
  }
}
```

这样站点可以在后续自定义事件中使用：

```html
<script>
  window.SiteOpsTracker?.track('cta_click', { location: 'hero' });
</script>
```

### 构建与分发

- `packages/tracker` 增加 browser build 脚本，可用 `tsup` / `vite` / `rollup`
- 输出 IIFE，global 名称为 `SiteOpsTracker`
- `apps/web/public/tracker.js` 可在 build 后复制生成，或 `apps/web/app/tracker.js/route.ts` 读取 tracker dist 后返回
- 建议响应头：
  - `content-type: application/javascript; charset=utf-8`
  - `cache-control: public, max-age=86400, stale-while-revalidate=604800`

### 设置页接入卡片

在站点设置页增加“前端埋点接入”卡片：

- 显示 `publicAnalyticsKey`
- 展示 script 片段
- “复制代码”按钮
- 提醒：`primaryUrl` 必须配置为站点真实根域，否则 collect POST 会被 origin 校验拒绝
- 提醒：自定义事件不要传 email / phone / token / password 等 PII 字段

## 涉及文件

```
packages/tracker/package.json                         # 新增 build:browser / 依赖
packages/tracker/src/browser.ts                       # 新增 script bootstrap
packages/tracker/src/browser.test.ts                  # dataset / endpoint / missing key 测试
packages/tracker/src/index.ts                         # 导出 Tracker 类型；必要时补 window 类型
packages/tracker/vite.config.ts 或 tsup.config.ts     # IIFE 构建配置
apps/web/app/tracker.js/route.ts                      # 分发 tracker.js（或 public/tracker.js）
apps/web/components/sites/analytics-install-card.tsx  # 新增接入说明 + 复制按钮
apps/web/components/sites/site-form.tsx               # 设置页挂载接入卡片
apps/web/lib/public-url.ts                            # 如需要，集中生成外部 base URL
packages/shared/src/schemas/sites.ts                  # 如 API 类型缺 publicAnalyticsKey，补导出/序列化
```

## 验收标准

- [ ] 站点复制 `<script async src=".../tracker.js" data-site-key="site_pk_xxx"></script>` 后，无需 npm install 即可自动上报 pageview
- [ ] 默认 endpoint 能从 `script.src` 推导为同源 `/api/v1/collect`
- [ ] `data-endpoint` 可覆盖默认 collect 地址
- [ ] `window.SiteOpsTracker.track('cta_click')` 能写入 `analytics_events`
- [ ] 缺少 `data-site-key` 时不发送请求，并在 debug/console 中给出可诊断提示
- [ ] 站点设置页可复制正确的 script 片段，片段使用 `publicAnalyticsKey` 而不是内部 `site.id`
- [ ] `/tracker.js` 返回 JavaScript 且带合理缓存头
- [ ] 单测覆盖 bootstrap 配置解析；`pnpm -r typecheck && lint && test` 全绿
