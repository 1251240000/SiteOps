'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { SiteCostFormDialog, type SiteCostFormValues } from './SiteCostFormDialog';

export type SiteCostRow = {
  id: string;
  siteId: string;
  month: string;
  hostingUsd: string | number;
  domainUsd: string | number;
  contentUsd: string | number;
  adsSpendUsd: string | number;
  otherUsd: string | number;
  notes: string | null;
};

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

function n(v: string | number): number {
  return typeof v === 'number' ? v : Number(v);
}

function fmtMonth(month: string): string {
  // month is `YYYY-MM-01`. Render as e.g. "Mar 2026".
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Per-site costs table with inline edit / delete. Cost create + edit
 * round-trips through the same `SiteCostFormDialog`. Delete uses a
 * native `confirm()` for MVP — we'll upgrade to AlertDialog in M5 if
 * accidental deletes become an issue.
 */
export function SiteCostsTable({
  siteId,
  rows,
  onChange,
}: {
  siteId: string;
  rows: SiteCostRow[];
  onChange: () => void;
}) {
  const t = useTranslations('pages.roi.costs');
  const [editing, setEditing] = useState<SiteCostFormValues | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startCreate() {
    setEditing(null);
    setEditingId(null);
    setOpen(true);
  }

  function startEdit(row: SiteCostRow) {
    setEditing({
      month: row.month,
      hostingUsd: n(row.hostingUsd),
      domainUsd: n(row.domainUsd),
      contentUsd: n(row.contentUsd),
      adsSpendUsd: n(row.adsSpendUsd),
      otherUsd: n(row.otherUsd),
      notes: row.notes ?? '',
    });
    setEditingId(row.id);
    setOpen(true);
  }

  async function handleDelete(row: SiteCostRow) {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(t('deleteConfirm', { month: fmtMonth(row.month) }))
    ) {
      return;
    }
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/roi/costs/${row.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('deleteFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t('monthlyCosts')}</h3>
        <Button size="sm" onClick={startCreate}>
          {t('addCost')}
        </Button>
      </div>

      {error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">{t('colMonth')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('colHosting')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('colDomain')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('colContent')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('colAds')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('colOther')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('colTotal')}</th>
              <th className="px-4 py-2 text-right font-medium" aria-label={t('rowActionsAria')} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const total =
                  n(r.hostingUsd) +
                  n(r.domainUsd) +
                  n(r.contentUsd) +
                  n(r.adsSpendUsd) +
                  n(r.otherUsd);
                return (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2 font-medium">{fmtMonth(r.month)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {usd.format(n(r.hostingUsd))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {usd.format(n(r.domainUsd))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {usd.format(n(r.contentUsd))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {usd.format(n(r.adsSpendUsd))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {usd.format(n(r.otherUsd))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">
                      {usd.format(total)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => startEdit(r)}
                          disabled={busy === r.id}
                          aria-label={t('editAria', { month: fmtMonth(r.month) })}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDelete(r)}
                          disabled={busy === r.id}
                          aria-label={t('deleteAria', { month: fmtMonth(r.month) })}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <SiteCostFormDialog
        open={open}
        onOpenChange={setOpen}
        siteId={siteId}
        initialValues={editing}
        costId={editingId}
        onSaved={() => {
          setOpen(false);
          onChange();
        }}
      />
    </section>
  );
}
