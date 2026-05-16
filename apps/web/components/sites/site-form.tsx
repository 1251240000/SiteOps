'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  ADSENSE_STATUS,
  ANALYTICS_PROVIDERS,
  REPO_PROVIDERS,
  SITE_STATUS,
  SITE_TYPES,
} from '@siteops/shared/constants';
import {
  createSiteSchema,
  type CreateSiteInput,
  updateSiteSchema,
  type UpdateSiteInput,
} from '@siteops/shared/schemas';
import { api, ApiError } from '@/lib/api-client';
import { translateFormErrors } from '@/lib/i18n/zod-form-errors';
import { sitesKeys, type Site } from '@/lib/queries/sites';

const NULL_VALUE = '__none__';

type SiteFormProps = { mode: 'create'; initial?: undefined } | { mode: 'edit'; initial: Site };

type FormFields = CreateSiteInput;

function siteToFormDefaults(site: Site): FormFields {
  return {
    name: site.name,
    primaryUrl: site.primaryUrl,
    siteType: site.siteType,
    status: site.status,
    targetCountry: site.targetCountry ?? undefined,
    targetLanguage: site.targetLanguage ?? undefined,
    techStack: site.techStack ?? undefined,
    repoUrl: site.repoUrl ?? undefined,
    repoProvider: site.repoProvider ?? undefined,
    cfAccountId: site.cfAccountId ?? undefined,
    cfPagesProject: site.cfPagesProject ?? undefined,
    analyticsProvider: site.analyticsProvider ?? undefined,
    analyticsId: site.analyticsId ?? undefined,
    searchConsoleProperty: site.searchConsoleProperty ?? undefined,
    adsensePublisherId: site.adsensePublisherId ?? undefined,
    adsenseStatus: site.adsenseStatus ?? undefined,
    tags: site.tags ?? [],
    notes: site.notes ?? undefined,
  };
}

const blankDefaults: FormFields = {
  name: '',
  primaryUrl: '',
  siteType: 'tool',
  status: 'active',
  tags: [],
};

export function SiteForm(props: SiteFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('pages.sites.form');
  const tCommon = useTranslations('common');
  const tFormErrors = useTranslations('common.formErrors');
  const tEnumStatus = useTranslations('enums.siteStatus');
  const tEnumType = useTranslations('enums.siteType');
  const [submitting, setSubmitting] = useState(false);

  const schema = props.mode === 'create' ? createSiteSchema : updateSiteSchema;
  const defaults: FormFields =
    props.mode === 'edit' ? siteToFormDefaults(props.initial) : blankDefaults;

  const resolver = useMemo<Resolver<FormFields>>(() => {
    const base = zodResolver(schema) as Resolver<FormFields>;
    return async (values, context, options) => {
      const result = await base(values, context, options);
      translateFormErrors(result.errors as Record<string, unknown> | undefined, tFormErrors);
      return result;
    };
  }, [schema, tFormErrors]);

  const form = useForm<FormFields>({
    resolver,
    defaultValues: defaults,
    mode: 'onBlur',
  });
  const { register, handleSubmit, formState, setValue, watch } = form;
  const errors = formState.errors;

  // Comma-separated tag input ↔ string[].
  const tagsValue = watch('tags') ?? [];
  const [tagsDraft, setTagsDraft] = useState(tagsValue.join(', '));

  function onTagsBlur() {
    const parsed = tagsDraft
      .split(/[,\n]/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    setValue('tags', Array.from(new Set(parsed)), { shouldDirty: true });
  }

  async function onSubmit(values: FormFields) {
    setSubmitting(true);
    try {
      if (props.mode === 'create') {
        const { data: site } = await api.post<Site>('/sites', values);
        toast.success(t('createdToast', { name: site.name }));
        await queryClient.invalidateQueries({ queryKey: sitesKeys.lists() });
        router.push(`/sites/${site.id}`);
      } else {
        const patch: UpdateSiteInput = values;
        const { data: site } = await api.patch<Site>(`/sites/${props.initial.id}`, patch);
        toast.success(t('updatedToast', { name: site.name }));
        await queryClient.invalidateQueries({ queryKey: sitesKeys.lists() });
        await queryClient.invalidateQueries({
          queryKey: sitesKeys.detail(props.initial.id),
        });
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : tCommon('saveFailed');
      toast.error(message, {
        description: err instanceof ApiError && err.requestId ? `Req ${err.requestId}` : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate aria-busy={submitting}>
      <Card>
        <CardHeader>
          <CardTitle>{t('sectionBasics')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label={t('fieldName')} error={errors.name?.message}>
            <Input {...register('name')} autoFocus />
          </Field>
          <Field label={t('fieldPrimaryUrl')} error={errors.primaryUrl?.message}>
            <Input {...register('primaryUrl')} placeholder={t('fieldPrimaryUrlPlaceholder')} />
          </Field>
          <Field label={t('fieldSiteType')} error={errors.siteType?.message}>
            <Select
              value={watch('siteType')}
              onValueChange={(v) =>
                setValue('siteType', v as FormFields['siteType'], { shouldDirty: true })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SITE_TYPES.map((siteTypeKey) => (
                  <SelectItem key={siteTypeKey} value={siteTypeKey}>
                    {tEnumType(siteTypeKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('fieldStatus')} error={errors.status?.message}>
            <Select
              value={watch('status')}
              onValueChange={(v) =>
                setValue('status', v as FormFields['status'], { shouldDirty: true })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SITE_STATUS.map((statusKey) => (
                  <SelectItem key={statusKey} value={statusKey}>
                    {tEnumStatus(statusKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('fieldTargetCountry')} error={errors.targetCountry?.message}>
            <Input
              {...register('targetCountry')}
              placeholder={t('fieldTargetCountryPlaceholder')}
            />
          </Field>
          <Field label={t('fieldTargetLanguage')} error={errors.targetLanguage?.message}>
            <Input
              {...register('targetLanguage')}
              placeholder={t('fieldTargetLanguagePlaceholder')}
            />
          </Field>
          <Field
            label={t('fieldTags')}
            error={errors.tags?.message as string | undefined}
            fullWidth
          >
            <Input
              value={tagsDraft}
              onChange={(e) => setTagsDraft(e.target.value)}
              onBlur={onTagsBlur}
              placeholder={t('fieldTagsPlaceholder')}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('sectionTechRepo')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label={t('fieldFramework')} error={undefined}>
            <Input
              defaultValue={defaults.techStack?.framework ?? ''}
              onChange={(e) =>
                setValue(
                  'techStack',
                  {
                    ...(watch('techStack') ?? {}),
                    framework: e.target.value || undefined,
                  },
                  { shouldDirty: true },
                )
              }
            />
          </Field>
          <Field label={t('fieldHosting')} error={undefined}>
            <Input
              defaultValue={defaults.techStack?.hosting ?? ''}
              onChange={(e) =>
                setValue(
                  'techStack',
                  {
                    ...(watch('techStack') ?? {}),
                    hosting: e.target.value || undefined,
                  },
                  { shouldDirty: true },
                )
              }
            />
          </Field>
          <Field label={t('fieldRepoUrl')} error={errors.repoUrl?.message}>
            <Input {...register('repoUrl')} placeholder={t('fieldRepoUrlPlaceholder')} />
          </Field>
          <Field label={t('fieldRepoProvider')} error={errors.repoProvider?.message}>
            <NullableEnumSelect
              value={watch('repoProvider')}
              options={REPO_PROVIDERS}
              onChange={(v) =>
                setValue('repoProvider', v as FormFields['repoProvider'], { shouldDirty: true })
              }
              noneLabel={tCommon('noneOption')}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('sectionIntegrations')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label={t('fieldCfAccountId')} error={errors.cfAccountId?.message}>
            <Input {...register('cfAccountId')} />
          </Field>
          <Field label={t('fieldCfPagesProject')} error={errors.cfPagesProject?.message}>
            <Input {...register('cfPagesProject')} />
          </Field>
          <Field label={t('fieldAnalyticsProvider')} error={errors.analyticsProvider?.message}>
            <NullableEnumSelect
              value={watch('analyticsProvider')}
              options={ANALYTICS_PROVIDERS}
              onChange={(v) =>
                setValue('analyticsProvider', v as FormFields['analyticsProvider'], {
                  shouldDirty: true,
                })
              }
              noneLabel={tCommon('noneOption')}
            />
          </Field>
          <Field label={t('fieldAnalyticsId')} error={errors.analyticsId?.message}>
            <Input {...register('analyticsId')} placeholder={t('fieldAnalyticsIdPlaceholder')} />
          </Field>
          <Field
            label={t('fieldSearchConsoleProperty')}
            error={errors.searchConsoleProperty?.message}
          >
            <Input
              {...register('searchConsoleProperty')}
              placeholder={t('fieldSearchConsolePropertyPlaceholder')}
            />
          </Field>
          <Field label={t('fieldAdsensePublisherId')} error={errors.adsensePublisherId?.message}>
            <Input
              {...register('adsensePublisherId')}
              placeholder={t('fieldAdsensePublisherIdPlaceholder')}
            />
          </Field>
          <Field label={t('fieldAdsenseStatus')} error={errors.adsenseStatus?.message}>
            <NullableEnumSelect
              value={watch('adsenseStatus')}
              options={ADSENSE_STATUS}
              onChange={(v) =>
                setValue('adsenseStatus', v as FormFields['adsenseStatus'], {
                  shouldDirty: true,
                })
              }
              noneLabel={tCommon('noneOption')}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('sectionNotes')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea rows={4} {...register('notes')} />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={submitting}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting
            ? tCommon('saving')
            : props.mode === 'create'
              ? t('submitCreate')
              : t('submitUpdate')}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  fullWidth,
  children,
}: {
  label: string;
  error: string | undefined;
  fullWidth?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={fullWidth ? 'md:col-span-2 space-y-1.5' : 'space-y-1.5'}>
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function NullableEnumSelect({
  value,
  options,
  onChange,
  noneLabel,
}: {
  value: string | undefined;
  options: readonly string[];
  onChange: (value: string | undefined) => void;
  noneLabel: string;
}) {
  return (
    <Select
      value={value ?? NULL_VALUE}
      onValueChange={(v) => onChange(v === NULL_VALUE ? undefined : v)}
    >
      <SelectTrigger>
        <SelectValue placeholder={noneLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NULL_VALUE}>{noneLabel}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>
            {opt}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
