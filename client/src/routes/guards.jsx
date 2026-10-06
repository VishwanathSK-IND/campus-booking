import { Navigate, Outlet, useLocation } from 'react-router';
import { Loading } from '../components/ui.jsx';
import { useAuth } from '../hooks/useAuth.jsx';

/** UI-level guard only: hides pages the user cannot use. The API enforces the real permissions. */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function RequireRole({ roles }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Checking your session…" />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
