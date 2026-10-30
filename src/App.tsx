import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@ui/design/ThemeProvider';
import { HomePage } from '@ui/pages/HomePage';
import { NewMatchPage } from '@ui/pages/NewMatchPage';
import { MatchPage } from '@ui/pages/MatchPage';
import { HistoryPage } from '@ui/pages/HistoryPage';
import { PlayersPage } from '@ui/pages/PlayersPage';
import { StatsPage } from '@ui/pages/StatsPage';
import { LeaderboardPage } from '@ui/pages/LeaderboardPage';
import { SettingsPage } from '@ui/pages/SettingsPage';
import { DisplayPage } from '@ui/pages/DisplayPage';
import { NotFoundPage } from '@ui/pages/NotFoundPage';

/**
 * 部署在子路径（GitHub Pages /cuescore/）时，路由必须带同名 basename，
 * 否则 pathname 是 /cuescore/match/xxx，路由表里一条都匹配不上。
 * BASE_URL 由 Vite 的 `base` 决定：根部署为 '/'，子路径为 '/cuescore/'。
 */
const BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter basename={BASENAME}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/new" element={<NewMatchPage />} />
          <Route path="/match" element={<MatchPage />} />
          <Route path="/match/:id" element={<MatchPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/display/:id" element={<DisplayPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
