# T44 — Email 通知器真实化

- **里程碑**：M10
- **优先级**：P1
- **前置依赖**：T16
- **预估工时**：5 h
- **状态**：Done

## 目标

把 `emailNotifier` 从 console.log stub 升级为真实可用通道，支持 Resend 与 SMTP 两种 transport（env 切换），与已有 Notifier 接口零破坏对接。

## 范围

**包含**

- env 增加：`EMAIL_PROVIDER`（`resend` | `smtp` | `disabled`）、`EMAIL_FROM`、`RESEND_API_KEY` / `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_TLS`
- 改造 `packages/integrations/src/notifiers/email.ts`：
  - 注入式 transport，每个 transport 是一个 `(from, to, subject, html, text) => Promise<void>`
  - 三种实现：resend / nodemailer-smtp / disabled (复用现 stub log)
- 简单 HTML 模板：复用现 `alert.ruleName / message / detailsUrl` shape，渲染最小可读 email body
- 集成测：mock transport 验证 to/from/subject/body 形态
- 不破坏现有 `alert-channel` 表结构与 service 调用约定

**不包含**

- 模板可视化编辑（直接代码内字符串模板）
- DKIM / SPF / DMARC 配置（属 ops 范畴，文档说明即可）

## 设计要点

### Transport 接口

```ts
// integrations/src/notifiers/email-transport.ts
export type EmailTransport = (msg: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}) => Promise<void>;

export function createResendTransport(apiKey: string): EmailTransport {
  /* fetch https://api.resend.com/emails */
}
export function createSmtpTransport(opts: SmtpOpts): EmailTransport {
  /* nodemailer */
}
export const noopEmailTransport: EmailTransport = async (msg) => {
  console.log(`[email-disabled] would send "${msg.subject}" to ${msg.to.join(', ')}`);
};
```

### 注入

```ts
// notifiers/email.ts
import { getEmailTransport } from './email-transport-factory.js';

export const emailNotifier: Notifier = async ({ alert, config }) => {
  const cfg = config as EmailConfig;
  const to = Array.isArray(cfg.to) ? cfg.to : [cfg.to];
  if (to.length === 0) return { ok: false, error: 'missing to' };
  const transport = getEmailTransport(); // 读 env，进程级缓存
  const subject = `${cfg.subjectPrefix ?? '[siteops]'} ${alert.ruleName}`;
  await transport({
    from: process.env.EMAIL_FROM ?? 'siteops@example.com',
    to,
    subject,
    html: renderHtml(alert),
    text: renderText(alert),
  });
  return { ok: true };
};
```

### Resend HTTP 调用

```ts
function createResendTransport(apiKey: string): EmailTransport {
  return async (msg) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(msg),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  };
}
```

- nodemailer 走 npm 包；只在 SMTP 模式下 dynamic import 以节省 web bundle
- 失败抛错让 `alert-fire` worker 走 BullMQ retry

## 涉及文件

```
packages/integrations/src/notifiers/email.ts                    # 重写
packages/integrations/src/notifiers/email-transport.ts          # 新
packages/integrations/src/notifiers/email-transport-factory.ts  # 新（env 切换）
packages/integrations/src/notifiers/__tests__/email.test.ts     # 重写
packages/integrations/package.json                              # +nodemailer optional
apps/web/lib/env.ts                                              # +EMAIL_* 变量
apps/worker/src/env.ts                                           # 同上
.env.example                                                     # 加注释
docs/03-data-model.md                                            # alert_channels.config.email 说明
```

## 验收标准

- [ ] env `EMAIL_PROVIDER=disabled` 默认行为等同现 stub（log 而不发）
- [ ] env `EMAIL_PROVIDER=resend` + 有效 API key → 调用 Resend API（用 nock / msw mock 验证 HTTP shape）
- [ ] env `EMAIL_PROVIDER=smtp` → 调用 nodemailer（mock createTransport）
- [ ] 失败抛错由 alert-fire worker BullMQ 自动重试 3 次
- [ ] subject / body 包含 `alert.ruleName / message`，HTML 经简单 XSS escape
- [ ] `pnpm -r typecheck && lint && test` 全绿
