import type { InputHTMLAttributes } from 'react';
import { cn } from '../design/cn';

/** Text input styled to match the design system (48px touch target). */
export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cn(
        'min-h-touch w-full rounded-xl border border-border bg-surface-2 px-3 text-text',
        'placeholder:text-muted outline-none transition-colors focus:border-felt',
        className,
      )}
    />
  );
}

/** Empty-state row used inside lists (players / history / pickers). */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
