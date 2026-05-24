# M11 · 可观测性与运维

> 让运维方对"平台自身在干嘛、跑得好不好、能不能恢复"有把握。

## 里程碑目标

4 个运维基线：

1. **Prometheus / OpenTelemetry**：web + worker 暴露 `/metrics` 与 OTel traces；HTTP p95、queue depth、bcrypt 时延、cache 命中率全可观测。
2. **平台自身错误监控**：站点端错误已经入 `errors` 表；但平台自身崩溃（worker 异常、scheduler 抛错）目前没有外部聚合。接 Sentry。
3. **DB 备份与恢复**：infra 层目前裸 Postgres；缺定时备份 + 还原演练。
4. **CI 升级 + Release pipeline**：PR 跑 e2e smoke + 覆盖率门槛；tag 推 GHCR 镜像。

## 任务清单

| ID                                    | 标题                              | 状态 | 估时 | 前置 |
| ------------------------------------- | --------------------------------- | ---- | ---: | ---- |
| [T47](./T47-metrics-otel-exporter.md) | Prometheus + OpenTelemetry 导出器 | ⬜   | 10 h | T11  |
| [T48](./T48-platform-sentry.md)       | 平台自身错误监控接 Sentry         | ⬜   |  4 h | T01  |
| [T49](./T49-db-backup-restore.md)     | DB 备份与恢复方案                 | ✅   |  4 h | T02  |
| [T50](./T50-release-pipeline.md)      | Release pipeline + CI 升级        | ✅   |  4 h | T05  |

## 不在 M11 范围

- 自托管 Grafana / Loki / Tempo（提供 endpoint，托管交给运维）
- 告警阈值自动学习
- 多区域 / 多机房

## 里程碑完成条件

- [ ] `curl http://web:3000/metrics` 返回 Prometheus exposition 格式
- [ ] worker 同样暴露 `/metrics` 端口（默认 9091）
- [ ] OTel exporter 可配 `OTEL_EXPORTER_OTLP_ENDPOINT` 推到任意 collector
- [ ] worker 抛未捕获异常 → Sentry 收到（mock dsn 即可）
- [x] `infra/backup/` 提供 `backup.sh` + cron 示例 + `restore.sh`；docs 写完整恢复演练
- [x] PR CI 跑 Playwright smoke（< 5min）；coverage 报告上传
- [x] tag `v0.x.y` 推 GHCR 镜像 + GitHub Release
- [x] `pnpm -r typecheck && lint && test` 全绿
