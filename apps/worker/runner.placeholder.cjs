/* eslint-disable */
/**
 * T02 placeholder worker runner.
 *
 * Keeps the worker container alive (so the prod compose stack can come
 * up green) until T11 (Uptime Checks) lands the real BullMQ scheduler
 * + processor entrypoint in `apps/worker/src/index.ts`.
 *
 * Drop this file (and the corresponding COPY line in `Dockerfile.worker`)
 * once T11 ships the real worker.
 */
const HEARTBEAT_MS = Number(process.env.WORKER_PLACEHOLDER_HEARTBEAT_MS) || 30_000;

let alive = true;

const log = (msg, extra = {}) => {
  console.log(
    JSON.stringify({ level: 'info', msg, service: 'worker', placeholder: true, ...extra }),
  );
};

log('worker placeholder started', { heartbeatMs: HEARTBEAT_MS });

const interval = setInterval(() => {
  if (!alive) return;
  log('worker placeholder heartbeat', { uptimeSec: Math.round(process.uptime()) });
}, HEARTBEAT_MS);

const shutdown = (signal) => {
  alive = false;
  log('worker placeholder shutting down', { signal });
  clearInterval(interval);
  setTimeout(() => process.exit(0), 100).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
