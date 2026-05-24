# T35 — OpenAPI 生成 + Swagger UI + CI parity

- **里程碑**：M8
- **优先级**：P1
- **前置依赖**：T25, T27
- **预估工时**：8 h
- **状态**：Done

## 目标

从已有 Zod schema 自动派生 OpenAPI 3.1 spec，对外提供 `/api/v1/openapi.json`；dev 模式挂 Swagger UI 在 `/api/v1/docs`；CI 跑 spec parity check 防止代码漂移。

## 范围

**包含**

- 安装 `@asteasolutions/zod-to-openapi`
- 在 `packages/shared/src/schemas/*` 每个 schema 上加 `.openapi({ title, description })` 标注
- 新建 `apps/web/lib/openapi/registry.ts`：集中注册所有 route + schema
- 新增路由 `apps/web/app/api/v1/openapi.json/route.ts`
- 新增页面 `apps/web/app/api/v1/docs/page.tsx`（仅 dev / staging）
- CI 脚本 `pnpm openapi:check`：调用 generator 生成 spec → 与签出的 `docs/openapi.json` diff → 不一致 fail

**不包含**

- TypeScript client codegen（M12 - Agent SDK 会用同一份 spec 出 client）
- 路径级 RBAC / scope 在 OpenAPI 里的渲染（spec 标 `security: [{ bearerAuth: [scope] }]`，详细 UI 留 Swagger）

## 设计要点

### 注册形态

```ts
// apps/web/lib/openapi/registry.ts
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { createSiteSchema, siteSchema, listSitesQuerySchema } from '@siteops/shared';

const registry = new OpenAPIRegistry();

registry.registerPath({
  method: 'post',
  path: '/sites',
  tags: ['Sites'],
  security: [{ bearerAuth: ['sites:write'] }, { cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: createSiteSchema } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: siteSchema } } },
    400: {
      description: 'Validation failed',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
});

// ... 所有路由
export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'SiteOps API', version: '1.0.0' },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'authjs.session-token' },
      },
    },
  });
}
```

### Parity check

```bash
# package.json
"openapi:generate": "tsx scripts/openapi-generate.ts > docs/openapi.json",
"openapi:check": "tsx scripts/openapi-check.ts"
```

`openapi-check.ts`：调 `buildOpenApiDocument()` → JSON 比较 `docs/openapi.json` → 不等则报红、提示运行 `:generate`

### Swagger UI

- dev 用 `swagger-ui-react` 客户端组件渲染，spec 从 `/api/v1/openapi.json` 拉
- prod 路由直接 404（避免暴露内部细节）—— 用 `process.env.NODE_ENV !== 'production'` gate

## 涉及文件

```
packages/shared/src/schemas/**/*.ts             # 加 .openapi() 标注
apps/web/lib/openapi/registry.ts                # 新
apps/web/app/api/v1/openapi.json/route.ts       # 新
apps/web/app/api/v1/docs/page.tsx               # 新
apps/web/scripts/openapi-generate.ts            # 新
apps/web/scripts/openapi-check.ts               # 新
docs/openapi.json                                # 生成产物 commit
docs/04-api-spec.md                              # §7 状态从 "规划" → "已实现"
.github/workflows/ci.yml                         # 增加 openapi:check 步骤
```

## 验收标准

- [ ] `pnpm openapi:generate` 产生覆盖所有 v1 路由的 spec（覆盖率 ≥ 95%，至少 80 个路径）
- [ ] `curl /api/v1/openapi.json` 200 OK，spec 经 `swagger-cli validate` 通过
- [ ] dev 模式访问 `/api/v1/docs` 可看到 Swagger UI 渲染
- [ ] prod 模式访问 `/api/v1/docs` 返回 404
- [ ] CI 中 `pnpm openapi:check` 检测出 spec 漂移会 fail
- [ ] `pnpm -r typecheck && lint && test` 全绿
