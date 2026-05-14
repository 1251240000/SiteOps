import { describe, expect, it } from 'vitest';

import { assertOutboundUrl, validateOutboundUrl } from '../utils/ssrf.js';

describe('validateOutboundUrl', () => {
  it('accepts public https URLs', () => {
    expect(validateOutboundUrl('https://example.com').ok).toBe(true);
    expect(validateOutboundUrl('https://api.example.com/status?x=1').ok).toBe(true);
    expect(validateOutboundUrl('http://example.com').ok).toBe(true);
  });

  it('rejects non-http(s) schemes', () => {
    expect(validateOutboundUrl('file:///etc/passwd')).toEqual({
      ok: false,
      reason: 'scheme_not_allowed',
    });
    expect(validateOutboundUrl('gopher://example.com')).toEqual({
      ok: false,
      reason: 'scheme_not_allowed',
    });
  });

  it('rejects loopback hostnames', () => {
    expect(validateOutboundUrl('http://localhost').ok).toBe(false);
    expect(validateOutboundUrl('http://api.localhost').ok).toBe(false);
    expect(validateOutboundUrl('http://service.local').ok).toBe(false);
    expect(validateOutboundUrl('http://docker.internal').ok).toBe(false);
  });

  it('rejects private IPv4 ranges', () => {
    for (const url of [
      'http://127.0.0.1',
      'http://10.1.2.3',
      'http://172.16.0.1',
      'http://192.168.1.1',
      'http://169.254.169.254', // AWS IMDS
      'http://0.0.0.0',
    ]) {
      const res = validateOutboundUrl(url);
      expect(res.ok, `${url} should be blocked`).toBe(false);
    }
  });

  it('rejects IPv6 loopback / ULA / link-local', () => {
    expect(validateOutboundUrl('http://[::1]/').ok).toBe(false);
    expect(validateOutboundUrl('http://[fe80::1]/').ok).toBe(false);
    expect(validateOutboundUrl('http://[fc00::1]/').ok).toBe(false);
    expect(validateOutboundUrl('http://[fd12::1]/').ok).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(validateOutboundUrl('not a url').ok).toBe(false);
    expect(validateOutboundUrl('://').ok).toBe(false);
  });
});

describe('assertOutboundUrl', () => {
  it('throws with ssrf_blocked:<reason> on private hosts', () => {
    expect(() => assertOutboundUrl('http://127.0.0.1')).toThrow(/ssrf_blocked:private_ipv4/);
    expect(() => assertOutboundUrl('http://localhost')).toThrow(/ssrf_blocked:forbidden_host/);
  });

  it('does not throw for public hosts', () => {
    expect(() => assertOutboundUrl('https://example.com')).not.toThrow();
  });
});
