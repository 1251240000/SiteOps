# M9 · 多用户与认证安全

> 把单 admin 假设打破：让平台具备团队级使用能力，同时把认证侧安全基线（2FA、审计日志、webhook secret 旋转）补齐。

## 里程碑目标

4 类安全/协作债：

1. **RBAC**：`users` 表无 `role` 列；副 admin、运营、只读分析师全部走不通。
2. **2FA / 二次验证**：单 password 守整站 → 一旦泄漏 = 全站接管。补 TOTP（可选启用）。
3. **管理动作审计**：现有 `agent_runs` 记机器调用；人类操作（建站、改 alert、吊 key）没有审计轨。
4. **Webhook secret 旋转**：env 单值 secret，rotate 必须重启 + 短暂停服。改成 DB 双 secret 支持滚动。

## 任务清单

| ID                                      | 标题                             | 状态 | 估时 | 前置 |
| --------------------------------------- | -------------------------------- | ---- | ---: | ---- |
| [T40](./T40-users-rbac.md)              | Users + RBAC（角色 + 守卫 + UI） | ⬜   | 10 h | T06  |
| [T41](./T41-totp-2fa.md)                | TOTP 二次验证                    | ⬜   |  6 h | T40  |
| [T42](./T42-action-audit-log.md)        | 管理动作审计日志                 | ⬜   |  8 h | T40  |
| [T43](./T43-webhook-secret-rotation.md) | Webhook secret 旋转              | ⬜   |  4 h | T27  |

## 角色矩阵

| Role       | 站点 / 域名 / 部署 | Alert Rules | API Keys | Settings 用户 | Agent runs / Webhook | 报表 |
| ---------- | ------------------ | ----------- | -------- | ------------- | -------------------- | ---- |
| `admin`    | 全权               | 全权        | 全权     | 全权          | 全权                 | 全权 |
| `operator` | 写                 | 写          | 只读     | 不可见        | 只读                 | 只读 |
| `viewer`   | 只读               | 只读        | 不可见   | 不可见        | 只读                 | 只读 |

## 不在 M9 范围

- SSO / SAML / OAuth 登录（仅 credentials + 可选 TOTP）
- 资源粒度 ACL（按 site 维度的可见性）—— 后续 v2
- Passkey / WebAuthn（TOTP 先行）

## 里程碑完成条件

- [ ] `/(dashboard)/settings/users` 可邀请、改角色、停用
- [ ] viewer 登录访问 `/sites/[id]` 可看不可编辑（按钮 disabled）
- [ ] admin 启用 TOTP 后下次登录走两步
- [ ] `/(dashboard)/settings/audit` 可看到自己最近 100 条管理操作
- [ ] 同一 webhook secret 可滚动：rotate 后旧 secret 在 7 天内仍可验证（让 CF/GH 端有时间换 key）
- [ ] `pnpm -r typecheck && lint && test` 全绿
