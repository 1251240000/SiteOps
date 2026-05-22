# T33 — 安全响应头（HSTS / CSP / XFO）

- **里程碑**：M7
- **优先级**：P0
- **前置依赖**：T02
- **预估工时**：4 h
- **状态**：Done

## 目标

为 dashboard 与 API 注入业界基线安全响应头，降低 clickjacking、MIME sniffing、TLS 降级、未授信内联脚本等被动攻击面。

## 范围

**包含**

- Caddyfile 在 `siteops_upstream` snippet 注入：HSTS、X-Content-Type-Options、X-Frame-Options、Referrer-Policy、Permissions-Policy
- Next.js `middleware.ts` 内对非 API 请求注入 CSP（API 路由 JSON 不需要 CSP）
- 区分 dev / prod：dev 关闭 HSTS（避免 localhost cache 麻烦），CSP 用 report-only

**不包含**

- 全站 CORS 收紧（API 已经是 same-origin，无 CORS；外部 Agent 不通过浏览器，不需要 CORS）
- Subresource Integrity 在 Next 资产上自动加（Next 15 默认）
- WAF / DDoS 上游（基础设施层级，留运维决策）

## 设计要点

### Caddyfile snippet

```caddy
(siteops_upstream) {
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        -Server
    }
    # ... 现有 reverse_proxy
}
```

### Next CSP 注入（dashboard）

```ts
// middleware.ts 已存在 → 增加 CSP header
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // Next chunk 仍需 inline; 后续可改用 nonce
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const isProd = process.env.NODE_ENV === 'production';
res.headers.set(isProd ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', csp);
```

- 不在 API 路由打 CSP（Content-Type: application/json 浏览器不会执行）
- nonce-based CSP 留作下一步加固（需要改 layout `<script>` 走 nonce attr）

## 涉及文件

```
infra/caddy/Caddyfile                              # 新增 header 块
apps/web/middleware.ts                              # 增加 CSP 注入
apps/web/lib/__tests__/security-headers.test.ts    # mock NextRequest + 验证 header
docs/04-api-spec.md                                 # 新增 §8 安全响应头说明
```

## 验收标准

- [x] `curl -I https://host/` 返回全部 6 个安全头
- [x] `curl -I https://host/api/v1/sites` 不返回 CSP（仅响应头）
- [x] dev mode 报头为 `Content-Security-Policy-Report-Only`，prod 为 `Content-Security-Policy`
- [x] 单测：mock req + verify headers
- [x] e2e 检查 dashboard 关键页面无 CSP 违规（Playwright `page.on('pageerror')` & console error）
- [x] `pnpm -r typecheck && lint && test` 全绿

## 备注

- HSTS 只放 Caddy：它是 TLS 专有，走 plain HTTP 是 noise。Next 侧不重复设置，避免与代理层拼接冲突。
- middleware matcher 本轮把 `/login` 重新纳入（原本被 `(?!login)` 排除）。原因：/login 也是 HTML，需要同样的 CSP / X-Frame-Options。页面本身在 `app/(auth)/login/page.tsx` 里手动 redirect 已登录用户，不依赖 middleware 跳转，所以这一调整不会改变认证语义。
- CSP 仍保留 `'unsafe-inline'`：Next 15 的 inline bootstrap + Tailwind / next-themes 运行时 inline style 还依赖这项。Nonce-based CSP 是下一轮加固点（需改 `app/layout.tsx` 让所有 `<script>` / `<style>` 走 nonce），文档 §8.1 已标注。
- e2e 那个 `securitypolicyviolation` 监听在 dev `Report-Only` 模式下也会被触发，可以在重构引入新 inline 脚本时立即报错；仅在 `pnpm test:e2e` 路径跑起来，平常的 `pnpm test` 不会跑到。
