import { NavLink } from 'react-router-dom';
import { cn } from '../design/cn';

const ITEMS = [
  { to: '/', label: '首页', icon: '🏠', end: true },
  { to: '/new', label: '开始', icon: '➕', end: false },
  { to: '/history', label: '历史', icon: '🕘', end: false },
  { to: '/players', label: '选手', icon: '👤', end: false },
  { to: '/settings', label: '设置', icon: '⚙️', end: false },
];

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-surface/95 backdrop-blur pb-safe">
      <div className="mx-auto flex max-w-2xl items-stretch justify-around">
        {ITEMS.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] no-select',
                isActive ? 'text-felt-strong' : 'text-muted',
              )
            }
          >
            <span className="text-lg leading-none">{it.icon}</span>
            <span>{it.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
