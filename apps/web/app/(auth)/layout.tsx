import { type ReactNode } from 'react';

/** Centered, unauthenticated card layout for `/login` and friends. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-2 text-lg font-semibold tracking-tight">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground"
          >
            S
          </span>
          siteops
        </div>
        {children}
      </div>
    </main>
  );
}
