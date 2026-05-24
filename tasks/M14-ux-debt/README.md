# M14 · UX 与长期债务

> 收尾里程碑：补齐键盘 / 移动 / 多语言等"使用质感"，同时清理几项硬编码 / 缺失测试等长期债。

## 里程碑目标

4 类不阻塞核心功能、但影响"长期使用体验"的工作：

1. **命令面板 + 首页自定义**：高频用户每次找站点都翻侧栏，⌘K 全局搜索极大降低导航成本；admin 想个性化首页 KPI。
2. **移动 & 国际化**：当前 UI 仅在桌面验证；i18n 仅 zh-CN / en-US。补 a11y 检查、移动布局、新增 ja-JP / zh-TW。
3. **配置化 + 存储抽象**：ROI 阈值硬编码（rules.ts TODO）；Lighthouse / audit data 用本地卷无法 scale-out。
4. **打磨**：Argon2id 替换 bcryptjs、多币种、缓存策略优化、组件级 RTL 测试。

## 任务清单

| ID                                        | 标题                                       | 状态 | 估时 | 前置 |
| ----------------------------------------- | ------------------------------------------ | ---- | ---: | ---- |
| [T60](./T60-command-palette-home.md)      | 命令面板（⌘K）+ Dashboard 首页自定义       | ⬜   |  6 h | T07  |
| [T61](./T61-mobile-a11y-locale.md)        | 移动响应式 + a11y + Locale 扩展（ja/tw）   | ⬜   |  5 h | T28  |
| [T62](./T62-config-storage.md)            | ROI 阈值可配置化 + Storage 抽象 + Argon2id | ⬜   |  4 h | T24  |
| [T63](./T63-polish-currency-cache-rtl.md) | 多币种 + 缓存策略 + 组件 RTL 测试          | ⬜   |  2 h | T23  |

## 不在 M14 范围

- 重写整个 UI（v2 才考虑）
- 自动化 a11y 测试持续 CI 检查（仅本里程碑做一次 audit）
- PWA / 离线模式

## 里程碑完成条件

- [ ] ⌘K 在任意页面打开 spotlight，能跳站点 / alert rule / 任务
- [ ] dashboard 首页 admin 可拖拽 KPI 卡，配置持久化
- [ ] iPhone SE 视口下主流页可用（侧栏自动折叠）
- [ ] ja-JP / zh-TW catalog 完整、`pnpm i18n:check` 通过
- [ ] ROI 阈值改成 `/settings/roi` 可视化调整
- [ ] Lighthouse data 可走 S3 兼容 storage（env 切换）
- [ ] 密码 / API key 改 Argon2id，旧 hash 自动升级
- [ ] site_costs / affiliate_entries 支持 currency 字段
- [ ] `pnpm -r typecheck && lint && test` 全绿
