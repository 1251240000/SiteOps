'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, FileJson, MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api, ApiError } from '@/lib/api-client';
import { sitesKeys, type Site } from '@/lib/queries/sites';

export function SiteHeaderActions({ site }: { site: Site }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  async function copyId() {
    await navigator.clipboard.writeText(site.id);
    toast.success('Site id copied');
  }
  async function copyJson() {
    await navigator.clipboard.writeText(JSON.stringify(site, null, 2));
    toast.success('Site JSON copied');
  }

  async function onArchive() {
    setArchiving(true);
    try {
      await api.delete<Site>(`/sites/${site.id}`);
      toast.success(`Archived "${site.name}"`);
      await queryClient.invalidateQueries({ queryKey: sitesKeys.lists() });
      await queryClient.invalidateQueries({ queryKey: sitesKeys.detail(site.id) });
      setArchiveOpen(false);
      router.push('/sites');
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Archive failed';
      toast.error(message);
    } finally {
      setArchiving(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Site actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => void copyId()}>
            <Copy className="size-4" /> Copy ID
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyJson()}>
            <FileJson className="size-4" /> Copy JSON
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={site.status === 'archived'}
            onSelect={(e) => {
              e.preventDefault();
              setArchiveOpen(true);
            }}
            className="text-destructive focus:text-destructive"
          >
            <Archive className="size-4" /> Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{site.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Archiving hides the site from the default list but preserves history. You can flip the
              “Show archived” toggle on the list page to find it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiving}
              onClick={(e) => {
                e.preventDefault();
                void onArchive();
              }}
            >
              {archiving ? 'Archiving…' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
