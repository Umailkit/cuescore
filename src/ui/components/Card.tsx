import type { ReactNode, MouseEventHandler } from 'react';
import { cn } from '../design/cn';

export function Card({
  className,
  children,
  onClick,
}: {
  className?: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl bg-surface border border-border p-4',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </div>
  );
}
