# T51 — @siteops/agent SDK 包

- **里程碑**：M12
- **优先级**：P2
- **前置依赖**：T25, T35
- **预估工时**：8 h
- **状态**：Todo

## 目标

发布官方 TypeScript SDK `@siteops/agent`：包封装 claim → heartbeat → complete 循环、指数退避、自动续约、错误上报；外部 Agent 用 10 行代码即可跑起来。

## 范围

**包含**

- 新包 `packages/agent-sdk/`（pnpm workspace 内）：
  - `class TaskClient`：低层 HTTP 客户端，签名 `enqueue / claim / heartbeat / complete / fail`
  - `class Worker`：高层循环，注册 handler by kind，自动处理 claim 间隔、heartbeat、错误捕获
  - 内置指数退避、并发控制、graceful shutdown
- 用 T35 的 OpenAPI spec 自动生成 type definitions（避免手维护）
- 单测：用 `msw` mock /api/v1/tasks/\*
- 文档 `README.md` 含完整 quickstart + advanced 用法
- `examples/` 目录有最小可运行示例
- 发布配置：`npm publish` 友好（exports map、types、README、license）

**不包含**

- Python / Go SDK
- 浏览器端用（仅 Node ≥ 20）

## 设计要点

### 公共 API

```ts
// packages/agent-sdk/src/index.ts
import { Worker, TaskClient } from '@siteops/agent';

const client = new TaskClient({
  baseUrl: 'https://siteops.example/api/v1',
  apiKey: process.env.SITEOPS_KEY!,
});

const worker = new Worker({
  client,
  agentName: 'content-runner-1',
  kinds: ['content.draft'],
  concurrency: 4,
  pollIntervalMs: 5000,
  leaseSeconds: 60,
});

worker.handle('content.draft', async (task, ctx) => {
  // ctx.heartbeat() 在长任务里手动续约
  const draft = await llm.generate(task.payload);
  return { wordCount: draft.length };
});

await worker.start(); // 阻塞到 SIGTERM
```

### Worker 内部

```ts
class Worker {
  async start() {
    this.setupShutdown();
    while (!this.shuttingDown) {
      const free = this.concurrency - this.activeJobs.size;
      if (free <= 0) {
        await sleep(100);
        continue;
      }
      const task = await this.client.claim({ kinds: this.kinds, leaseSeconds: this.leaseSeconds });
      if (!task) {
        await sleep(this.pollIntervalMs);
        continue;
      }
      this.runHandler(task);
    }
    await Promise.all([...this.activeJobs]);
  }

  private async runHandler(task: Task & { claimToken: string }) {
    const handler = this.handlers.get(task.kind);
    if (!handler) {
      await this.client.fail(task.id, {
        claimToken: task.claimToken,
        error: `no handler for ${task.kind}`,
        retry: false,
      });
      return;
    }
    const stopHeartbeat = this.startHeartbeat(task);
    try {
      const result = await handler(task, { heartbeat: () => this.heartbeatOnce(task) });
      await this.client.complete(task.id, { claimToken: task.claimToken, result });
    } catch (err) {
      await this.client.fail(task.id, {
        claimToken: task.claimToken,
        error: String(err),
        retry: true,
      });
    } finally {
      stopHeartbeat();
    }
  }
}
```

- 心跳间隔 = leaseSeconds / 2
- 自动重试连接（HTTP 5xx 指数退避）
- shutdown 时拒绝再 claim，但等待当前 jobs 完成

### Type 生成

```bash
# packages/agent-sdk/scripts/sync-types.sh
pnpm openapi-typescript ../../docs/openapi.json -o src/generated-types.ts
```

主线 export 用包装类型，避免 OpenAPI 生成的丑陋 type 出现在用户视野。

## 涉及文件

```
packages/agent-sdk/                              # 新包
packages/agent-sdk/package.json
packages/agent-sdk/tsconfig.json
packages/agent-sdk/src/index.ts
packages/agent-sdk/src/client.ts
packages/agent-sdk/src/worker.ts
packages/agent-sdk/src/errors.ts
packages/agent-sdk/src/types.ts                  # 包装类型
packages/agent-sdk/src/generated-types.ts        # openapi 生成
packages/agent-sdk/src/__tests__/worker.test.ts  # msw
packages/agent-sdk/README.md
packages/agent-sdk/examples/minimal.ts
packages/agent-sdk/examples/multi-kind.ts
pnpm-workspace.yaml                              # 加包路径
docs/14-agent-sdk.md                             # 文档站位
```

## 验收标准

- [ ] `pnpm --filter @siteops/agent build` 成功
- [ ] examples 目录可 `pnpm tsx examples/minimal.ts` 跑通（接 mock server）
- [ ] 单测：claim → heartbeat → complete 端到端 mock 通过
- [ ] 单测：handler throw → fail with retry=true
- [ ] 单测：no handler for kind → fail with retry=false
- [ ] 单测：SIGTERM 后不再 claim，等待 in-flight 完成
- [ ] README quickstart 复制粘贴可跑
- [ ] `pnpm -r typecheck && lint && test` 全绿
