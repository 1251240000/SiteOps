# @siteops/error-sdk (placeholder)

The full SDK is intentionally **not** shipped in MVP — managed sites instead post directly to the public ingest endpoint.

## Posting an error

```http
POST /api/v1/errors
Authorization: Bearer <api-key with scope errors:write>
Content-Type: application/json
```

Single report (JSON body):

```json
{
  "siteId": "00000000-0000-0000-0000-000000000000",
  "source": "js",
  "level": "error",
  "message": "TypeError: cannot read properties of undefined",
  "stack": "Error: TypeError\n    at handle (/app/dist/index.js:42:10)",
  "meta": {
    "url": "https://example.com/foo",
    "ua": "Mozilla/5.0",
    "version": "1.2.3"
  }
}
```

Batch reports: wrap the same objects in a JSON array (max 100 items).

The server uses `sha256(source + level + message + simplifiedStack)` as the dedup key. Rapidly repeated identical errors increment `count` rather than allocating new rows.

## Browser snippet

```html
<script>
  window.addEventListener('error', (event) => {
    fetch('https://siteops.example.com/api/v1/errors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer YOUR_API_KEY',
      },
      keepalive: true,
      body: JSON.stringify({
        siteId: 'YOUR_SITE_ID',
        source: 'js',
        level: 'error',
        message: event.message,
        stack: event.error?.stack,
        meta: { url: location.href, ua: navigator.userAgent },
      }),
    }).catch(() => {});
  });
</script>
```

## Worker snippet (Node)

```ts
import { request } from 'node:http';

async function reportError(err: Error) {
  await fetch(process.env.SITEOPS_INGEST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.SITEOPS_API_KEY}`,
    },
    body: JSON.stringify({
      siteId: process.env.SITEOPS_SITE_ID,
      source: 'worker',
      level: 'error',
      message: err.message,
      stack: err.stack,
    }),
  });
}
```

Real SDK packaging (bundled module, source-map upload, breadcrumbs) is out of scope until M5+.
