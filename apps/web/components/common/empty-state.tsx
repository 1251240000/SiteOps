import { type LucideIcon, Inbox } from 'lucide-react';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** Lucide icon to render at the top. Defaults to `Inbox`. */
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Optional CTA — typically a `<Button>`. */
  action?: ReactNode;
  className?: string;
}

/** Vertical, centered "nothing to see here" placeholder used by list pages. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 p-10 text-center',
        className,
      )}
      role="status"
    >
      <Icon className="mb-3 size-10 text-muted-foreground" aria-hidden />
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
