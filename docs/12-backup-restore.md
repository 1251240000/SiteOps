# 12 · 数据库备份与恢复

> Production Postgres 的「定时备份 + 可恢复」最小可用方案。基础设施见
> `infra/backup/`，CI 演练见 `.github/workflows/db-backup-restore.yml`。

## 1. 方案速览

| 项目     | 当前选型                                                    |
| -------- | ----------------------------------------------------------- |
| 备份方式 | `pg_dump -Fc`（自定义二进制格式，支持 `pg_restore -j`）     |
| 频率     | 每日 02:00 UTC（`BACKUP_CRON` 可改）                        |
| 存放位置 | named volume `pg-backup`，容器内挂载点 `/backups`           |
| 保留策略 | `KEEP_DAYS=14`（每次 backup 后清理早于 N 天的 `.dump`）     |
| 恢复方式 | `pg_restore --clean --if-exists --no-owner --no-privileges` |
| 触发机制 | sidecar `postgres-backup`（busybox `crond`）                |
| CI 校验  | push to `main` + 每日 04:00 UTC 跑全链路 backup→restore     |
| 不在范围 | WAL 归档 / PITR / 异地副本 / 增量备份                       |

> 单实例 daily full 已经覆盖到「机器丢了能拿回 24h 内的数据」这条 SLO。
> 规模或可用性要求再上一档时，再切到 `pgbackrest` / managed PG 即可，本
> 方案的脚本接口和 docs 都不会拦着。

## 2. 启动 sidecar

`postgres-backup` 是 `infra/docker-compose.yml` 中带 `profile: backup` 的
opt-in 服务。生产栈第一次启用：

```bash
# 1) .env 里至少声明（其余有默认值）
#    POSTGRES_PASSWORD=...           # 与主 Postgres 一致
#    BACKUP_KEEP_DAYS=14             # 可选，默认 14

# 2) 在原有 up -d 命令后加 --profile backup
docker compose -f infra/docker-compose.yml --profile backup up -d

# 3) 确认容器在跑
docker compose -f infra/docker-compose.yml ps postgres-backup
docker logs siteops-postgres-backup
# 预期日志包含：
#   [entrypoint] cron schedule: 0 2 * * *
#   [entrypoint] target: siteops@postgres/siteops
#   [entrypoint] backup dir: /backups (keep 14d)
```

> 之后再 `docker compose up -d` 时记得把 `--profile backup` 带上，否则
> compose 会停掉 sidecar。可以把命令写进 ops 的 Makefile / systemd unit
> 里固化。

## 3. 手动操作

> 所有命令都假设你在仓库根目录，且 `.env` 已经填好。需要在不同主机执行
> 时把 `docker compose ...` 换成 `ssh prod 'docker compose ...'` 即可。

### 3.1 手动跑一次 backup

```bash
docker compose -f infra/docker-compose.yml exec postgres-backup \
  /usr/local/bin/backup.sh
# stdout 末尾会打印写入路径，例如：
#   [backup] wrote /backups/siteops-20260515T021500Z.dump (1234567 bytes)
```

### 3.2 看现有备份

```bash
docker compose -f infra/docker-compose.yml exec postgres-backup \
  ls -lh /backups
```

### 3.3 把备份拷到宿主机

```bash
docker cp siteops-postgres-backup:/backups ./pg-backups-$(date -u +%Y%m%d)
# 或者只拷最新一份
LATEST=$(docker compose -f infra/docker-compose.yml exec -T postgres-backup \
  sh -c 'ls -1t /backups/siteops-*.dump | head -n1')
docker cp "siteops-postgres-backup:${LATEST}" .
```

### 3.4 从备份恢复

> ⚠️ Destructive：`restore.sh` 用 `--clean --if-exists`，每个被恢复的
> 对象都会先 `DROP` 再 `CREATE`。生产恢复前请先停掉 `web` / `worker`，
> 避免它们在恢复中途读到半截 schema。

```bash
# 1) 停应用流量（保留 DB 服务和 sidecar）
docker compose -f infra/docker-compose.yml stop web worker

# 2) 恢复 — 默认从 sidecar 的 /backups 里选最新的
docker compose -f infra/docker-compose.yml exec postgres-backup \
  /usr/local/bin/restore.sh latest

# 或指定文件名：
docker compose -f infra/docker-compose.yml exec postgres-backup \
  /usr/local/bin/restore.sh /backups/siteops-20260515T021500Z.dump

# 3) 重启应用（必须 — 它们会缓存 prepared statements 与连接）
docker compose -f infra/docker-compose.yml up -d web worker

# 4) 健康检查
curl -fsS http://localhost/healthz
curl -fsS http://localhost/readyz
```

### 3.5 从「另一台机器拷过来」的 dump 恢复

宿主机上有 `siteops-prod.dump`，想灌进当前栈：

```bash
# 1) 把 dump 放进 sidecar 容器
docker cp ./siteops-prod.dump siteops-postgres-backup:/backups/

# 2) 走标准 restore 流程（见 3.4）
docker compose -f infra/docker-compose.yml exec postgres-backup \
  /usr/local/bin/restore.sh /backups/siteops-prod.dump
```

## 4. 备份恢复演练（推荐每月一次）

CI 已经在每次 `push to main` 跑一遍 backup→restore，但「真生产数据真
能恢复」这条 SLO 还是要人手验证。推荐节奏：

1. 月初挑一天，把上面 §3.1 / §3.4 在 **staging** 环境跑一遍。
2. 恢复完后用 SQL 抽查关键表行数：

   ```bash
   docker compose exec postgres psql -U siteops -d siteops <<'SQL'
   SELECT 'users'  AS tbl, count(*) FROM users
   UNION ALL SELECT 'sites',       count(*) FROM sites
   UNION ALL SELECT 'deployments', count(*) FROM deployments
   UNION ALL SELECT 'uptime_checks', count(*) FROM uptime_checks
   ORDER BY tbl;
   SQL
   ```

3. 跑一次 `pnpm --filter @siteops/web test:e2e:smoke`（如果配置了）。
4. 在 ops 文档登记日期与结果。

## 5. 故障速查

| 症状                                                                                                      | 排查                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker logs siteops-postgres-backup` 反复出现 `pg_dump: error: connection to server ... failed`          | 检查 `POSTGRES_PASSWORD` 是否与主栈一致；网络上 sidecar 必须能解析 `postgres` 这个 hostname（共用 `siteops-net`）。                                |
| backup 文件写入失败：`No space left on device`                                                            | `docker system df -v` 看 `pg-backup` 卷大小；过去 14 天的 dump 都还在 → 调小 `BACKUP_KEEP_DAYS`，或者把 `pg-backup` 卷挂到独立分区。               |
| `restore.sh` 退出码 1，日志类似 `pg_restore: error: could not execute query: ERROR: must be owner of ...` | 用了 `--no-owner` 但目标表的 owner 与连接用户不同。确认 `POSTGRES_USER` 是 DB owner（默认 `siteops`）。                                            |
| restore 后 web 一直 500 / readyz 返回 503                                                                 | `--clean --if-exists` 会重建 sequence；如果 web/worker 没重启，它们的 prepared statement 缓存指向旧 OID。**必须** restart `web` 和 `worker` 容器。 |
| 想换更长的保留时间但不想白等 14 天                                                                        | `docker compose ... up -d` 之前把 `.env` 里的 `BACKUP_KEEP_DAYS` 改了即可；下次 backup 后立刻生效，旧 dump 不会被立即删除（mtime 还在窗口内）。    |

## 6. 备份产物结构

每次 `backup.sh` 写出的文件名都是
`siteops-<YYYYMMDDTHHMMSSZ>.dump`，例如：

```text
siteops-20260515T021500Z.dump   # daily 02:00 UTC
siteops-20260515T143005Z.dump   # 临时手动
```

文件本身是 PostgreSQL 自定义格式（`pg_dump -Fc`）——非纯文本，无法
`psql -f` 直接灌；必须用 `pg_restore`。优点：

- 体积比纯 `pg_dump` 小（默认 zlib 压缩）
- 可以选择性 restore（`pg_restore -l file.dump` 列出对象，`-L list.txt` 过滤）
- 并行 restore：`pg_restore -j 4` 多 worker 并发

## 7. 把 backup 卷接到对象存储（可选，推荐）

`pg-backup` 这种 named volume 只保护「机器没挂、磁盘没坏」的场景。为了
保险，再把它定期同步到 S3 / Backblaze / Cloudflare R2 是经典做法。最
小实现，在宿主机 cron 加一行：

```cron
# /etc/cron.d/siteops-backup-offsite
30 2 * * * root /usr/local/bin/rclone sync /var/lib/docker/volumes/siteops_pg-backup/_data b2:my-siteops-backups/ --delete-after
```

`rclone sync` 自带 hash 校验、增量上传、对端版本保留（`--backup-dir`），
比自己写脚本稳。bucket 端建议开启「30 天版本保留」防误删。

## 8. 关联任务

- T02 — Dev/Prod Docker Compose（提供 PG 容器）
- T29 — `/readyz` 健康探针（恢复后用来确认服务在线）
- T49 — 本任务，备份与恢复方案
- 未来的 T50 — Release pipeline 升级（恢复演练可以挂进 release gate）
