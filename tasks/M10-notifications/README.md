# M10 · 通知与外发

> 把"平台向外发声"的能力补完：邮件真实发送、outbound webhook、错误聚合脱敏。

## 里程碑目标

3 个外发场景：

1. **真实邮件通道**：`emailNotifier` 仍是 stub（仅 console.log）；alert 通道唯一靠 IM，admin 不常驻 IM 时容易漏。
2. **Outbound webhook**：对应已有 inbound 路径的镜像 —— 平台关键事件（部署失败、SSL 即将过期、ROI 跌破阈值）推到用户配置的 URL，闭环监控。
3. **错误聚合脱敏与采样**：站点端 SDK 现状直传 stack；前端 query / token 可能含敏感数据；缺采样会被恶意脚本灌爆。

## 任务清单

| ID                                  | 标题                        | 状态 | 估时 | 前置     |
| ----------------------------------- | --------------------------- | ---- | ---: | -------- |
| [T44](./T44-email-notifier-real.md) | Email 通知器真实化          | ✅   |  5 h | T16      |
| [T45](./T45-outbound-webhook.md)    | Outbound Webhook 通道       | ⬜   | 10 h | T11, T16 |
| [T46](./T46-error-pii-sampling.md)  | 错误聚合 PII 脱敏与采样配置 | ⬜   |  5 h | T15      |

## 数据流

```
[平台事件] ──► event_dispatcher
                ├──► AlertChannel (email/slack/feishu/...)
                │       └─ T44: Email Resend/SMTP 真发
                └──► OutboundWebhook (T45)
                        ├─ outbound_webhook_deliveries (重试 + 退避)
                        └─ 客户 URL 收到 HMAC 签名的 JSON

[站点端 SDK] ──► POST /errors
                ├─ T46: error_configs (drop_patterns, sample_rate)
                └─ errors (脱敏后入库)
```

## 不在 M10 范围

- 站点端 SDK 重写（独立任务，留 v2）
- 邮件模板可视化编辑器
- SMS / Twilio 通道（IM 通道足够，邮件已经补齐）

## 里程碑完成条件

- [ ] 配置 Resend API key 后 alert email 真到收件箱
- [ ] admin 配置一个 outbound webhook URL → 触发 `deployment.failed` → 客户 URL 收到带 `x-siteops-signature` 的 JSON
- [ ] outbound 投递失败按指数退避重试，最多 24h（与 BullMQ 默认对齐）
- [ ] `error_configs.drop_patterns=['(?i)password']` 后 stack 中 password=xxx 被 mask
- [ ] `error_configs.sample_rate=0.1` 后服务端按 10% 接收
- [ ] `pnpm -r typecheck && lint && test` 全绿
