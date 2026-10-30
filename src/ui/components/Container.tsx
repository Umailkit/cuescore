import type { ReactNode } from 'react';
import { cn } from '../design/cn';

/**
 * Page width wrapper. Mobile-first: `md` is the default reading width for
 * phone-first screens. Pass `wide` for scoreboards that benefit from using a
 * tablet / desktop viewport (the match workspace).
 */
export function Container({
  className,
  wide = false,
  children,
}: {
  className?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4',
        wide ? 'max-w-2xl lg:max-w-4xl' : 'max-w-2xl',
        className,
      )}
    >
      {children}
    </div>
  );
}
