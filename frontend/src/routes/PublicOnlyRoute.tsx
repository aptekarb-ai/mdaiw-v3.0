import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../hooks/useAuth';

export function PublicOnlyRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    return null;
  }

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
