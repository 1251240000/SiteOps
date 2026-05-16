'use client';

import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface DataTableProps<TData, TValue> {
  data: TData[];
  columns: ColumnDef<TData, TValue>[];
  /** Initial page size; default 10. */
  pageSize?: number;
  /** Stringified empty-state shown when the dataset is empty. */
  emptyMessage?: string;
  className?: string;
  /**
   * Optional per-row class. Receives the unwrapped row data so callers
   * can tint e.g. negative-ROI rows red without copy-pasting the whole
   * table chrome.
   */
  rowClassName?: (row: TData) => string | undefined;
}

/**
 * Sorted + paginated table built on TanStack Table v8.
 *
 * Filter / URL-state syncing lands in T08 when the real `sites` table needs
 * to share filters across reloads. This component intentionally stays
 * "controlled by props" so unit tests stay trivial.
 */
export function DataTable<TData, TValue>({
  data,
  columns,
  pageSize = 10,
  emptyMessage,
  className,
  rowClassName,
}: DataTableProps<TData, TValue>) {
  const tCommon = useTranslations('common');
  const tPagination = useTranslations('common.pagination');
  const resolvedEmpty = emptyMessage ?? tCommon('noResults');
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const total = data.length;
  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();
  const startRow = total === 0 ? 0 : pageIndex * pageSize + 1;
  const endRow = Math.min(total, (pageIndex + 1) * pageSize);

  return (
    <div className={cn('space-y-3', className)}>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  const SortIcon =
                    sortDir === 'asc' ? ArrowUp : sortDir === 'desc' ? ArrowDown : ArrowUpDown;
                  return (
                    <th key={header.id} scope="col" className="px-4 py-3 text-left font-medium">
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          aria-label={tCommon('sortBy', { column: String(header.column.id) })}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <SortIcon className="size-3" aria-hidden />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  {resolvedEmpty}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className={cn('hover:bg-muted/40', rowClassName?.(row.original))}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          {total === 0
            ? tPagination('noRows')
            : tPagination('showing', { from: startRow, to: endRow, total })}
        </span>
        <div className="flex items-center gap-2">
          <span>
            {tPagination.rich('page', {
              page: pageIndex + 1,
              total: Math.max(1, pageCount),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </span>
          <Button
            size="icon"
            variant="outline"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label={tPagination('previous')}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label={tPagination('next')}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
