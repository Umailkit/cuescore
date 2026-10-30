import { Page } from './Page';
import { Container } from './Container';
import { Card } from './Card';

/**
 * PHASE 1 uses this for sections whose full UI lands in later phases
 * (Players / Stats / Leaderboard / Settings / Display). It proves the route
 * and information architecture exist without prematurely piling on UI.
 */
export function PlaceholderPage({ title, note }: { title: string; note?: string }) {
  return (
    <Page title={title}>
      <Container className="py-8">
        <Card className="text-center">
          <div className="text-3xl">🚧</div>
          <h2 className="mt-3 text-lg font-semibold">{title}</h2>
          <p className="mt-2 text-sm text-muted">
            {note ?? '该模块将在后续阶段实现，路由与信息架构已就位。'}
          </p>
        </Card>
      </Container>
    </Page>
  );
}
