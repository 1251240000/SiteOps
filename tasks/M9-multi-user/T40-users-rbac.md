# T40 — Users + RBAC

- **里程碑**：M9
- **优先级**：P1
- **前置依赖**：T06
- **预估工时**：10 h
- **状态**：Done

## 目标

把"单 admin"假设升级为"三种角色（admin / operator / viewer）+ 邀请流程"，所有现有 API 路由按角色守卫；admin 可在 dashboard 管理团队成员。

## 范围

**包含**

- 迁移：`packages/db/migrations/00XX_users_role.sql`
  - `ADD COLUMN role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','operator','viewer'))`
  - `ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'))`
  - `ADD COLUMN invited_by UUID REFERENCES users(id)`
  - `ADD COLUMN invited_at TIMESTAMPTZ`
  - `ADD COLUMN last_login_at TIMESTAMPTZ`
- 邀请流程：`user_invitations` 新表 `(id, email, role, token_hash, expires_at, accepted_at, invited_by, created_at)`
- shared 常量：`USER_ROLES = ['admin','operator','viewer']`、`RolePermissions` 配置矩阵
- 守卫：`apps/web/lib/with-api.ts` 加 `requireRole('admin')` / `requireRole('admin','operator')`
- Service hook：`userService` 创建/邀请/接受邀请/改角色/停用
- 路由：
  - `GET /api/v1/users` — admin
  - `POST /api/v1/users/invitations` — admin（生成 token，邮件链接 `/invite/[token]`）
  - `POST /api/v1/users/invitations/accept` — 公开，校验 token + 设密码
  - `PATCH /api/v1/users/{id}` — admin（改 role / status）
- UI：
  - `/(dashboard)/settings/users` — 列表 + 邀请按钮
  - `/invite/[token]` — 公开页（输入密码完成账号）
- 所有现有写入路由按矩阵守卫

**不包含**

- 站点级 ACL（按 site 限制 viewer 可见站点）—— v2
- SSO

## 设计要点

### 角色矩阵（程序化）

```ts
// packages/shared/src/permissions.ts
export const ROLE_PERMISSIONS = {
  admin: { '*': true },
  operator: {
    'sites.write': true,
    'alerts.write': true,
    'api_keys.read': true,
    'audit.read': false,
    'users.write': false,
    'sites.read': true,
    'agent_runs.read': true,
    'webhooks.read': true,
    'metrics.read': true,
  },
  viewer: {
    'sites.read': true,
    'alerts.read': true,
    'metrics.read': true,
    'agent_runs.read': true,
    'webhooks.read': true,
    'sites.write': false,
    'api_keys.read': false,
    'users.write': false,
  },
} as const;

export function can(role: UserRole, perm: string): boolean {
  const map = ROLE_PERMISSIONS[role];
  return map['*'] === true || map[perm] === true;
}
```

### 守卫

```ts
// with-api.ts
export function requirePermission(perm: string, handler: ApiHandler) {
  return withApi(async (req, ctx) => {
    if (!ctx.user) throw new AppError('No session', { code: 'unauthorized', status: 401 });
    if (!can(ctx.user.role, perm))
      throw new AppError('Forbidden', { code: 'forbidden', status: 403 });
    return handler(req, ctx);
  });
}
```

- `ctx.user` 扩展 `role: UserRole`，需要在 NextAuth session callback 里 stamp
- 邀请 token：`crypto.randomBytes(32).toString('base64url')`，DB 存 sha256(token)

### Session 携带 role

`apps/web/lib/auth.config.ts` callbacks.jwt 加 `token.role = user.role`；callbacks.session 写 `session.user.role`。

## 涉及文件

```
packages/db/migrations/00XX_users_role.sql
packages/db/migrations/00XX+1_user_invitations.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/users.ts
packages/db/src/schema/user-invitations.ts             # 新
packages/db/src/schema/index.ts                         # 导出
packages/db/src/repositories/user-repo.ts               # 改/新
packages/db/src/repositories/user-invitation-repo.ts    # 新
packages/services/src/users/user-service.ts             # 新
packages/services/src/users/index.ts                    # 新
packages/services/src/index.ts                          # 加 namespace
packages/shared/src/constants/users.ts                  # ROLES
packages/shared/src/permissions.ts                      # 矩阵 + can()
packages/shared/src/schemas/users.ts                    # Zod
apps/web/lib/auth.config.ts                             # stamp role
apps/web/lib/with-api.ts                                # requirePermission helper
apps/web/app/api/v1/users/route.ts                      # GET / POST
apps/web/app/api/v1/users/[id]/route.ts                 # PATCH
apps/web/app/api/v1/users/invitations/route.ts          # POST
apps/web/app/api/v1/users/invitations/accept/route.ts   # POST
apps/web/app/(dashboard)/settings/users/page.tsx
apps/web/app/(dashboard)/settings/users/_components/*.tsx
apps/web/app/invite/[token]/page.tsx
# 全部已有写入路由：增加 requirePermission(...) 包装（约 30 个端点）
```

## 验收标准

- [x] 迁移 apply 成功，现有 admin row 自动 `role='admin'`
- [x] 单测：can() 矩阵覆盖每个 role × 每个 perm
- [x] 集成测：viewer 登录调 `POST /sites` → 403 forbidden
- [x] 集成测：operator 调 `POST /sites` → 201
- [x] 邀请流程 e2e：admin 创邀 → token → 接受 → 新账号能登录
- [x] dashboard：viewer 登录后写入按钮 disabled 且不可见
- [x] `pnpm -r typecheck && lint && test && pnpm test:e2e` 全绿
