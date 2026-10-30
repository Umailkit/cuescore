import { useId, type ReactNode } from 'react';
import { cn } from '../design/cn';

/**
 * Fixed bottom action bar for the match workspace.
 *
 * Mobile-first constraints (PHASE 2 spec):
 *  - normal actions  ≥ 48px tall
 *  - primary action  ≥ 56–64px tall
 *  - respects the iOS/Android safe area (no home-indicator overlap)
 *  - sits above the content so one-handed use never requires scrolling
 */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 border-t border-border bg-bg/95 backdrop-blur">
      <div className="mx-auto w-full max-w-2xl px-4 pb-safe pt-3 lg:max-w-4xl">
        {children}
      </div>
    </div>
  );
}

/**
 * A single action button inside the ActionBar.
 *
 * `sublabel` is rendered as visual helper text only: it is `aria-hidden` and
 * referenced through `aria-describedby`. That keeps the accessible name equal
 * to the action label ("开球"), so assistive tech and tests match on the verb
 * instead of "开球 宣告本局开球…".
 */
export function ActionButton({
  label,
  sublabel,
  onClick,
  disabled,
  variant = 'default',
  size = 'normal',
}: {
  label: string;
  sublabel?: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  size?: 'normal' | 'primary';
}) {
  const hintId = useId();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-describedby={sublabel ? hintId : undefined}
      className={cn(
        'no-select flex flex-col items-center justify-center rounded-xl border font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-35 active:scale-[0.98]',
        size === 'primary' ? 'min-h-[64px] text-base' : 'min-h-touch text-sm',
        variant === 'primary' &&
          'border-felt bg-felt text-white hover:bg-felt-strong',
        variant === 'danger' &&
          'border-danger/50 bg-danger/10 text-danger hover:bg-danger/20',
        variant === 'default' &&
          'border-border bg-surface-2 text-text hover:border-felt',
      )}
    >
      <span>{label}</span>
      {sublabel && (
        <span id={hintId} aria-hidden="true" className="mt-0.5 text-[11px] font-normal opacity-70">
          {sublabel}
        </span>
      )}
    </button>
  );
}
