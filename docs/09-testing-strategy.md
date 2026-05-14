# 09 · 测试策略

## 1. 金字塔（MVP）

```
   E2E (Playwright)       ~5%   关键用户流
   集成 (Vitest + DB)     ~25%  service + repo
   单元 (Vitest)          ~70%  纯函数、schema、utils
```

不追求覆盖率数字，**追求"改坏会被发现"**。

## 2. 框架与工具

| 工具                   | 用途                        |
| ---------------------- | --------------------------- |
| Vitest                 | 单元 + 集成                 |
| @testing-library/react | React 组件                  |
| msw                    | 拦截 fetch，mock 外部 API   |
| Playwright             | E2E                         |
| Testcontainers（可选） | 集成测试拉起一次性 PG/Redis |
| supertest 或 fetch     | API 集成                    |

## 3. 命名与位置

- 单元/集成测试：`foo.ts` ↔ `foo.test.ts` 同目录。
- E2E：`apps/web/e2e/*.spec.ts`。
- 测试数据：`__fixtures__/` 文件夹，JSON 或 ts 工厂函数。

## 4. 数据库测试

- 集成测试用真实 PG。
- 每次 test suite 之前 `migrate + truncate all tables`。
- 不允许 `mock drizzle`；要么真连库，要么测纯函数。
- 用 `setupFile` 启动 testcontainers 或要求 `pnpm test:integration` 前已 docker compose up。

## 5. 外部 API

- 单元：用 `msw` 拦截。
- 集成（M3 任务）：录制一份真实响应放 `__fixtures__/`，msw 回放。
- 严禁测试调真实外部 API（除非显式 `pnpm test:live`）。

## 6. E2E 范围（MVP 全绿才能发版）

1. 登录 → 主页 KPI 渲染
2. 创建站点 → 列表显示 → 详情可看
3. 触发即时 uptime → 在站点详情看到一条新检查
4. 创建 alert rule → 模拟失败 → 看到 alert
5. 创建 API key → 用 curl 模拟 Agent 调用 `POST /deployments`

## 7. 性能/负载

MVP 不做正式性能测试。新增"100 站点 5 分钟 uptime 不堆积"的烟雾测试即可：

```bash
pnpm tsx scripts/smoke-uptime-load.ts
```

## 8. CI 中的测试矩阵

| Stage       | 命令                    | 必须通过                     |
| ----------- | ----------------------- | ---------------------------- |
| lint        | `pnpm lint`             | ✅                           |
| typecheck   | `pnpm typecheck`        | ✅                           |
| unit        | `pnpm test --run`       | ✅                           |
| integration | `pnpm test:integration` | ✅                           |
| build       | `pnpm build`            | ✅                           |
| e2e（夜跑） | `pnpm test:e2e`         | 失败不阻 merge，但要登 issue |

## 9. 缺陷修复必须先写复现

修 bug 时：

1. 先写一个失败的测试（红）
2. 改代码（绿）
3. 提 PR 时两份变更一起

## 10. 测试反模式（禁止）

- 测试里读 `process.env`（用 fixture 注入）
- 测试里 sleep（用 fake timers）
- 测试名 `should work`（要写具体行为：`creates site and emits seo-audit job`）
- 一个测试断言多个不相关的事
