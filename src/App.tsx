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

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
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
