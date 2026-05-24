# T61 — 移动响应式 + a11y 验收 + Locale 扩展

- **里程碑**：M14
- **优先级**：P2
- **前置依赖**：T28
- **预估工时**：5 h
- **状态**：Todo

## 目标

3 件小事打包：① iPhone SE / Pixel 5 视口下主流页可用；② Lighthouse a11y ≥ 95 分；③ 新增 ja-JP / zh-TW 两份 catalog。

## 范围

**包含**

### 移动响应式

- 侧栏在 < 768px 时折叠为汉堡菜单
- Table 在 < 640px 时切换为 card 视图（每行一卡）
- 主要交互区域（buttons、inputs）触摸目标 ≥ 44×44px
- 新增 Playwright e2e：`viewport: { width: 375, height: 812 }` 跑核心路径

### a11y 审计

- 用 `axe-core` Playwright 集成跑 `/`, `/sites`, `/alerts`, `/login` 4 个核心页面
- 修复发现的 critical / serious 问题（aria-label、focus order、对比度）
- 目标：每个测试页 axe `serious+critical` = 0

### Locale 扩展

- 复制 `messages/zh-CN.json` 与 `en-US.json` → `ja-JP.json` + `zh-TW.json`
- 翻译条目（约 1000 行 × 2 语言）
- `lib/i18n/locales.ts` 加入支持的语言
- 顶栏 LocaleSwitcher 加 2 个选项

**不包含**

- RTL（阿拉伯语等）—— 全部 LTR
- 自动机器翻译流水线
- 跨设备 layout 大改（仅响应式 + 触摸目标修正）

## 设计要点

### 响应式策略

```tsx
// components/sidebar.tsx
<Sheet> {/* 移动端用 sheet 抽屉 */}
  <SheetTrigger className="md:hidden"><Menu /></SheetTrigger>
  <SheetContent side="left"><SidebarContent /></SheetContent>
</Sheet>
<aside className="hidden md:block">  {/* 桌面端常显 */}
  <SidebarContent />
</aside>
```

```tsx
// data-table.tsx 加 mode='card'
<div className="hidden sm:block">{table.getRowModel().rows.map(/* row */)}</div>
<div className="sm:hidden space-y-3">{table.getRowModel().rows.map(row => (
  <Card key={row.id}>...</Card>
))}</div>
```

### a11y 测试集成

```ts
// e2e/a11y.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

['/', '/sites', '/alerts', '/login'].forEach((path) => {
  test(`@a11y ${path}`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual(
      [],
    );
  });
});
```

### Locale 文件

```bash
# scripts/scaffold-locale.mjs
cp messages/en-US.json messages/ja-JP.json
cp messages/en-US.json messages/zh-TW.json
# 手动翻译（或 mock 翻译让 i18n:check 先通过）
```

## 涉及文件

```
apps/web/components/sidebar.tsx                             # 响应式改造
apps/web/components/data-table.tsx                          # card mode
apps/web/components/ui/sheet.tsx                            # shadcn sheet（若无）
apps/web/messages/ja-JP.json                                # 新
apps/web/messages/zh-TW.json                                # 新
apps/web/lib/i18n/locales.ts                                 # 加 SUPPORTED_LOCALES
apps/web/components/locale-switcher.tsx                      # 加选项
apps/web/scripts/check-i18n-keys.mjs                         # 已存在，自动扫描
apps/web/e2e/mobile.spec.ts                                   # 新
apps/web/e2e/a11y.spec.ts                                     # 新
apps/web/package.json                                         # +@axe-core/playwright
```

## 验收标准

- [ ] iPhone SE viewport (375×667) 下 /, /sites, /alerts 可完整操作
- [ ] axe e2e 跑 4 页面无 serious / critical
- [ ] 移动 e2e 跑通登录 + 创建站点 + 查看 alert
- [ ] ja-JP / zh-TW 切换后 UI 完全本地化
- [ ] `pnpm i18n:check` 通过
- [ ] `pnpm -r typecheck && lint && test && test:e2e` 全绿
