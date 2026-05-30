type HeaderSource = {
  get(name: string): string | null;
};

type EnvSource = {
  NODE_ENV?: string;
  SITEOPS_PUBLIC_ORIGIN?: string;
  AUTH_URL?: string;
};

function firstHeaderValue(value: string | null | undefined): string | null {
  const first = value?.split(',')[0]?.trim();
  return first ? stripQuotes(first) : null;
}

function stripQuotes(value: string): string {
  return value.replace(/^"|"$/g, '');
}

function normalizeOrigin(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parseForwarded(value: string | null): { proto?: string; host?: string } {
  const first = firstHeaderValue(value);
  if (!first) return {};
  const out: { proto?: string; host?: string } = {};
  for (const part of first.split(';')) {
    const [rawKey, ...rawValue] = part.split('=');
    const key = rawKey?.trim().toLowerCase();
    const nextValue = stripQuotes(rawValue.join('=').trim());
    if (key === 'proto' && nextValue) out.proto = nextValue;
    if (key === 'host' && nextValue) out.host = nextValue;
  }
  return out;
}

function normalizeProto(
  value: string | null | undefined,
  fallback: 'http' | 'https',
): 'http' | 'https' {
  const proto = firstHeaderValue(value)?.replace(/:$/, '').toLowerCase();
  return proto === 'http' || proto === 'https' ? proto : fallback;
}

function normalizeHost(value: string | null | undefined): string | null {
  const host = firstHeaderValue(value);
  if (!host) return null;
  try {
    return new URL(host.includes('://') ? host : `http://${host}`).host;
  } catch {
    return null;
  }
}

export function resolvePublicAppOrigin(
  headers: HeaderSource,
  env: EnvSource = process.env,
): string {
  const configuredOrigin =
    normalizeOrigin(env.SITEOPS_PUBLIC_ORIGIN) ?? normalizeOrigin(env.AUTH_URL);
  if (configuredOrigin) return configuredOrigin;

  const forwarded = parseForwarded(headers.get('forwarded'));
  const defaultProto = env.NODE_ENV === 'production' ? 'https' : 'http';
  const proto = normalizeProto(forwarded.proto ?? headers.get('x-forwarded-proto'), defaultProto);
  const host =
    normalizeHost(forwarded.host) ??
    normalizeHost(headers.get('x-forwarded-host')) ??
    normalizeHost(headers.get('host')) ??
    'localhost:3000';

  return `${proto}://${host}`;
}
