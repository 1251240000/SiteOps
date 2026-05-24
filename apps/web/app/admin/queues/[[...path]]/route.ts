/**
 * `GET|POST|PUT /admin/queues/*` — Bull-Board queue management panel (T39).
 *
 * Mounts the `@bull-board/hono` adapter inside a Next.js App Router catch-all
 * so the admin can visually inspect, retry, and clean BullMQ jobs from the
 * browser.
 *
 * Auth: the middleware already gates `/admin/*` behind an active session
 * (see `lib/auth.config.ts:PROTECTED_PREFIXES`). An extra `auth()` check
 * inside the handler prevents direct `fetch()` calls from bypassing the
 * middleware (route handlers are not run through middleware in tests /
 * direct invocations).
 *
 * The panel can be disabled entirely in production by setting
 * `ADMIN_QUEUES_ENABLED=false` — the handler returns a 404 JSON envelope.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { HonoAdapter } from '@bull-board/hono';
import type { MiddlewareHandler } from 'hono';

import { auth } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { ALL_QUEUES, getProducerQueue } from '@/lib/queues';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Custom serveStatic for Node.js (avoids @hono/node-server dependency)
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.html': 'text/html',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

type ServeStaticOptions = {
  root: string;
  rewriteRequestPath?: (path: string) => string;
  manifest?: unknown;
};

function nodeServeStatic(opts: ServeStaticOptions): MiddlewareHandler {
  return async (c, next) => {
    let reqPath = new URL(c.req.url).pathname;
    if (opts.rewriteRequestPath) {
      reqPath = opts.rewriteRequestPath(reqPath);
    }
    // Prevent directory traversal
    const resolved = path.resolve(path.join(process.cwd(), opts.root, reqPath));
    const root = path.resolve(path.join(process.cwd(), opts.root));
    if (!resolved.startsWith(root)) {
      return c.text('Forbidden', 403);
    }
    try {
      const st = await stat(resolved);
      if (!st.isFile()) {
        await next();
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      const contentType = MIME[ext] ?? 'application/octet-stream';
      const body = await readFile(resolved);
      return c.body(body, 200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      });
    } catch {
      await next();
    }
  };
}

// ---------------------------------------------------------------------------
// Bull-Board singleton (created once per cold-start)
// ---------------------------------------------------------------------------

let honoApp: ReturnType<HonoAdapter['registerPlugin']> | undefined;

function getBullBoardApp() {
  if (honoApp) return honoApp;

  const serverAdapter = new HonoAdapter(nodeServeStatic);
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: ALL_QUEUES.map((name) => new BullMQAdapter(getProducerQueue(name))),
    serverAdapter,
  });

  honoApp = serverAdapter.registerPlugin();
  return honoApp;
}

// ---------------------------------------------------------------------------
// Route handler: gate → delegate to Hono app
// ---------------------------------------------------------------------------

async function handler(req: Request): Promise<Response> {
  const env = getEnv();
  if (!env.ADMIN_QUEUES_ENABLED) {
    return Response.json(
      { ok: false, error: { code: 'not_found', message: 'Queue admin panel is disabled' } },
      { status: 404 },
    );
  }

  const session = await auth();
  if (!session?.user) {
    return Response.redirect(new URL('/login', req.url));
  }

  const app = getBullBoardApp();
  return app.fetch(req);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
