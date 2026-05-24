/**
 * Side-effect module: extend the Zod prototype with `.openapi()` so any
 * existing schema can be tagged with OpenAPI metadata (description, example,
 * registered component name) without polluting the shared schema package.
 *
 * Import this module **once** before any code that builds the OpenAPI
 * document; both apps/web runtime and the generator script do so via
 * `lib/openapi/build.ts`.
 */
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export { z };
