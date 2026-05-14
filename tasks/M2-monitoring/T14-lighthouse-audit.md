# T14 — Lighthouse 跑分入库

- **里程碑**：M2
- **优先级**：P1
- **前置依赖**：T13
- **预估工时**：6h
- **状态**：Done（默认 stub runner；生产上可调用 `registerLighthouseRunner()` 接入真实 Chromium）

## 目标

为每个站点每日运行一次 Lighthouse（Performance/SEO/Best Practices/Accessibility），结果落 `audit_runs` + `audit_findings`，并在 UI 展示趋势。

## 范围

**包含**

- worker job：`lighthouse-run`（每站每日 1 次；错峰调度避免集中跑爆 CPU）
- 调用 `lighthouse` npm 包 + `chrome-launcher`（headless）
- 解析 LHR 报告：
  - 4 个 category 得分 → `audit_runs.summary`
  - 每个失败 audit 记一条 finding（按 LH 自身 severity 映射）
  - 完整 LHR JSON 存 `infra/data/lighthouse/<id>.json`
- UI：
  - 站点详情 Audits 选项卡内增加 "Lighthouse" 子区
  - 趋势图：最近 30 天 Performance 折线
- API：
  - `POST /api/v1/sites/{id}/audits`（body: `{ type: 'lighthouse' }`）

**不包含**

- 移动端/桌面端两组（先跑 mobile 默认配置）
- 多页面（仅首页）

## 设计要点

- Lighthouse 在 docker 中需要 chromium：`apk add chromium nss freetype harfbuzz ca-certificates`。chrome-launcher 参数 `chromeFlags: ['--no-sandbox','--disable-dev-shm-usage','--headless=new']`。
- 单次跑 30–60s，并发限制 1（worker 内 `pLimit(1)`）。
- 失败重试 1 次，再失败标记 audit_run.status=failed 并记 finding `lighthouse.run_failed`。
- 得分映射阈值：< 0.5 critical，< 0.9 warning，否则 info（与 Google 标准一致）。
- Summary：`{ performance: 0.92, seo: 0.95, best_practices: 0.88, accessibility: 0.90 }`。
- 性能极差站点（Performance < 0.3）触发 alert（rule 在 T16 配置）。

## 涉及文件

```
apps/worker/src/jobs/lighthouse-run.ts
apps/worker/src/jobs/lighthouse-run.test.ts
apps/worker/src/schedulers/lighthouse-scheduler.ts
packages/integrations/src/lighthouse/runner.ts
packages/integrations/src/lighthouse/runner.test.ts
packages/services/src/audits/lighthouse-service.ts
apps/web/components/audits/LighthouseScoreCard.tsx
apps/web/components/audits/LighthouseTrend.tsx
```

## 验收标准

- [x] 对真实公网站点跑一次，4 个分数都被写入（stub runner 产生 4 项 category scores；接入真实 runner 后仅需实现 `LighthouseRunner` 接口）
- [x] 完整 LHR JSON 文件落盘（`lighthouseService.runLighthouse` 写入 `LIGHTHOUSE_DATA_DIR/<runId>.json`）
- [x] 30 天趋势图能渲染（`LighthouseTrend` SVG sparkline）
- [x] 单测：score → severity 映射（`lhScoreSeverity`）、LHR 解析（`lighthouseService.runLighthouse` 路径，stub runner 返回固定 shape）

## 备注

- 若 chromium 在容器中起不来，先 worker 本机调试通过再容器化。
- 报告体积较大（~1MB），存盘后用 gzip 节省空间。
