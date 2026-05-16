# M6 · 体验打磨

> M0–M5 把"能用"做完了；M6 专注"用起来更舒服"——首批落地 dashboard i18n，后续承接所有"非新功能但提升使用质感"的工作。

## 里程碑目标

到 M5 收尾时，siteops 已经是一个功能闭环、Agent 可对接、监控告警齐全的内部平台，但仍是清一色英文 UI、缺少正经的本地化与可访问性支撑。M6 把这层"打磨"独立成一个里程碑，避免把 UX 工作搅进自动化主线：

1. **Dashboard 国际化**（T28）：UI 字符串抽到 message catalog，zh-CN 默认 + en-US 可切；后端 API 错误码保持英文。

后续 T29+ 候选（**暂不立项**，需要时再写规格）：

- 站点详情按 `sites.target_language` 切换内容维度的指标标签
- API 错误 message / 邮件 / 飞书 / 钉钉模板 i18n catalog
- WCAG 2.1 AA 可访问性审计 + 修复
- 移动端 / 小屏 PWA 支持
- 从 zod 自动生成 OpenAPI 3 spec + Swagger UI（接 docs/04-api-spec.md §7）
- 全局键盘快捷键（cmd-K 命令面板）
- 暗色主题颗粒度提升 / 颜色对比度复核

## 任务清单

| ID                             | 标题                                 | 状态 | 估时 | 前置 |
| ------------------------------ | ------------------------------------ | ---- | ---: | ---- |
| [T28](./T28-i18n-dashboard.md) | Dashboard UI 国际化（zh-CN + en-US） | ⬜   |  6 h | T07  |

## 数据流概览

```
  Browser ──► siteops_locale cookie ──► next-intl middleware ──► messages/{locale}.json
                                                                       │
                                                                       ▼
                                            RSC / Client 渲染时用 t() 注入文案（T28）

  顶栏 LocaleSwitcher ──► POST /me/preferences/locale ──► Set-Cookie ──► router.refresh()
```

dashboard 路由**不引入** `[locale]/...` 段——locale 完全由 cookie 驱动，不破坏 M1–M5 的现有 URL；未来若需要 SEO 友好的 URL，再切到段式即可，catalog 不用重写。

## 不在 M6 范围

- 任何新业务功能（M5 已经封口）
- 后端 API 响应 / 错误 message 本地化（机器消费，保持英文契约）
- 邮件 / 告警通道文案 i18n（等真有外部 stakeholder 抱怨再做）
- RTL 布局支持（zh-CN 与 en-US 都是 LTR）

## 里程碑完成条件

- [ ] dashboard 默认 zh-CN，顶栏切到 en-US 后所有 UI 文本立即变更，无英文残留
- [ ] `messages/zh-CN.json` 与 `messages/en-US.json` key 集合一致（`pnpm i18n:check` 通过）
- [ ] Playwright e2e 强制 `siteops_locale=en-US` cookie 后仍全绿
- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm format:check` 全绿
- [ ] `tasks/README.md` 顶部状态表 M6 行翻 ✅
