'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { api, ApiError } from '@/lib/api-client';

import { SiteCostsTable, type SiteCostRow } from './SiteCostsTable';

/**
 * Client island that owns the lifecycle of the per-site costs table:
 * fetches the rows, re-fetches after a save / delete, and surfaces
 * errors as toasts. Server-rendering the table is overkill since the
 * data is admin-only and changes interactively.
 */
export function SiteCostsSection({
  siteId,
  initialRows,
}: {
  siteId: string;
  initialRows: SiteCostRow[];
}) {
  const t = useTranslations('pages.roi.costs');
  const [rows, setRows] = useState<SiteCostRow[]>(initialRows);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<SiteCostRow[]>(`/roi/sites/${siteId}/costs`);
      setRows(res.data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('refreshFailed');
      toast.error(message);
    }
  }, [siteId, t]);

  // Re-sync if the parent passes new initialRows (date range change, etc.)
  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  return (
    <SiteCostsTable
      siteId={siteId}
      rows={rows}
      onChange={() => {
        void refresh();
      }}
    />
  );
}
