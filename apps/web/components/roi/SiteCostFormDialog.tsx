'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
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

export type SiteCostFormValues = {
  /** `YYYY-MM-01`. */
  month: string;
  hostingUsd: number;
  domainUsd: number;
  contentUsd: number;
  adsSpendUsd: number;
  otherUsd: number;
  notes: string;
};

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  /** When set the dialog is in edit mode. */
  initialValues?: SiteCostFormValues | null;
  /** When `costId` is set we PATCH; otherwise POST. */
  costId?: string | null;
  /** Called after a successful save. */
  onSaved: () => void;
};

type FormFields = {
  month: string;
  hostingUsd: string;
  domainUsd: string;
  contentUsd: string;
  adsSpendUsd: string;
  otherUsd: string;
  notes: string;
};

const HIGH_DOLLAR_THRESHOLD = 10000;

function blankDefaults(): FormFields {
  // Default to the first day of the current month.
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
  return {
    month: `${yyyy}-${mm}-01`,
    hostingUsd: '',
    domainUsd: '',
    contentUsd: '',
    adsSpendUsd: '',
    otherUsd: '',
    notes: '',
  };
}

function toFields(initial: SiteCostFormValues | null | undefined): FormFields {
  if (!initial) return blankDefaults();
  return {
    month: initial.month,
    hostingUsd: initial.hostingUsd ? String(initial.hostingUsd) : '',
    domainUsd: initial.domainUsd ? String(initial.domainUsd) : '',
    contentUsd: initial.contentUsd ? String(initial.contentUsd) : '',
    adsSpendUsd: initial.adsSpendUsd ? String(initial.adsSpendUsd) : '',
    otherUsd: initial.otherUsd ? String(initial.otherUsd) : '',
    notes: initial.notes ?? '',
  };
}

function parseAmount(raw: string): number {
  if (raw.trim() === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Translate an `<input type="month">` value (e.g. `2026-04`) into the
 * `YYYY-MM-01` shape the API expects. Other inputs pass through.
 */
function normaliseMonth(raw: string): string {
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  return raw;
}

function thisMonthFirst(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function isFutureMonth(month: string): boolean {
  // Future = strictly later than the current calendar month (UTC). The
  // current month is allowed (operators can record an in-progress month
  // with an estimate).
  return month > thisMonthFirst();
}

/**
 * Modal form for creating / editing a single `site_costs` row.
 *
 * Implementation notes:
 *   - Validation is light client-side; the service runs the same Zod
 *     schema so the API surfaces the authoritative error text via toast.
 *   - We block future months in the form layer for ergonomics — once
 *     submitted, the API returns 400 anyway.
 *   - A confirm() is shown if any single column exceeds $10k to catch
 *     decimal-point typos before they pollute the dashboard.
 */
export function SiteCostFormDialog({
  open,
  onOpenChange,
  siteId,
  initialValues,
  costId,
  onSaved,
}: DialogProps) {
  const t = useTranslations('pages.roi.costs.form');
  const tCommon = useTranslations('common');
  const isEdit = Boolean(costId);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormFields>({
    defaultValues: toFields(initialValues),
    mode: 'onSubmit',
  });
  const { register, handleSubmit, formState, reset, watch } = form;
  const errors = formState.errors as Record<string, { message?: string } | undefined>;

  useEffect(() => {
    if (open) reset(toFields(initialValues));
  }, [open, initialValues, reset]);

  const watched = watch();
  const total = useMemo(() => {
    return (
      parseAmount(watched.hostingUsd) +
      parseAmount(watched.domainUsd) +
      parseAmount(watched.contentUsd) +
      parseAmount(watched.adsSpendUsd) +
      parseAmount(watched.otherUsd)
    );
  }, [watched]);

  async function onSubmit(values: FormFields): Promise<void> {
    const month = normaliseMonth(values.month);
    if (!/^\d{4}-\d{2}-01$/.test(month)) {
      toast.error(t('errorPickMonth'));
      return;
    }
    if (isFutureMonth(month)) {
      toast.error(t('errorFutureMonth'));
      return;
    }
    const amounts = {
      hostingUsd: parseAmount(values.hostingUsd),
      domainUsd: parseAmount(values.domainUsd),
      contentUsd: parseAmount(values.contentUsd),
      adsSpendUsd: parseAmount(values.adsSpendUsd),
      otherUsd: parseAmount(values.otherUsd),
    };
    const sum =
      amounts.hostingUsd +
      amounts.domainUsd +
      amounts.contentUsd +
      amounts.adsSpendUsd +
      amounts.otherUsd;
    if (sum === 0) {
      toast.error(t('errorAllZero'));
      return;
    }

    const overLimit = Object.entries(amounts).filter(([, v]) => v > HIGH_DOLLAR_THRESHOLD);
    if (overLimit.length > 0 && typeof window !== 'undefined') {
      const cols = overLimit.map(([k]) => k).join(', ');
      const confirmed = window.confirm(
        t('confirmHighDollar', {
          cols,
          threshold: `$${HIGH_DOLLAR_THRESHOLD.toLocaleString()}`,
        }),
      );
      if (!confirmed) return;
    }

    const payload: Record<string, unknown> = {
      ...amounts,
    };
    if (!isEdit) payload.month = month;
    else payload.month = month; // safe to include in PATCH; the API ignores no-op months
    if (values.notes.trim() !== '') payload.notes = values.notes.trim();
    else if (isEdit) payload.notes = null; // explicit clear on edit

    setSubmitting(true);
    try {
      if (isEdit && costId) {
        await api.patch(`/roi/costs/${costId}`, payload);
      } else {
        await api.post(`/roi/sites/${siteId}/costs`, payload);
      }
      toast.success(isEdit ? t('costUpdated') : t('costAdded'));
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('saveFailed');
      toast.error(message, {
        description:
          err instanceof ApiError && err.requestId
            ? tCommon('requestId', { id: err.requestId })
            : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isEdit ? t('titleEdit') : t('titleAdd')}</AlertDialogTitle>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </AlertDialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          noValidate
          aria-busy={submitting}
        >
          <Field label={t('fieldMonth')} error={errors.month?.message} required fullWidth>
            <Input
              type="month"
              {...register('month', {
                setValueAs: (v) => (typeof v === 'string' ? normaliseMonth(v) : v),
              })}
              autoFocus={!isEdit}
              disabled={isEdit}
              max={thisMonthFirst().slice(0, 7)}
            />
            <p className="mt-1 text-xs text-muted-foreground">{t('monthHint')}</p>
          </Field>

          <Field label={t('fieldHosting')} error={errors.hostingUsd?.message}>
            <Input
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              {...register('hostingUsd')}
            />
          </Field>
          <Field label={t('fieldDomain')} error={errors.domainUsd?.message}>
            <Input
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              {...register('domainUsd')}
            />
          </Field>
          <Field label={t('fieldContent')} error={errors.contentUsd?.message}>
            <Input
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              {...register('contentUsd')}
            />
          </Field>
          <Field label={t('fieldAds')} error={errors.adsSpendUsd?.message}>
            <Input
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              {...register('adsSpendUsd')}
            />
          </Field>
          <Field label={t('fieldOther')} error={errors.otherUsd?.message} fullWidth>
            <Input
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              {...register('otherUsd')}
            />
          </Field>

          <Field label={t('fieldNotes')} error={errors.notes?.message} fullWidth>
            <Textarea rows={2} {...register('notes')} placeholder={t('optional')} />
          </Field>

          <div className="col-span-1 flex items-center justify-between gap-2 sm:col-span-2">
            <p className="text-xs text-muted-foreground">
              {t('total')}&nbsp;
              <span className="font-medium text-foreground tabular-nums">${total.toFixed(2)}</span>
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? t('saving') : isEdit ? t('saveChanges') : t('addCost')}
              </Button>
            </div>
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
