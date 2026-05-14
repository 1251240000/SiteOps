'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api-client';
import type { CreateAffiliateEntryInput } from '@siteops/shared';

export type AffiliateEntry = {
  id: string;
  siteId: string;
  periodStart: string;
  periodEnd: string;
  program: string;
  amountUsd: string | number;
  amountRaw: string | number | null;
  currency: string | null;
  payoutDate: string | null;
  notes: string | null;
};

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  /** When set the dialog is in edit mode and posts a PATCH instead. */
  initial?: AffiliateEntry | null;
  /** Called after a successful save with the freshly returned row. */
  onSaved: (entry: AffiliateEntry) => void;
  /** Programs already used by this site (autocomplete suggestions). */
  knownPrograms?: readonly string[];
};

type FormFields = {
  periodStart: string;
  periodEnd: string;
  program: string;
  amountUsd: string;
  amountRaw: string;
  currency: string;
  payoutDate: string;
  notes: string;
};

function toFormValues(entry: AffiliateEntry | null | undefined): FormFields {
  return {
    periodStart: entry?.periodStart ?? '',
    periodEnd: entry?.periodEnd ?? '',
    program: entry?.program ?? '',
    amountUsd: entry ? String(entry.amountUsd) : '',
    amountRaw:
      entry?.amountRaw === null || entry?.amountRaw === undefined ? '' : String(entry.amountRaw),
    currency: entry?.currency ?? '',
    payoutDate: entry?.payoutDate ?? '',
    notes: entry?.notes ?? '',
  };
}

function parseNumeric(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Modal form for creating or editing an affiliate entry.
 *
 * Implementation notes:
 *   - Validation is delegated to the shared `createAffiliateEntrySchema`,
 *     which mirrors the service-side check. We feed the form coerced
 *     numbers / nulls, not raw strings, so the resolver gives us the same
 *     error shape the API would.
 *   - We run as an `AlertDialog` to prevent accidental dismiss-on-outside-
 *     click, which would lose entered data.
 *   - On submit we don't mutate the table directly — we just hand the
 *     freshly-saved entry up to the parent via `onSaved` and let the
 *     parent decide whether to optimistically update or refetch.
 */
export function AffiliateEntryFormDialog({
  open,
  onOpenChange,
  siteId,
  initial,
  onSaved,
  knownPrograms = [],
}: DialogProps) {
  const isEdit = Boolean(initial);
  const [submitting, setSubmitting] = useState(false);
  const programListId = `affiliate-programs-${siteId}`;

  // Note: validation also runs server-side via the same shared schema, so
  // we keep the client-side resolver permissive (form.handleSubmit just
  // gates on required-field presence) and let the API surface field-level
  // errors via toast on submit.
  const form = useForm<FormFields>({
    defaultValues: toFormValues(initial),
    mode: 'onSubmit',
  });
  const { register, handleSubmit, formState, reset } = form;
  const errors = formState.errors as Record<string, { message?: string } | undefined>;

  // Reset the form whenever the dialog re-opens or switches between
  // create/edit. Doing this in an effect keeps render side-effect-free.
  useEffect(() => {
    if (open) reset(toFormValues(initial));
  }, [open, initial, reset]);

  async function onSubmit(values: FormFields): Promise<void> {
    const payload: CreateAffiliateEntryInput = {
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      program: values.program.trim(),
      amountUsd: parseNumeric(values.amountUsd) ?? 0,
      ...(values.amountRaw.trim() !== '' ? { amountRaw: parseNumeric(values.amountRaw) ?? 0 } : {}),
      ...(values.currency.trim() !== '' ? { currency: values.currency.trim().toUpperCase() } : {}),
      ...(values.payoutDate.trim() !== '' ? { payoutDate: values.payoutDate } : {}),
      ...(values.notes.trim() !== '' ? { notes: values.notes.trim() } : {}),
    };
    setSubmitting(true);
    try {
      const saved = isEdit
        ? (
            await api.patch<AffiliateEntry>(
              `/revenue/affiliate-entries/${initial?.id ?? ''}`,
              payload,
            )
          ).data
        : (await api.post<AffiliateEntry>(`/revenue/sites/${siteId}/affiliate-entries`, payload))
            .data;
      toast.success(isEdit ? 'Entry updated' : 'Entry added');
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Save failed';
      toast.error(message, {
        description: err instanceof ApiError && err.requestId ? `Req ${err.requestId}` : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isEdit ? 'Edit affiliate entry' : 'Add affiliate entry'}
          </AlertDialogTitle>
          <p className="text-xs text-muted-foreground">
            Tip: prefer one entry per <span className="font-medium">program</span> per period so
            trends stay readable. Amounts are stored in USD; the original currency fields are
            bookkeeping.
          </p>
        </AlertDialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          noValidate
          aria-busy={submitting}
        >
          <Field label="Program" error={errors.program?.message} required fullWidth>
            <Input
              {...register('program')}
              autoFocus
              autoComplete="off"
              placeholder="Amazon Associates"
              list={knownPrograms.length ? programListId : undefined}
            />
            {knownPrograms.length ? (
              <datalist id={programListId}>
                {knownPrograms.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            ) : null}
          </Field>

          <Field label="Period start" error={errors.periodStart?.message} required>
            <Input type="date" {...register('periodStart')} />
          </Field>
          <Field label="Period end" error={errors.periodEnd?.message} required>
            <Input type="date" {...register('periodEnd')} />
          </Field>

          <Field label="Amount (USD)" error={errors.amountUsd?.message} required>
            <Input
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              {...register('amountUsd')}
            />
          </Field>
          <Field label="Payout date" error={errors.payoutDate?.message}>
            <Input type="date" {...register('payoutDate')} />
          </Field>

          <Field label="Original amount" error={errors.amountRaw?.message}>
            <Input
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              {...register('amountRaw')}
              placeholder="optional"
            />
          </Field>
          <Field label="Currency" error={errors.currency?.message}>
            <Input
              {...register('currency')}
              maxLength={3}
              placeholder="USD"
              className="uppercase"
            />
          </Field>

          <Field label="Notes" error={errors.notes?.message} fullWidth>
            <Textarea rows={2} {...register('notes')} placeholder="optional" />
          </Field>

          <div className="col-span-1 flex items-center justify-end gap-2 sm:col-span-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add entry'}
            </Button>
          </div>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Field({
  label,
  error,
  required,
  fullWidth,
  children,
}: {
  label: string;
  error: string | undefined;
  required?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={fullWidth ? 'sm:col-span-2 space-y-1.5' : 'space-y-1.5'}>
      <Label className="text-xs">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
