/**
 * Convert an AdSense report response into per-domain daily rows, ready for
 * insertion into `adsense_daily`.
 *
 * The report returns headers + rows; metric and dimension positions are
 * resolved by name, so callers don't have to remember column order.
 */

import type { AdSenseReportResponse, AdSenseReportRow } from './client.js';

export type AdSenseDailyRow = {
  date: string;
  domain: string | null;
  earnings: number;
  pageViews: number;
  impressions: number;
  clicks: number;
  rpm: number | null;
  ctr: number | null;
  currencyCode: string;
};

/** Most exchange rates fluctuate — for MVP we ship a flat USD lookup table. */
const FX_TO_USD: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CNY: 0.14,
  JPY: 0.0067,
  KRW: 0.00073,
  AUD: 0.65,
  CAD: 0.74,
  INR: 0.012,
  BRL: 0.2,
};

export function toUsd(value: number, currency: string): number {
  const code = currency.toUpperCase();
  const rate = FX_TO_USD[code] ?? 1;
  return value * rate;
}

function findIndex(headers: { name: string }[] | undefined, name: string): number {
  if (!headers) return -1;
  return headers.findIndex((h) => h.name === name);
}

function asNumber(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asYmd(value: string | undefined): string | null {
  if (!value) return null;
  // AdSense returns dates as `YYYY-MM-DD`.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

export function parseAdSenseReport(report: AdSenseReportResponse): AdSenseDailyRow[] {
  const headers = report.headers ?? [];
  const dateIdx = findIndex(headers, 'DATE');
  const domainIdx = findIndex(headers, 'DOMAIN_NAME');
  const earningsIdx = findIndex(headers, 'ESTIMATED_EARNINGS');
  const pvIdx = findIndex(headers, 'PAGE_VIEWS');
  const impIdx = findIndex(headers, 'IMPRESSIONS');
  const clickIdx = findIndex(headers, 'CLICKS');
  const rpmIdx = findIndex(headers, 'PAGE_VIEWS_RPM');
  const ctrIdx = findIndex(headers, 'IMPRESSIONS_CTR');
  const rows: AdSenseReportRow[] = report.rows ?? [];
  const currencyCode = headers.find((h) => h.currencyCode)?.currencyCode ?? 'USD';

  return rows
    .map((row) => {
      const cells = row.cells ?? [];
      const date = dateIdx >= 0 ? asYmd(cells[dateIdx]?.value) : null;
      if (!date) return null;
      const earnings = asNumber(cells[earningsIdx]?.value);
      return {
        date,
        domain: domainIdx >= 0 ? (cells[domainIdx]?.value ?? null) : null,
        earnings,
        pageViews: pvIdx >= 0 ? asNumber(cells[pvIdx]?.value) : 0,
        impressions: impIdx >= 0 ? asNumber(cells[impIdx]?.value) : 0,
        clicks: clickIdx >= 0 ? asNumber(cells[clickIdx]?.value) : 0,
        rpm: rpmIdx >= 0 ? asNumber(cells[rpmIdx]?.value) : null,
        ctr: ctrIdx >= 0 ? asNumber(cells[ctrIdx]?.value) : null,
        currencyCode,
      } satisfies AdSenseDailyRow;
    })
    .filter((r): r is AdSenseDailyRow => r !== null);
}
