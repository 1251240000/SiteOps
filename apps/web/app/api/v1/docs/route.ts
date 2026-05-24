import { NextResponse } from 'next/server';

import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

const SWAGGER_UI_VERSION = '5.17.14';

/**
 * GET /api/v1/docs — Swagger UI rendered against `/api/v1/openapi.json`.
 *
 * - Production environments return 404 to keep the page out of public
 *   surface area (the spec itself stays available at `/api/v1/openapi.json`).
 * - Dev / staging environments get a minimal HTML scaffold that boots
 *   swagger-ui-dist from unpkg. We serve raw HTML via a route handler
 *   (rather than a `page.tsx`) so Swagger UI can own the entire document
 *   without fighting the dashboard's root layout / globals.css.
 */
export function GET(): Response {
  if (getEnv().NODE_ENV === 'production') {
    return new NextResponse('Not Found', { status: 404 });
  }

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SiteOps API Reference</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css"
    />
    <style>
      body { margin: 0; padding: 0; background: #fafafa; }
      #swagger-ui { max-width: 1280px; margin: 0 auto; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script
      src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js"
      crossorigin="anonymous"
    ></script>
    <script
      src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-standalone-preset.js"
      crossorigin="anonymous"
    ></script>
    <script>
      window.addEventListener('load', function () {
        window.ui = SwaggerUIBundle({
          url: '/api/v1/openapi.json',
          dom_id: '#swagger-ui',
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          layout: 'BaseLayout',
          deepLinking: true,
          displayRequestDuration: true,
          defaultModelsExpandDepth: 0,
        });
      });
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
