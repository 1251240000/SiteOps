# T36 — Cursor 分页迁移（高频长表）

- **里程碑**：M8
- **优先级**：P1
- **前置依赖**：T11, T26
- **预估工时**：8 h
- **状态**：Done

## 目标

把 `agent_runs`、`webhook_events`、`uptime_checks`、`errors` 四个高频追加表的列表 API 从 offset 分页迁移到 keyset cursor 分页；保留 `page` 参数兼容旧调用 1 个版本周期。

## 范围

**包含**

- 新 helper：`packages/shared/src/utils/cursor.ts` —— base64url 编码/解码 `{ id, ts }` 对
- Repository 改造：4 张表的 `list` 方法支持 `cursor` 参数；返回 `{ items, nextCursor }`
- 路由改造：4 个对应 GET 端点接受 `?cursor=...&limit=...`；同时旧 `?page=...&limit=...` 继续工作
- `meta` 形态升级：`{ cursor: { next?: string, prev?: string }, hasMore: boolean }` —— prev 由前端缓存历史 cursor 实现，本任务只出 `next`
- React Query 端：相关 `lib/queries/*.ts` 用 `useInfiniteQuery`

**不包含**

- 其他低频表（sites、domains、deployments 等）—— 量级 < 10k，offset 仍可接受，留作 v2 全量统一
- prev cursor 服务端实现（前端栈式维护即可）

## 设计要点

### Cursor 编码

```ts
// packages/shared/src/utils/cursor.ts
export type Cursor = { id: string; ts: string }; // ts 为 ISO

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(s: string): Cursor | null {
  try {
    const c = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (typeof c.id !== 'string' || typeof c.ts !== 'string') return null;
    return c;
  } catch {
    return null;
  }
}
```

### Repo SQL 模式

```ts
async function list(db: Db, opts: { cursor?: string; limit: number; ...filters }) {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const where = and(
    /* filters */,
    cursor ? or(
      lt(table.createdAt, new Date(cursor.ts)),
      and(eq(table.createdAt, new Date(cursor.ts)), lt(table.id, cursor.id)),
    ) : undefined,
  );
  const rows = await db.select().from(table)
    .where(where)
    .orderBy(desc(table.createdAt), desc(table.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor({ id: last.id, ts: last.createdAt.toISOString() })
    : null;
  return { items, nextCursor, hasMore };
}
```

### 向下兼容

- 路由侧：query 同时含 `cursor` 与 `page` 时 `cursor` 优先；否则走旧 offset
- 响应 envelope 兼容：旧 `meta: { page, total, totalPages }` 仍提供，新增 `meta.cursor`

## 涉及文件

```
packages/shared/src/utils/cursor.ts                    # 新
packages/shared/src/utils/__tests__/cursor.test.ts     # 新
packages/db/src/repositories/agent-run-repo.ts         # 改 list
packages/db/src/repositories/webhook-event-repo.ts     # 改
packages/db/src/repositories/uptime-repo.ts            # 改
packages/db/src/repositories/error-repo.ts             # 改
packages/db/src/repositories/__tests__/*.test.ts       # 增 cursor 用例
apps/web/app/api/v1/agent-runs/route.ts                # 改 query schema
apps/web/app/api/v1/hooks/route.ts                     # webhook-events 列表
apps/web/app/api/v1/sites/[id]/uptime/route.ts         # uptime
apps/web/app/api/v1/errors/route.ts                    # errors
apps/web/lib/queries/cursor.ts                         # 新 — useInfiniteQuery 适配器
apps/web/lib/queries/__tests__/cursor.test.ts          # 新 — 12 用例
apps/web/components/common/load-more-footer.tsx       # 新 — 公用 Load More 组件
apps/web/components/agent-runs/AgentRunsTable.tsx     # 改用 useInfiniteQuery
apps/web/components/webhooks/WebhooksTable.tsx        # 改用 useInfiniteQuery
apps/web/components/errors/ErrorList.tsx              # 改用 useInfiniteQuery
apps/web/messages/{en-US,zh-CN}.json                  # +4 键 (loadMore / loadingMore / endOfResults / showingCount)
docs/04-api-spec.md                                    # 标注 cursor 端点
```

## 验收标准

- [x] 旧 `?page=1&limit=20` 请求仍 200 且返回相同结构（offset envelope 还顺带返回新的 `cursor.next` / `hasMore` 用于平滑切换）
- [x] 新 `?cursor=...&limit=20` 返回 `meta.cursor.next` + `hasMore` + `limit`
- [x] 用 next cursor 翻多页，无重复、无遗漏（含"翻页期间有新数据插入"用例：见 `packages/db/src/repositories/__tests__/agent-run-repo.test.ts` 的 `does not skip rows inserted at the head mid-walk` 测试）
- [x] React Query 端切换到 `useInfiniteQuery`：dashboard 三个高频列表（agent-runs / webhooks / errors）全部走 cursor + Load More；新增 `apps/web/lib/queries/cursor.ts` helper + 12 用例，新增共用 `<LoadMoreFooter />` 组件
- [x] vitest 单测覆盖 cursor encode/decode 异常输入（base64 错码、缺字段、bad ts）—— `packages/shared/src/utils/cursor.test.ts` 15 用例
- [ ] EXPLAIN ANALYZE 显示 keyset 走 index scan，不再 sort + offset（PGlite 不支持 EXPLAIN ANALYZE；现有索引 `webhook_events_provider_created_idx` / `uptime_checks_site_checked_idx` / `errors_site_last_seen_idx` 与 cursor 的 `ORDER BY` 列匹配，生产 Postgres 会自动选用）
- [x] `pnpm -r typecheck && lint && test` 全绿（shared 95、db 149、services 229、web 182、worker 14、integrations 54 = 723 测试全绿）

## 实现备注

- Cursor 编码：`packages/shared/src/utils/cursor.ts` 导出 `Cursor` 类型、`encodeCursor`、`decodeCursor`、`clampLimit`，全部通过 `@siteops/shared` re-export。
- Repo 改造：四张表的 `list` 方法（uptime 走新增的 `listCursor`）共享同一套 keyset 模式：`WHERE (ts < cursor.ts) OR (ts = cursor.ts AND id < cursor.id)` + `ORDER BY ts DESC, id DESC` + `LIMIT n+1` 以免再发一次 `COUNT(*)`。
- Bigint id：`uptime_checks.id` 是 `bigserial`，cursor 内编码为 `String(id)`，repo 端 `BigInt(cursor.id)` 再传给 drizzle。
- 路由层：四个 GET 端点都在 `apps/web/app/api/v1/...` 下，按是否带 `?cursor=` 切 envelope；offset 模式新增 `cursor.next` + `hasMore` 字段，方便从 page 1 起切到 cursor。
- OpenAPI：`apps/web/lib/openapi/common.ts` 的 `cursorPaginationMeta` 升级到 `{ cursor: { next }, hasMore, limit }`；四个端点声明 `meta` 为 offset/cursor `union`，`pnpm openapi:check` 通过。
- React Query 前端切换：`apps/web/lib/queries/cursor.ts` 提供 `getNextCursorParam` / `flattenCursorPages` / `INITIAL_CURSOR` 三件套；`apps/web/components/common/load-more-footer.tsx` 是新的统一加载更多组件，i18n 新增 `common.pagination.loadMore` / `loadingMore` / `endOfResults` / `showingCount` 四键（zh-CN + en-US 同步，`pnpm i18n:check` 通过）。
- 三处 UI 切换：`AgentRunsTable` / `WebhooksTable` / `ErrorList` 全部改用 `useInfiniteQuery`；URL 里的 `?page=` 已删除，cursor 由内存维护，filter 改变时 query key 变化自动重置游走。第一页请求不带 `?cursor=` → 服务端返回 offset envelope 顺带 `cursor.next` 作为引导，后续页直接 keyset，对用户视觉无感。
- Uptime UI 不在本轮范围：`/sites/[id]/uptime` 是 server-rendered 聚合页（summary + 图表 + 最近 10 条失败），dashboard 不存在 client 端长列表；`/api/v1/sites/[id]/uptime?cursor=` 仍保留为外部 automation 用的 tail-list 模式，由 SDK / agent 直接消费。
