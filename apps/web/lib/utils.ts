import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class-name concatenator with Tailwind-aware merging.
 * Identical to the helper shipped by `shadcn/ui`; canonical name `cn`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
