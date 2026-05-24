# T41 — TOTP 二次验证

- **里程碑**：M9
- **优先级**：P1
- **前置依赖**：T40
- **预估工时**：6 h
- **状态**：Todo

## 目标

为 dashboard 登录加可选 TOTP 二次验证（RFC 6238，兼容 Google Authenticator / 1Password / Authy）；admin 可强制全员启用，恢复码作为兜底。

## 范围

**包含**

- 迁移：`packages/db/migrations/00XX_users_totp.sql`
  - `ADD COLUMN totp_secret TEXT`（加密存储，AES-256-GCM，key 从 env `TOTP_ENC_KEY`）
  - `ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT false`
  - `ADD COLUMN totp_enabled_at TIMESTAMPTZ`
  - 新表 `user_totp_recovery_codes (user_id, code_hash, used_at, created_at)`
- shared 工具：`packages/shared/src/utils/totp.ts` —— 包 `otplib`，处理加密 / QR URI 生成
- 设置页：`/(dashboard)/settings/security` —— 启用 / 关闭 / 显示恢复码
- 登录流程二段：credentials 通过后若 `totp_enabled` 则跳 `/login/2fa`（session 处于半验证状态，标 `pending2FA`）
- 强制开启：env `REQUIRE_TOTP=true` 时所有 admin 必须设置（首次登录后自动跳 `/setup-2fa`）

**不包含**

- WebAuthn / Passkey（留 v2）
- SMS / Email OTP（容易被劫持）

## 设计要点

### 加密存储 TOTP secret

```ts
// shared/src/utils/totp.ts
import { authenticator } from 'otplib';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encryptSecret(plaintext: string, encKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

export function decryptSecret(cipherText: string, encKey: Buffer): string {
  /* 对称 */
}

export function generateTotpUri(email: string, secret: string): string {
  return authenticator.keyuri(email, 'SiteOps', secret);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  return authenticator.verify({ token: code, secret });
}
```

### 登录二段

```
POST /api/auth/callback/credentials  -> session 标 pending2FA: true
GET /login                            -> 检测 pending2FA → redirect /login/2fa
POST /api/v1/auth/2fa/verify { code } -> 通过则 session 升级（pending2FA=false）
```

- 半验证 session 仍是 JWT，但 callbacks.session 检查 `pending2FA` 时只返回 `{ user: { id }, pending2FA: true }`
- middleware 检测 `pending2FA=true` 时把所有非 `/login/2fa` 路径重定向回 2FA 页

### 恢复码

- 启用 TOTP 时生成 8 个 `crypto.randomBytes(5).toString('base64url')` 形态码（10 chars）
- 显示一次，用户必须复制保存
- DB 存 `sha256(code)`；使用一次后 `used_at` 写入

## 涉及文件

```
packages/db/migrations/00XX_users_totp.sql
packages/db/migrations/00XX+1_totp_recovery_codes.sql
packages/db/src/schema/users.ts                              # 加列
packages/db/src/schema/user-totp-recovery-codes.ts           # 新
packages/services/src/users/totp-service.ts                   # 新
packages/shared/src/utils/totp.ts                             # 新
apps/web/lib/auth.config.ts                                   # pending2FA 逻辑
apps/web/lib/auth.ts                                          # credentials provider 后置 stamp
apps/web/middleware.ts                                        # pending2FA 重定向
apps/web/app/login/2fa/page.tsx                               # 新
apps/web/app/(dashboard)/settings/security/page.tsx           # 新
apps/web/app/api/v1/auth/2fa/setup/route.ts                   # 生成 secret + QR
apps/web/app/api/v1/auth/2fa/verify/route.ts                  # 登录提交 code
apps/web/app/api/v1/auth/2fa/disable/route.ts                 # 解绑
apps/web/lib/env.ts                                            # +TOTP_ENC_KEY, REQUIRE_TOTP
apps/web/__tests__/login-2fa.e2e.ts                            # e2e 流程
```

## 验收标准

- [ ] 单测：encrypt → decrypt 还原；verify 正确 code 通过、错误 code 拒绝
- [ ] 单测：30s 窗口前后允许 ±1 step（应对时钟漂移）
- [ ] e2e：admin 启用 TOTP → logout → 登录 → 输入 code → 进入 dashboard
- [ ] e2e：错误 code 5 次后触发 rate limit
- [ ] 恢复码：使用一次后 `used_at` 设置且不可复用
- [ ] env `REQUIRE_TOTP=true` 时未启用 TOTP 的用户自动跳 `/setup-2fa`
- [ ] `pnpm -r typecheck && lint && test && test:e2e` 全绿
