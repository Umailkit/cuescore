import { useNavigate } from 'react-router-dom';
import { Button } from '@ui/components/Button';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg p-6 text-text">
      <div className="text-5xl font-bold">404</div>
      <p className="mt-2 text-muted">页面不存在。</p>
      <div className="mt-6">
        <Button onClick={() => navigate('/')}>返回首页</Button>
      </div>
    </div>
  );
}
