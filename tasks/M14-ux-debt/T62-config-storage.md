# T62 — ROI 阈值可配置化 + Storage 抽象 + Argon2id 迁移

- **里程碑**：M14
- **优先级**：P2
- **前置依赖**：T24
- **预估工时**：4 h
- **状态**：Todo

## 目标

清理 3 项长期债：① ROI rules 阈值从硬编码迁到 `settings` 表 + UI 可调；② Lighthouse / audit data 从本地卷抽象为 storage 接口（local / S3 兼容）；③ 密码与 API key bcrypt → Argon2id，旧 hash 登录时透明升级。

## 范围

**包含**

### ROI 阈值

- 新表 `settings (key TEXT PK, value JSONB, updated_at)`
- service：`settingsService.get(key) / set(key, value)`，进程内 60s 缓存
- 改造 `packages/services/src/roi/rules.ts.RULE_THRESHOLDS` → 启动时读 settings；服务层 fallback 默认值
- UI：`/(dashboard)/settings/roi` 表单调阈值

### Storage 抽象

- `packages/storage/`（新包）：
  - `interface Storage { put / get / delete / sign }`
  - 实现：`local` (现有)、`s3` (兼容 R2/Minio)
- 改造 lighthouse-runner / audit-service：通过 storage 接口存 artifact
- env：`STORAGE_PROVIDER=local|s3`、`S3_BUCKET`、`S3_ENDPOINT`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`

### Argon2id 替换 bcrypt

- 装 `@node-rs/argon2`
- `packages/shared/src/utils/password.ts`：`hashPassword` 用 argon2id；`comparePassword` 同时识别 bcrypt 旧 hash（前缀 `$2`）+ argon2 新 hash（前缀 `$argon2id$`）
- 登录成功 + 旧 hash 命中 → 透明 rehash 写回 DB
- API key 同样处理

**不包含**

- 全表批量 rehash（在 login 时按需升级即可）
- KMS 密钥托管（env 即可）

## 设计要点

### Settings cache

```ts
// services/src/settings/settings-service.ts
const cache = new LRUCache<string, { value: unknown; cachedAt: number }>({ ttl: 60_000, max: 100 });

async function get<T>(deps, key: string, defaultVal: T): Promise<T> {
  const c = cache.get(key);
  if (c) return c.value as T;
  const row = await settingsRepo.getByKey(deps.db, key);
  const value = (row?.value ?? defaultVal) as T;
  cache.set(key, { value, cachedAt: Date.now() });
  return value;
}
```

### Storage 接口

```ts
// packages/storage/src/index.ts
export interface Storage {
  put(key: string, data: Buffer, contentType?: string): Promise<{ url: string }>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, ttlSec: number): Promise<string>;
}

export function createStorage(config: StorageConfig): Storage {
  switch (config.provider) {
    case 'local':
      return new LocalStorage(config.dir);
    case 's3':
      return new S3Storage(config);
  }
}
```

### Argon2id 兼容 hash

```ts
// shared/src/utils/password.ts
import * as argon2 from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { variant: argon2.Variant.Argon2id });
}

export async function comparePassword(
  plain: string,
  hash: string,
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (hash.startsWith('$argon2')) {
    return { ok: await argon2.verify(hash, plain), needsUpgrade: false };
  }
  if (hash.startsWith('$2')) {
    return { ok: await bcrypt.compare(plain, hash), needsUpgrade: true };
  }
  return { ok: false, needsUpgrade: false };
}
```

login 与 verifyApiKey 调用方在 `needsUpgrade=true` 时 fire-and-forget 写回新 hash。

## 涉及文件

```
packages/db/migrations/00XX_settings.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/settings.ts
packages/db/src/repositories/settings-repo.ts
packages/services/src/settings/settings-service.ts
packages/services/src/roi/rules.ts                          # 改成读 settings
packages/storage/                                            # 新包
packages/storage/src/index.ts
packages/storage/src/local.ts
packages/storage/src/s3.ts
packages/storage/src/__tests__/*.test.ts
pnpm-workspace.yaml                                          # 加 packages/storage
packages/integrations/src/lighthouse/real-runner.ts          # 用 storage 写
packages/services/src/audits/audit-service.ts                # 用 storage 写
packages/shared/src/utils/password.ts                        # argon2id
packages/shared/src/utils/api-key.ts                         # argon2id
packages/shared/package.json                                 # +@node-rs/argon2
packages/services/src/auth/auth-service.ts                   # needsUpgrade 处理
apps/web/lib/env.ts                                          # +STORAGE_* / S3_*
apps/worker/src/env.ts
apps/web/app/(dashboard)/settings/roi/page.tsx               # ROI 阈值 UI
apps/web/app/api/v1/settings/route.ts                        # GET / PATCH
```

## 验收标准

- [ ] ROI 阈值在 UI 改后立即生效（cache invalidate）
- [ ] env `STORAGE_PROVIDER=s3` 下 Lighthouse 结果写到 S3，dashboard 仍可下载（用 signedUrl）
- [ ] env `STORAGE_PROVIDER=local` 行为与现状一致
- [ ] 现有 bcrypt 用户登录成功 → DB 中 hash 自动升级到 `$argon2id$`
- [ ] 新建用户直接 argon2id
- [ ] 性能：argon2 hash 单次 ≤ 50ms（默认 cost）
- [ ] `pnpm -r typecheck && lint && test` 全绿
