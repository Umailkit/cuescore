import { useEffect, type ReactNode } from 'react';
import { useThemeStore } from '@app/stores/themeStore';

/** Applies the active theme to <html> and keeps the class in sync. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    const el = document.documentElement;
    // 两个类都要维护：深色变量挂在 `:root` 上，浅色必须靠 `.light` 覆盖。
    el.classList.toggle('dark', theme === 'dark');
    el.classList.toggle('light', theme === 'light');
  }, [theme]);

  return <>{children}</>;
}
