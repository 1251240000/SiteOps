/**
 * Translates the schema-level English tokens emitted by `@siteops/shared`
 * Zod schemas (and a few standard zod fallbacks) into the active dashboard
 * locale via the `common.formErrors.*` catalog.
 *
 * The shared schemas keep raw English messages so the API surface (which is
 * machine-consumed) stays stable; this helper sits in the `useForm`
 * resolver layer so client-side validation can render localized text.
 */
import type { useTranslations } from 'next-intl';

type FormErrorsT = ReturnType<typeof useTranslations<'common.formErrors'>>;

/** Map from the literal `message` strings used by `packages/shared/src/schemas/*` to catalog keys. */
const LITERAL_TO_KEY: Record<string, string> = {
  required: 'required',
  'must be a valid URL': 'invalidUrl',
  'must be a valid UUID': 'invalidUuid',
  'must use https': 'mustUseHttps',
  'must use http or https': 'mustUseHttpHttps',
  'host is not publicly addressable': 'hostNotPublic',
  'host is a private IP range': 'hostPrivateIp',
  'tags must be alphanumeric / dashes': 'tagsAlphanumeric',
  'must be lowercase kebab-case': 'mustBeKebabCase',
  'must be ISO-8601 with timezone': 'mustBeIso8601',
  'must be YYYY-MM-DD': 'mustBeIsoDate',
  'must be ISO-4217 (3 uppercase letters)': 'mustBeIso4217',
  'invalid domain': 'invalidDomain',
};

/**
 * Translates a single zod-emitted message string. Returns the original
 * message if no catalog key matches — keeps unknown errors visible rather
 * than silently swallowing them.
 */
export function translateFormError(
  message: string | undefined,
  t: FormErrorsT,
): string | undefined {
  if (!message) return message;
  const key = LITERAL_TO_KEY[message];
  if (key) {
    // Cast keeps the next-intl key-completeness check happy without
    // duplicating the union of literal keys here.
    return t(key as Parameters<FormErrorsT>[0]);
  }
  return message;
}

/**
 * Walks a react-hook-form `FieldErrors` tree and translates every leaf
 * `message` string in place via {@link translateFormError}.
 */
export function translateFormErrors(
  errors: Record<string, unknown> | undefined,
  t: FormErrorsT,
): void {
  if (!errors) return;
  for (const value of Object.values(errors)) {
    if (!value || typeof value !== 'object') continue;
    const node = value as { message?: unknown };
    if (typeof node.message === 'string') {
      const next = translateFormError(node.message, t);
      if (next !== node.message) node.message = next;
    }
    // Recurse into nested arrays / objects (zod `path: ['tags', 0]`).
    translateFormErrors(value as Record<string, unknown>, t);
  }
}
