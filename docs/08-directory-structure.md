# 08 · 目录结构约定

## 1. 顶层布局

```
siteops/
├── apps/
│   ├── web/                    # Next.js 15 (App Router) — UI + API
│   └── worker/                 # BullMQ scheduler + processors
├── packages/
│   ├── db/                     # Drizzle schema, migrations, repositories
│   ├── services/               # 业务逻辑层
│   ├── integrations/           # 外部 API 客户端（CF/GH/GA/GSC/AdSense）
│   ├── shared/                 # Zod schemas, types, utils, constants
│   ├── config-eslint/          # 共享 ESLint config
│   └── config-typescript/      # 共享 tsconfig 基类
├── infra/
│   ├── docker-compose.dev.yml  # dev 依赖（pg+redis）
│   ├── docker-compose.yml      # 生产部署（pg+redis+web+worker+caddy）
│   ├── Dockerfile.web
│   ├── Dockerfile.worker
│   └── caddy/Caddyfile
├── docs/                       # 规划文档（本目录）
├── tasks/                      # 任务拆分文档
├── scripts/                    # 一次性脚本
├── .github/workflows/          # CI
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
└── README.md
```

## 2. `apps/web` 子结构

```
apps/web/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── layout.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx          # 含侧边栏、顶部 bar
│   │   ├── page.tsx            # 首页 KPI
│   │   ├── sites/
│   │   │   ├── page.tsx        # 列表
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       ├── audits/page.tsx
│   │   │       ├── uptime/page.tsx
│   │   │       └── settings/page.tsx
│   │   ├── domains/page.tsx
│   │   ├── deployments/page.tsx
│   │   ├── alerts/page.tsx
│   │   ├── integrations/page.tsx
│   │   └── settings/page.tsx
│   ├── api/
│   │   └── v1/
│   │       ├── sites/route.ts
│   │       ├── sites/[id]/route.ts
│   │       ├── auth/[...nextauth]/route.ts
│   │       └── ...
│   ├── layout.tsx              # 全局根布局
│   └── error.tsx
├── components/
│   ├── ui/                     # shadcn/ui 复制源码
│   ├── sites/                  # 业务组件
│   ├── charts/
│   └── layout/
├── lib/
│   ├── auth.ts                 # Auth.js 配置
│   ├── api-client.ts           # 浏览器端 fetch 封装
│   ├── with-api.ts             # Route Handler 包装器
│   └── env.ts                  # 环境变量 Zod 校验
├── hooks/
├── styles/
│   └── globals.css
├── public/
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## 3. `apps/worker` 子结构

```
apps/worker/
├── src/
│   ├── index.ts                # 入口：注册 schedulers + processors
│   ├── queues.ts               # BullMQ Queue 实例
│   ├── jobs/
│   │   ├── uptime-check.ts
│   │   ├── seo-audit.ts
│   │   ├── lighthouse-run.ts
│   │   ├── ssl-domain-expiry.ts
│   │   ├── analytics-sync.ts
│   │   ├── search-console-sync.ts
│   │   ├── adsense-sync.ts
│   │   ├── alert-fire.ts
│   │   └── housekeeping.ts
│   ├── schedulers/
│   │   └── index.ts            # 注册 repeatable jobs
│   ├── lib/
│   │   ├── logger.ts
│   │   └── shutdown.ts
│   └── env.ts
├── tsconfig.json
└── package.json
```

## 4. `packages/db`

```
packages/db/
├── src/
│   ├── schema/
│   │   ├── index.ts            # re-export
│   │   ├── users.ts
│   │   ├── api-keys.ts
│   │   ├── sites.ts
│   │   ├── domains.ts
│   │   ├── deployments.ts
│   │   ├── uptime-checks.ts
│   │   ├── audits.ts
│   │   ├── metrics.ts
│   │   ├── errors.ts
│   │   ├── alerts.ts
│   │   └── jobs-log.ts
│   ├── repositories/
│   │   ├── site-repo.ts
│   │   ├── domain-repo.ts
│   │   └── ...
│   ├── client.ts               # drizzle 实例工厂
│   ├── seed.ts                 # admin 用户种子
│   └── index.ts
├── migrations/                 # drizzle-kit 输出
├── drizzle.config.ts
├── tsconfig.json
└── package.json
```

## 5. `packages/services`

```
packages/services/
├── src/
│   ├── sites/
│   │   ├── site-service.ts
│   │   └── site-service.test.ts
│   ├── domains/
│   ├── deployments/
│   ├── audits/
│   ├── alerts/
│   ├── metrics/
│   ├── errors.ts               # AppError 等
│   └── index.ts
├── tsconfig.json
└── package.json
```

## 6. `packages/integrations`

```
packages/integrations/
├── src/
│   ├── http/                   # 通用 HTTP 客户端（重试、限流）
│   ├── cloudflare/
│   │   ├── client.ts
│   │   ├── pages.ts
│   │   └── types.ts
│   ├── github/
│   ├── ga4/
│   ├── search-console/
│   ├── adsense/
│   ├── lighthouse/
│   └── index.ts
├── tsconfig.json
└── package.json
```

## 7. `packages/shared`

```
packages/shared/
├── src/
│   ├── schemas/                # Zod schema (DTO/请求/响应)
│   ├── types/
│   ├── constants.ts
│   ├── utils/                  # 纯函数
│   └── index.ts
├── tsconfig.json
└── package.json
```

## 8. 包命名

| 包                | 名称                         |
| ----------------- | ---------------------------- |
| db                | `@siteops/db`                |
| services          | `@siteops/services`          |
| integrations      | `@siteops/integrations`      |
| shared            | `@siteops/shared`            |
| config-eslint     | `@siteops/eslint-config`     |
| config-typescript | `@siteops/tsconfig`          |
| web               | `@siteops/web`（private）    |
| worker            | `@siteops/worker`（private） |

## 9. 导入路径

- 跨包：`import { siteRepo } from '@siteops/db';`
- 包内：相对路径，例 `../schema/sites`
- 严禁 `apps/web` 直接 import `apps/worker` 或反过来；通信走队列或 API。

## 10. 文件创建顺序原则

> 任务文档里的"涉及文件路径"按以下原则写：

1. **底层 → 上层**：schema → repository → service → API/UI。
2. **同任务尽量内聚一个文件夹**。
3. **不预先创建空目录**。新文件夹随首个文件一起出现。
