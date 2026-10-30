import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../design/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-felt text-white hover:bg-felt-strong',
  secondary: 'bg-surface-2 text-text border border-border hover:border-felt',
  ghost: 'text-muted hover:text-text',
  danger: 'bg-danger text-white hover:opacity-90',
};

export function Button({
  variant = 'primary',
  block,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium',
        'min-h-touch px-4 transition-colors select-none',
        'disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]',
        VARIANTS[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    />
  );
}
