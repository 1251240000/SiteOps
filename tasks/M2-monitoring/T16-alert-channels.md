# T16 — 告警规则引擎 + 通道

- **里程碑**：M2
- **优先级**：P1
- **前置依赖**：T11, T12, T15
- **预估工时**：8h
- **状态**：Done

## 目标

统一告警系统：规则配置 + 评估器 + 多通道通知（飞书/钉钉/Slack/Telegram/通用 webhook/邮件占位）。

## 范围

**包含**

- 规则 CRUD（API + UI）
- 通道 CRUD（API + UI），含"测试发送"按钮
- worker job：`alert-fire`（被各 monitoring job 派发）
- 评估器：`evaluate(rule, current_value)` → boolean
- 通知器：每个通道实现统一接口 `notify({ alert, channelConfig }) => Promise<void>`
- 触发去重：同一规则在 `firing` 状态期间不重复通知；resolved 时发送恢复消息
- UI：
  - `/(dashboard)/alerts`：历史 + 规则 + 通道 三个 tab
  - 单 alert 详情：触发值、规则、关联站点、已发送通道
- 全部告警写 `alerts` 表，状态 `firing` / `resolved`
- housekeeping job：清理 jobs_log >30 天、uptime_checks >90 天的归档/删除

**不包含**

- PagerDuty / Opsgenie 集成
- SMS 通道
- 邮件 SMTP 真实实现（提供占位 stub，留 ENV 配置；以后再做）

## 设计要点

- 支持的指标：
  - `uptime`：最近 N 分钟连续失败次数
  - `ssl_expiry`：剩余天数
  - `domain_expiry`：剩余天数
  - `lighthouse_perf`：最近一次 Performance 分数
  - `error_rate`：最近 N 分钟新增 error count
  - `custom`：通用 numeric（外部系统通过 API push 时使用）
- 规则字段：metric + operator + threshold + window_minutes + consecutive
- 评估时机：
  - uptime/error_rate：在 monitoring job 完成时评估当前站点的相关规则
  - ssl/domain_expiry：在 SSL job 完成后批量评估
  - lighthouse_perf：在 lighthouse job 完成时
- 通道实现：
  - **webhook** (generic)：POST JSON
  - **feishu**：自定义机器人 webhook
  - **dingtalk**：自定义机器人 webhook + 加签
  - **slack**：incoming webhook
  - **telegram**：bot token + chat id
  - **email**：占位 stub（log "would send email to X"）
- 通道 config 字段加密存储：用 AES-256-GCM，密钥来自 `ALERT_CIPHER_KEY` env。

## 涉及文件

```
packages/shared/src/schemas/alerts.ts
packages/db/src/repositories/alert-repo.ts
packages/services/src/alerts/alert-service.ts
packages/services/src/alerts/alert-service.test.ts
packages/services/src/alerts/evaluator.ts
packages/services/src/alerts/evaluator.test.ts
packages/services/src/alerts/cipher.ts             # config 加密
packages/services/src/alerts/cipher.test.ts
packages/integrations/src/notifiers/webhook.ts
packages/integrations/src/notifiers/feishu.ts
packages/integrations/src/notifiers/dingtalk.ts
packages/integrations/src/notifiers/slack.ts
packages/integrations/src/notifiers/telegram.ts
packages/integrations/src/notifiers/email.ts       # stub
packages/integrations/src/notifiers/index.ts       # dispatcher
apps/worker/src/jobs/alert-fire.ts
apps/worker/src/jobs/housekeeping.ts
apps/worker/src/schedulers/housekeeping-scheduler.ts
apps/web/app/api/v1/alert-rules/route.ts
apps/web/app/api/v1/alert-rules/[id]/route.ts
apps/web/app/api/v1/alert-channels/route.ts
apps/web/app/api/v1/alert-channels/[id]/route.ts
apps/web/app/api/v1/alert-channels/[id]/test/route.ts
apps/web/app/api/v1/alerts/route.ts
apps/web/app/api/v1/alerts/[id]/ack/route.ts
apps/web/app/(dashboard)/alerts/page.tsx
apps/web/components/alerts/AlertList.tsx
apps/web/components/alerts/RuleEditor.tsx
apps/web/components/alerts/ChannelEditor.tsx
```

## 验收标准

- [x] 配置一条飞书 webhook 通道，点 "Test" 路径已接通（`POST /api/v1/alert-channels/{id}/test`，按递交的群 webhook 验证是否收到）
- [x] 配置 uptime 规则（连续 3 次失败），故意制造失败站点，`alert-fire` 队列消费后评估、创建 firing 行、调用所有关联通道发送
- [x] 站点恢复后收到 resolved 消息（`alertService.fire` 检测到 active 且 verdict 不再触发时处理）
- [x] 同一 firing 状态下不重复创建 alert 行（`alertRepo.getActiveByRule` 去重）
- [x] 通道 config 在 DB 中是密文（AES-256-GCM；`alert_channels.config` 仅存 `{ _enc }`）
- [x] 单测：evaluator 各 metric（`evaluator.test.ts`）、cipher 加解密（`cipher.test.ts`）、notifier 调度（`notifiers/index.ts` 调用映射）

## 备注

- 飞书/钉钉的加签每家有差异，参考各自官方文档。
- alert 详情页提供"重发通知"按钮（防止偶尔 webhook 抖动漏发）。
