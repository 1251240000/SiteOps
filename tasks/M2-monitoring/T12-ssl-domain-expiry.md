# T12 — SSL 与域名到期巡检

- **里程碑**：M2
- **优先级**：P1
- **前置依赖**：T09
- **预估工时**：4h
- **状态**：Done

## 目标

每日巡检所有域名的 SSL 证书 NotAfter 与域名 expires_at，把结果回写 `domains` 表，并在临近到期时触发告警。

## 范围

**包含**

- worker job：`ssl-domain-expiry`（每天一次，凌晨随机分散）
- SSL 探测：TLS 连接读取 peerCertificate.valid_to → 写 ssl_expires_at、ssl_issuer
- 域名 expires_at：当前阶段仅"读取并对比阈值"，不主动 WHOIS（WHOIS 留 M3 可选扩展）
- 告警阈值：SSL <= 14 天、Domain <= 30 天（可在站点 settings 覆盖）
- UI：
  - `/domains` 列表行高亮（已存在；本任务补"SSL 距到期天数"列）
  - 站点详情卡片显示证书状态

**不包含**

- 自动续期
- WHOIS 拉取（除非简单 API 可用时再补）

## 设计要点

- TLS 探测：用 Node `tls.connect({ host, servername, port: 443 })`，超时 10s。
- 多 SAN：取最先匹配的证书 + valid_to。
- 失败处理：抓不到证书也记录 issue（ssl_expires_at=null + 写 audit_findings 一条 warning）。
- 任务粒度：每个 domain 一个 child job，便于失败重试粒度细。

## 涉及文件

```
apps/worker/src/jobs/ssl-domain-expiry.ts
apps/worker/src/jobs/ssl-domain-expiry.test.ts
apps/worker/src/schedulers/ssl-domain-scheduler.ts
packages/services/src/domains/ssl-service.ts
packages/services/src/domains/ssl-service.test.ts
packages/db/src/repositories/domain-repo.ts        # 增加 updateSslInfo
apps/web/components/domains/DomainExpiryBadge.tsx
```

## 验收标准

- [x] 对已过期证书探测能识别为已过期（`ssl-service.test.ts` 模拟探测、`defaultSslProbe` 使用 `rejectUnauthorized:false` 读取 valid_to）
- [x] 普通域名能拿到 NotAfter 与 issuer（同上测试）
- [x] 14 天阈值内触发 alert-fire 事件（`jobs/ssl-domain-expiry.ts` 入栈 `alert-fire`，T16 评估）
- [x] 单测：TLS mock + 阈值判定（`runAll` + `daysUntilSsl`）

## 备注

- Node 自带 tls 模块即可，不依赖外部库。
- 对于在 Cloudflare 后面的站点，证书是 CF 颁发，到期会自动续；保留监控即可。
