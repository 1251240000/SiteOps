# T49 — DB 备份与恢复方案

- **里程碑**：M11
- **优先级**：P1
- **前置依赖**：T02
- **预估工时**：4 h
- **状态**：Done

## 目标

为生产 Postgres 提供"定时自动备份 + 验证可恢复"的最小可用方案，写明操作手册；CI 加一条"backup → restore"演练，保证迁移变更不破坏可恢复性。

## 范围

**包含**

- 新增 `infra/backup/` 目录：
  - `backup.sh`：`pg_dump -Fc` 到目标目录，自动按日期命名 + 保留 N 天
  - `restore.sh`：从备份文件 + 时间戳还原到指定 DB
  - `cron-backup.dockerfile`：基于 postgres:16-alpine 的 sidecar 镜像
- docker-compose 加 `postgres-backup` 服务（可选 profile）：每天 02:00 跑 backup.sh，写入 named volume `pg-backup`
- 文档 `docs/12-backup-restore.md`：操作手册（怎么手动 backup、怎么 restore、怎么演练）
- CI 新增 `db-backup-restore.yml` 工作流：
  1. 启 PG 容器 + apply migrations + seed
  2. 写入一批 sentinel rows
  3. `pg_dump -Fc` 备份
  4. 删除所有表
  5. `pg_restore` 还原
  6. 验证 sentinel rows 完整

**不包含**

- 增量 / WAL 归档（pgbackrest / wal-g）—— 单机 daily full 已经足够 MVP；规模上来再上 WAL
- 异地副本 / 多活
- Redis 持久化（appendonly 已开，无业务持久化需求）

## 设计要点

### backup.sh

```bash
#!/usr/bin/env sh
set -eu
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="${BACKUP_DIR:-/backups}/siteops-${TIMESTAMP}.dump"
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h "${POSTGRES_HOST:-postgres}" \
  -U "${POSTGRES_USER:-siteops}" \
  -d "${POSTGRES_DB:-siteops}" \
  -Fc -f "${TARGET}"

# 保留最近 N 天（默认 14）
find "${BACKUP_DIR:-/backups}" -name 'siteops-*.dump' -mtime "+${KEEP_DAYS:-14}" -delete
echo "backup written: ${TARGET}"
```

### restore.sh

```bash
#!/usr/bin/env sh
set -eu
if [ -z "${1:-}" ]; then echo "usage: restore.sh <dumpfile>"; exit 1; fi
PGPASSWORD="${POSTGRES_PASSWORD}" pg_restore \
  -h "${POSTGRES_HOST:-postgres}" \
  -U "${POSTGRES_USER:-siteops}" \
  -d "${POSTGRES_DB:-siteops}" \
  --clean --if-exists --no-owner --no-privileges \
  "$1"
```

### Sidecar 服务（docker-compose profile=backup）

```yaml
postgres-backup:
  image: postgres:16-alpine
  profiles: [backup]
  environment:
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    POSTGRES_USER: ${POSTGRES_USER:-siteops}
    POSTGRES_DB: ${POSTGRES_DB:-siteops}
    POSTGRES_HOST: postgres
    KEEP_DAYS: ${BACKUP_KEEP_DAYS:-14}
  volumes:
    - ./backup/backup.sh:/usr/local/bin/backup.sh:ro
    - pg-backup:/backups
  entrypoint: ['sh', '-c']
  command: >
    "echo '0 2 * * * /usr/local/bin/backup.sh' | crontab -
    && crond -f"
```

### CI 演练（独立 workflow，避免拖慢 PR）

```yaml
# .github/workflows/db-backup-restore.yml
on:
  push: { branches: [main] }
  schedule: [{ cron: '0 4 * * *' }]
  workflow_dispatch:
```

跑步骤如上。失败时 fail loudly。

## 涉及文件

```
infra/backup/backup.sh
infra/backup/restore.sh
infra/backup/README.md
infra/docker-compose.yml                                   # +profile backup
docs/12-backup-restore.md
.github/workflows/db-backup-restore.yml
.env.example                                                # +BACKUP_KEEP_DAYS
```

## 验收标准

- [x] 本地 `docker compose --profile backup up -d` 起 backup sidecar
- [x] 手动 `docker compose exec postgres-backup /usr/local/bin/backup.sh` 写出文件
- [x] `restore.sh` 在新空 DB 中能恢复出原始 sites / users 行数
- [x] 14 天前的备份被自动清理
- [x] CI 演练 workflow 绿色（首次跑由 push 到 `main` 触发；workflow_dispatch 也可手动跑）
- [x] docs 写明：① 怎么手动备份 ② 怎么从备份还原 ③ 还原后必须重启 web/worker

## 实现备注

- 涉及文件 `cron-backup.dockerfile` 改成「直接挂脚本进 `postgres:16-alpine`」的 sidecar 形态：少一层镜像构建，且 `pg_dump` / `pg_restore` 的版本与主 PG 完全一致，避免 client/server 版本漂移。`infra/backup/entrypoint.sh` 接管 cron 装载（busybox `crond` 的 env 不会自动注入，需在 crontab 顶部手动写入 `POSTGRES_*`、`BACKUP_DIR`、`KEEP_DAYS`）。
- `backup.sh` 使用 `.partial → mv` 的两步原子写法，OOM 杀进程也不会留下伪装成有效 dump 的半截文件；retention 用 POSIX `find -mtime +N` 实现，不依赖 GNU 扩展。
- `restore.sh` 默认 `--clean --if-exists --no-owner --no-privileges --exit-on-error`：可重复运行，不依赖目标 DB 干净，但中途出错就停（避免半 restore 留下残骸）。新增 `latest` 关键字直接挑 `BACKUP_DIR` 里最新一个 dump，不用 ops 在 dump 文件名上费神。
- CI 演练放独立 workflow（`.github/workflows/db-backup-restore.yml`）：仅在 `infra/backup/**`、`packages/db/migrations/**`、`infra/docker-compose.yml` 与 workflow 本身变更时跑，保护 PR 速度；同时挂 `schedule: '0 4 * * *'` 兜底每日跑一遍。drill 步骤完整复刻 prod sidecar：用 `postgres:16-alpine` 容器跑挂载的 `backup.sh` / `restore.sh`。
- 验证脚本：在 dev PG 旁边起一个 5499 端口的 throwaway PG → migrate → 插 sentinel → backup → `DROP SCHEMA public CASCADE` → `restore.sh latest` → 24 张表 + 3 行 sentinel 完整回来；retention 用 `touch -d '30 days ago'` 合成一份过期 dump 验证被剪掉；entrypoint 用 `BACKUP_CRON='* * * * *'` 跑 ~70s 看到两次 cron 触发的 backup 出现在 `docker logs`。
