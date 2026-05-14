'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';

import { AffiliateEntryFormDialog, type AffiliateEntry } from './AffiliateEntryFormDialog';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

function formatDateRange(start: string, end: string): string {
  if (start === end) return start;
  return `${start} → ${end}`;
}

function toNumber(value: string | number | null): number {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Editable list of affiliate entries for a single site.
 *
 * The component owns the entries state with optimistic updates; on
 * server failure the previous list is restored and a toast surfaces the
 * error. Tracks an "edit target" + "delete target" so a single instance
 * of the form / confirm dialogs can be reused across rows.
 */
export function AffiliateEntriesTable({
  siteId,
  initialEntries,
  knownPrograms = [],
  onChange,
}: {
  siteId: string;
  initialEntries: AffiliateEntry[];
  knownPrograms?: readonly string[];
  /** Lifted callback so the parent page can refetch summary / chart. */
  onChange?: () => void;
}) {
  const [entries, setEntries] = useState<AffiliateEntry[]>(initialEntries);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<AffiliateEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AffiliateEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Sync down when the page-level fetch refreshes.
  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.periodStart === b.periodStart) return a.program.localeCompare(b.program);
      return a.periodStart < b.periodStart ? 1 : -1;
    });
  }, [entries]);

  function handleSaved(saved: AffiliateEntry): void {
    setEntries((prev) => {
      const existing = prev.findIndex((e) => e.id === saved.id);
      if (existing === -1) return [saved, ...prev];
      const next = prev.slice();
      next[existing] = saved;
      return next;
    });
    onChange?.();
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    const prev = entries;
    setEntries((rows) => rows.filter((r) => r.id !== deleteTarget.id));
    setDeleting(true);
    try {
      await api.delete(`/revenue/affiliate-entries/${deleteTarget.id}`);
      toast.success('Entry removed');
      setDeleteTarget(null);
      onChange?.();
    } catch (err) {
      // Roll back the optimistic removal.
      setEntries(prev);
      const message = err instanceof ApiError ? err.message : 'Delete failed';
      toast.error(message, {
        description: err instanceof ApiError && err.requestId ? `Req ${err.requestId}` : undefined,
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section aria-label="Affiliate entries" className="space-y-3">
      <header className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Affiliate entries</h2>
          <p className="text-xs text-muted-foreground">
            Manual revenue rows. Each entry is spread evenly across its period in the chart.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditTarget(null);
            setShowForm(true);
          }}
        >
          <Plus className="mr-1 size-4" aria-hidden />
          Add entry
        </Button>
      </header>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No entries yet — add a row above to start tracking affiliate revenue.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Period
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Program
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Amount (USD)
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Original
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Payout
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {sorted.map((row) => (
                <tr key={row.id} className="hover:bg-muted/40">
                  <td className="px-4 py-2 font-mono text-xs">
                    {formatDateRange(row.periodStart, row.periodEnd)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col">
                      <span className="font-medium">{row.program}</span>
                      {row.notes ? (
                        <span className="text-xs text-muted-foreground line-clamp-1">
                          {row.notes}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {usd.format(toNumber(row.amountUsd))}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {row.amountRaw === null
                      ? '—'
                      : `${toNumber(row.amountRaw).toLocaleString()} ${row.currency ?? ''}`.trim()}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {row.payoutDate ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditTarget(row);
                          setShowForm(true);
                        }}
                        aria-label={`Edit ${row.program}`}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(row)}
                        aria-label={`Delete ${row.program}`}
                      >
                        <Trash2 className="size-4 text-destructive" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AffiliateEntryFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        siteId={siteId}
        initial={editTarget}
        knownPrograms={knownPrograms}
        onSaved={handleSaved}
      />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? (
                <>
                  This will permanently remove the {deleteTarget.program} entry covering{' '}
                  {formatDateRange(deleteTarget.periodStart, deleteTarget.periodEnd)} (
                  {usd.format(toNumber(deleteTarget.amountUsd))}).
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
            >
              {deleting ? 'Removing…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
