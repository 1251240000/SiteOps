# T60 — 命令面板（⌘K）+ Dashboard 首页自定义

- **里程碑**：M14
- **优先级**：P2
- **前置依赖**：T07
- **预估工时**：6 h
- **状态**：Todo

## 目标

两个独立但都属于"高频用户提速"的 UI 能力：

1. **命令面板（⌘K）**：全局 spotlight，搜索站点 / alerts / API key / task，回车直跳；
2. **首页自定义**：admin 可拖拽 KPI 卡，决定首页展示什么，配置持久化到 `user_preferences`。

## 范围

**包含**

### 命令面板

- 装 `cmdk`（已被 shadcn 推荐，零侵入）
- `apps/web/components/command-palette.tsx`：挂在 root layout 内，监听 `⌘K` / `Ctrl+K`
- 内置 commands：
  - **跳转**：所有站点（fuzzy 搜 sites.name）、所有 alert rules（rule name）、所有 api keys（key name）
  - **动作**：新建任务（开 T53 模态）、新建站点、新建 alert
  - **设置**：切换主题 / 切换语言 / 登出
- `/api/v1/search/global?q=...` 服务端聚合多类资源搜索

### 首页自定义

- 新表 `user_preferences (user_id PK, dashboard_layout JSONB, ...)`
- `/api/v1/me/preferences` GET / PATCH
- 首页 (`/`) 用拖拽布局（`@dnd-kit/core`），保存到 layout JSON
- 内置 5-8 个 KPI 卡：今日 alert / uptime / cwv / 最近部署 / agent runs / revenue / errors

**不包含**

- 命令面板 AI 补全（v2）
- 首页卡可自定义查询（仅内置 KPI）

## 设计要点

### 全局搜索

```ts
// services/src/search/search-service.ts
async function globalSearch(deps, q: string, limit = 5) {
  const [sites, alertRules, apiKeys, tasks] = await Promise.all([
    siteRepo.search(deps.db, q, limit),
    alertRuleRepo.search(deps.db, q, limit),
    apiKeyRepo.search(deps.db, q, limit),
    taskRepo.search(deps.db, q, limit),
  ]);
  return { sites, alertRules, apiKeys, tasks };
}
```

每个 repo 加 `.search(q, limit)` 用 `ilike '%q%'` —— 量级足够，无需引入全文检索。

### Command 注册

```tsx
<CommandDialog open={open} onOpenChange={setOpen}>
  <CommandInput placeholder="Search..." onValueChange={setQuery} />
  <CommandList>
    <CommandGroup heading="Sites">
      {data?.sites.map((s) => (
        <CommandItem key={s.id} onSelect={() => router.push(`/sites/${s.id}`)}>
          {s.name}
        </CommandItem>
      ))}
    </CommandGroup>
    <CommandGroup heading="Actions">
      <CommandItem onSelect={() => openNewTaskDialog()}>New Task</CommandItem>
      <CommandItem onSelect={() => openNewSiteDialog()}>New Site</CommandItem>
    </CommandGroup>
  </CommandList>
</CommandDialog>
```

### Dashboard layout JSON

```json
{
  "rows": [
    {
      "cards": [
        { "id": "uptime-summary", "size": 4 },
        { "id": "today-alerts", "size": 4 },
        { "id": "revenue-mtd", "size": 4 }
      ]
    },
    {
      "cards": [
        { "id": "recent-deployments", "size": 6 },
        { "id": "agent-runs-kpi", "size": 6 }
      ]
    }
  ]
}
```

每卡 id 对应注册表中的组件；用 `@dnd-kit/core` 拖拽排序。

## 涉及文件

```
packages/db/migrations/00XX_user_preferences.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/user-preferences.ts
packages/db/src/repositories/user-preference-repo.ts
packages/services/src/users/preference-service.ts
packages/services/src/search/search-service.ts
packages/db/src/repositories/site-repo.ts                  # add search()
packages/db/src/repositories/alert-rule-repo.ts             # add search()
packages/db/src/repositories/api-key-repo.ts                # add search()
packages/db/src/repositories/task-repo.ts                   # add search()
apps/web/app/api/v1/search/global/route.ts                   # 新
apps/web/app/api/v1/me/preferences/route.ts                  # GET/PATCH
apps/web/components/command-palette.tsx                       # 新
apps/web/components/dashboard-grid.tsx                        # 新
apps/web/components/dashboard-cards/*.tsx                     # 注册表
apps/web/app/(dashboard)/page.tsx                              # 渲染 dashboard-grid
apps/web/app/(dashboard)/layout.tsx                            # 挂载 CommandPalette
apps/web/package.json                                          # +cmdk +@dnd-kit/core
```

## 验收标准

- [ ] 任意页面 ⌘K 打开 spotlight；输入站点名 fuzzy 命中
- [ ] 选中后跳对应详情页
- [ ] action "New Task" 打开 T53 模态
- [ ] 首页拖拽 KPI 卡 → 刷新页保持顺序
- [ ] viewer 不能看到 "New Task" / "New Site" 动作
- [ ] 全部菜单项有键盘可达（无鼠标也能完成）
- [ ] `pnpm -r typecheck && lint && test` 全绿
