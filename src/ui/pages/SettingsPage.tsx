import { Page } from '@ui/components/Page';
import { Container } from '@ui/components/Container';
import { Card } from '@ui/components/Card';
import { Button } from '@ui/components/Button';
import { useThemeStore } from '@app/stores/themeStore';

export function SettingsPage() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);

  return (
    <Page title="设置">
      <Container className="py-6">
        <Card className="flex items-center justify-between">
          <div>
            <div className="font-medium">外观</div>
            <div className="text-sm text-muted">
              {theme === 'dark' ? '深色（默认）' : '浅色'}
            </div>
          </div>
          <Button variant="secondary" onClick={toggle}>
            {theme === 'dark' ? '切换到浅色' : '切换到深色'}
          </Button>
        </Card>

        <Card className="mt-3">
          <div className="font-medium">关于</div>
          <div className="mt-1 text-sm text-muted">CueScore 台球计分</div>
          <div className="mt-0.5 text-sm text-muted">芜湖职业技术大学</div>
        </Card>

        <Card className="mt-3 text-sm text-muted">
          已支持中式八球 / 九球 / 六球 / 四球 / 斯诺克五套计分引擎，
          比赛目标可选预设局数、自定义局数或不限局数，
          支持 IndexedDB 持久化、刷新恢复与撤销/重做。
          账号、云端同步、台球厅、赛事等留待后续阶段。
        </Card>
      </Container>
    </Page>
  );
}
