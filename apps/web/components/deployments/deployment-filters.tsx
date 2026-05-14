'use client';

import { parseAsString, useQueryState } from 'nuqs';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DEPLOYMENT_PROVIDERS, DEPLOYMENT_STATUS } from '@siteops/shared/constants';

const ANY = '__any__';

export function DeploymentFilters() {
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [provider, setProvider] = useQueryState('provider', parseAsString.withDefault(''));
  const [, setPage] = useQueryState('page', parseAsString.withDefault(''));

  function resetPage() {
    void setPage(null);
  }

  return (
    <section
      aria-label="Deployment filters"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 md:flex-row md:items-end md:gap-4"
    >
      <div className="w-full space-y-1.5 md:w-44">
        <Label htmlFor="deploy-status">Status</Label>
        <Select
          value={status || ANY}
          onValueChange={(v) => {
            void setStatus(v === ANY ? null : v);
            resetPage();
          }}
        >
          <SelectTrigger id="deploy-status">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any status</SelectItem>
            {DEPLOYMENT_STATUS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-full space-y-1.5 md:w-48">
        <Label htmlFor="deploy-provider">Provider</Label>
        <Select
          value={provider || ANY}
          onValueChange={(v) => {
            void setProvider(v === ANY ? null : v);
            resetPage();
          }}
        >
          <SelectTrigger id="deploy-provider">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any provider</SelectItem>
            {DEPLOYMENT_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
