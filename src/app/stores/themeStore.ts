import { create } from 'zustand';

export type Theme = 'dark' | 'light';

/**
 * 浅色必须显式加 `.light`。
 *
 * 之前只做 `remove('dark')` 是错的：CSS 里深色变量挂在 `:root` 上
 * （html 元素恒匹配 `:root`），不写 `.light` 就永远是深色 —— 表现为
 * 「点了切换到浅色，界面纹丝不动」。
 */
function applyTheme(t: Theme): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.classList.toggle('dark', t === 'dark');
  el.classList.toggle('light', t === 'light');
}

const KEY = 'cuescore-theme';

function initialTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'dark';
  return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
}

interface ThemeStore {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const INITIAL = initialTheme();
// 首屏就落一次 class，避免「深色闪一下再变浅色」。
if (typeof document !== 'undefined') applyTheme(INITIAL);

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: INITIAL,
  setTheme: (t) => {
    applyTheme(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* ignore quota / privacy errors */
    }
    set({ theme: t });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));
