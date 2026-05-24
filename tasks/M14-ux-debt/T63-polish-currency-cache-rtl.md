# T63 — 多币种 + 缓存策略 + 组件 RTL 测试

- **里程碑**：M14
- **优先级**：P2
- **前置依赖**：T23
- **预估工时**：2 h
- **状态**：Todo

## 目标

3 个完全独立的小打磨打包成一个任务，单批次落地：① site_costs / affiliate_entries 加 currency 字段；② dashboard 部分页放宽 `force-dynamic`；③ 关键组件加 React Testing Library 单测。

## 范围

**包含**

### 多币种

- `site_costs` + `affiliate_entries` 各加列：
  ```sql
  ALTER TABLE site_costs ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD';
  ALTER TABLE site_costs ADD COLUMN exchange_rate_to_usd NUMERIC(12,6);
  ALTER TABLE affiliate_entries ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD';
  ALTER TABLE affiliate_entries ADD COLUMN exchange_rate_to_usd NUMERIC(12,6);
  ```
- Service 层：写入时若未提供 exchange_rate_to_usd，调一个简单 fixer.io / 本地汇率表自动填
- ROI 计算：均换算为 USD 后再聚合
- UI：input 加 currency 选择器（USD / CNY / EUR / JPY / GBP）

### 缓存策略

- 部分 dashboard 页（settings / api-keys 列表 / users）当前 `force-dynamic`；改 `revalidate=30` 让 Next 在 30s 内复用 RSC 渲染
- 列表页保留 `force-dynamic`（数据变化频繁，不缓存）

### 组件 RTL 测试

- 装 `@testing-library/react` + `@testing-library/jest-dom`
- 为 5 个核心组件加单测：
  - `<DataTable />`（排序 / 过滤 / 分页交互）
  - `<LocaleSwitcher />`
  - `<CommandPalette />` (T60)
  - `<NewTaskDialog />` (T53)
  - `<CwvChart />` (T57)

**不包含**

- 实时汇率同步 job
- 货币展示对齐（dashboard 顶栏全局币种切换；后续可加）

## 设计要点

### 多币种

```ts
// services/src/revenue/currency-service.ts
const EXCHANGE_CACHE = new Map<string, { rate: number; fetchedAt: number }>();
const STALE_HOURS = 12;

export async function getRateToUsd(currency: string): Promise<number> {
  if (currency === 'USD') return 1.0;
  const cached = EXCHANGE_CACHE.get(currency);
  if (cached && Date.now() - cached.fetchedAt < STALE_HOURS * 3600_000) return cached.rate;
  const rate = await fetchExchangeRate(currency); // fixer.io 或预置表
  EXCHANGE_CACHE.set(currency, { rate, fetchedAt: Date.now() });
  return rate;
}
```

site_costs / affiliate_entries 写入时若 currency != USD 且 exchange_rate_to_usd 为空 → 自动填充。

### Revalidate

```tsx
// apps/web/app/(dashboard)/settings/page.tsx
export const revalidate = 30; // 替代 force-dynamic
// 列表 / 数据频繁变化页保持 dynamic
```

### RTL 单测样例

```ts
// data-table.test.tsx
test('sorts by column when header clicked', async () => {
  const { user, getByRole } = renderTable({ data: [{ name: 'B' }, { name: 'A' }], columns: [...] });
  await user.click(getByRole('button', { name: /name/i }));
  expect(getAllByRole('row')[1]).toHaveTextContent('A');
});
```

## 涉及文件

```
packages/db/migrations/00XX_currency_columns.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/site-costs.ts
packages/db/src/schema/affiliate-entries.ts
packages/services/src/revenue/currency-service.ts
packages/services/src/roi/roi-service.ts                       # USD 换算
packages/shared/src/constants/currency.ts                      # SUPPORTED_CURRENCIES
apps/web/app/(dashboard)/sites/[id]/revenue/_components/*.tsx  # currency 选择
apps/web/app/(dashboard)/sites/[id]/roi/_components/*.tsx
# Cache
apps/web/app/(dashboard)/settings/page.tsx
apps/web/app/(dashboard)/settings/api-keys/page.tsx
apps/web/app/(dashboard)/settings/users/page.tsx                # 来自 T40
# RTL tests
apps/web/components/__tests__/data-table.test.tsx
apps/web/components/__tests__/locale-switcher.test.tsx
apps/web/components/__tests__/command-palette.test.tsx
apps/web/components/__tests__/new-task-dialog.test.tsx
apps/web/components/__tests__/cwv-chart.test.tsx
apps/web/package.json                                          # +@testing-library/react +jest-dom
apps/web/vitest.config.ts                                      # JSDOM env
```

## 验收标准

- [ ] site_costs / affiliate_entries 支持 currency=CNY 入库 + exchange_rate_to_usd 自动填
- [ ] ROI 显示均为 USD（同时保留原币显示）
- [ ] 缓存页 30s 内重复访问无重新 DB 查询（log 验证）
- [ ] 5 个 RTL 测试全部通过且 vitest 不再警告 "no test environment"
- [ ] `pnpm -r typecheck && lint && test` 全绿
