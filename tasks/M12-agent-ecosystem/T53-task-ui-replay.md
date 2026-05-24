# T53 — Task 录入 / 重放 / 批量操作 UI

- **里程碑**：M12
- **优先级**：P2
- **前置依赖**：T25
- **预估工时**：6 h
- **状态**：Todo

## 目标

dashboard 内提供 admin / operator 友好的 task 入口：① 新建任务模态（kind autocomplete + payload JSON 编辑器 + dry-run）；② 单条 task replay；③ 多条 task 批量 cancel / reprioritize。

## 范围

**包含**

- UI：`/(dashboard)/tasks` 列表页加 "新建任务" 按钮 + 行级 actions（replay、cancel、改优先级）
- 模态组件：`<NewTaskDialog />`
  - kind autocomplete（来自 `KNOWN_TASK_KINDS` 常量）
  - payload JSON 编辑器（monaco-editor 或 react-json-view）
  - dry-run 开关（开启时调 `POST /tasks?dryRun=true`，服务端校验 + 返回 normalized payload 但不入库）
  - 可选字段：siteId、priority、maxAttempts、dedupeKey、availableAt（datetime picker）
- 路由扩展：
  - `POST /api/v1/tasks?dryRun=true`：仅 Zod 校验 + 入库前 dryRun 返回
  - `POST /api/v1/tasks/{id}/replay`：以同 kind/payload 重入队（新 dedupeKey）
  - `POST /api/v1/tasks/bulk-patch`：批量 PATCH（接受 `{ ids[], patch: { status?: 'cancelled', priority? } }`）
- 行级按钮 → 调对应 API + React Query invalidate
- 权限：admin / operator 可写；viewer 仅看

**不包含**

- DAG 可视化编辑（留 v2）
- payload schema 校验（kind 维度的 schema 注册）—— 自由 JSON

## 设计要点

### Dry-run 实现

```ts
// route.ts POST /tasks
const dryRun = new URL(req.url).searchParams.get('dryRun') === 'true';
const parsed = createTaskSchema.safeParse(body);
if (!parsed.success) throw new AppError(...);
if (dryRun) {
  return ok({ ...parsed.data, _dryRun: true }, { status: 200 });
}
// 否则正常 enqueue
```

### Replay

```ts
// POST /tasks/{id}/replay
const orig = await taskRepo.getById(db, id);
if (!orig) throw new AppError('not_found', 404);
const { task } = await taskService.enqueue(deps, {
  kind: orig.kind,
  siteId: orig.siteId,
  payload: orig.payload,
  priority: orig.priority,
  maxAttempts: orig.maxAttempts,
  // 故意不复用 dedupeKey，让它能再次入队
});
return ok(task, { status: 201 });
```

### Bulk patch

```ts
// POST /tasks/bulk-patch
const { ids, patch } = bulkPatchSchema.parse(body);
const results = await Promise.all(
  ids.map((id) => taskService.patch(deps, id, patch).catch((err) => ({ id, error: err.message }))),
);
return ok({
  updated: results.filter((r) => !('error' in r)).length,
  errors: results.filter((r) => 'error' in r),
});
```

### UI 细节

- payload 编辑器默认 `{}`，提供示例按钮按 kind 切换
- dry-run 成功后下方显示 "Server 接收的 normalized 结果"，admin 二次确认再 submit 真正入队
- 行级 actions 用 dropdown menu（避免拥挤）；危险动作（cancel）二次确认

## 涉及文件

```
apps/web/app/(dashboard)/tasks/page.tsx                       # 加按钮 + table actions
apps/web/app/(dashboard)/tasks/_components/new-task-dialog.tsx
apps/web/app/(dashboard)/tasks/_components/task-actions-menu.tsx
apps/web/app/(dashboard)/tasks/_components/payload-editor.tsx  # monaco wrapper
apps/web/app/api/v1/tasks/route.ts                              # +dryRun
apps/web/app/api/v1/tasks/[id]/replay/route.ts                  # 新
apps/web/app/api/v1/tasks/bulk-patch/route.ts                   # 新
apps/web/lib/queries/tasks.ts                                    # 加 mutation hooks
packages/shared/src/schemas/tasks.ts                             # bulkPatchSchema
apps/web/package.json                                            # +@monaco-editor/react
apps/web/e2e/tasks-new-replay.spec.ts                             # e2e
```

## 验收标准

- [ ] admin 打开新建任务模态 → 选 kind → 填 payload → dryRun 后看到 normalized 结果 → 提交后真任务入队
- [ ] 行级 cancel → task.status='cancelled' 立即反映
- [ ] 行级 replay → 新 task 创建，与原 task 同 kind/payload 但不同 id
- [ ] 选 5 个 task → bulk cancel → 全部成 cancelled
- [ ] viewer 不可见操作按钮
- [ ] payload 非法 JSON 时编辑器内即时校验，禁用提交
- [ ] `pnpm -r typecheck && lint && test && test:e2e` 全绿
