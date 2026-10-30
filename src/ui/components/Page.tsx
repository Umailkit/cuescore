import type { ReactNode } from 'react';
import { Container } from './Container';
import { BottomNav } from './BottomNav';

export function Page({
  title,
  action,
  hideNav = false,
  children,
}: {
  title?: string;
  action?: ReactNode;
  /** Hide the bottom navigation (used by the full-screen match workspace). */
  hideNav?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
        <Container className="flex h-14 items-center justify-between">
          <span className="font-semibold tracking-tight">{title ?? 'CueScore'}</span>
          {action}
        </Container>
      </header>
      <main className={hideNav ? 'flex-1' : 'flex-1 pb-24'}>{children}</main>
      {!hideNav && <BottomNav />}
    </div>
  );
}
