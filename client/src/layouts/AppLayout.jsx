import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { notificationApi } from '../api/endpoints.js';
import { cx } from '../components/ui.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useSocket } from '../hooks/useSocket.jsx';
import { useToast } from '../hooks/useToast.jsx';

export function Logo({ className }) {
  return (
    <Link to="/" className={cx('flex items-center gap-2 font-semibold text-slate-900', className)}>
      <img src="/favicon.svg" alt="" className="h-7 w-7" />
      <span>
        Campus<span className="text-brand-600">Book</span>
      </span>
    </Link>
  );
}

function navFor(role) {
  const common = [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/resources', label: 'Resources' },
    { to: '/my-bookings', label: 'My bookings' },
  ];
  if (role === 'FACULTY') return [...common, { to: '/approvals', label: 'Approvals' }, { to: '/analytics', label: 'Analytics' }];
  if (role === 'ADMIN') {
    return [
      { to: '/admin', label: 'Admin', end: true },
      { to: '/resources', label: 'Resources' },
      { to: '/approvals', label: 'Approvals' },
      { to: '/admin/bookings', label: 'Bookings' },
      { to: '/admin/users', label: 'Users' },
      { to: '/admin/analytics', label: 'Analytics' },
      { to: '/my-bookings', label: 'My bookings' },
    ];
  }
  return common;
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: notificationApi.unreadCount,
    refetchInterval: connected ? false : 60_000,
  });

  const links = navFor(user.role);
  const handleLogout = async () => {
    await logout();
    toast.success('You have been logged out.');
    navigate('/login');
  };

  const linkClass = ({ isActive }) =>
    cx('rounded-md px-3 py-2 text-sm font-medium transition', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900');

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Main">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={linkClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span
              className={cx('hidden items-center gap-1.5 text-xs sm:flex', connected ? 'text-emerald-700' : 'text-slate-400')}
              title={connected ? 'Live updates connected' : 'Live updates offline — data refreshes periodically'}
            >
              <span className={cx('h-2 w-2 rounded-full', connected ? 'bg-emerald-500' : 'bg-slate-300')} aria-hidden="true" />
              {connected ? 'Live' : 'Offline'}
            </span>
            <Link to="/notifications" className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100" aria-label={`Notifications (${unread?.count || 0} unread)`}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {unread?.count > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] rounded-full bg-rose-600 px-1 text-center text-[0.65rem] leading-[1.1rem] font-semibold text-white">
                  {unread.count > 99 ? '99+' : unread.count}
                </span>
              )}
            </Link>
            <Link to="/profile" className="hidden items-center gap-2 rounded-full py-1 pr-3 pl-1 hover:bg-slate-100 sm:flex">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                {user.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
              </span>
              <span className="text-left leading-tight">
                <span className="block text-sm font-medium text-slate-800">{user.name}</span>
                <span className="block text-[0.7rem] text-slate-500 capitalize">{user.role.toLowerCase()}</span>
              </span>
            </Link>
            <button type="button" onClick={handleLogout} className="hidden rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 sm:block">
              Log out
            </button>
            <button type="button" className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
              ☰
            </button>
          </div>
        </div>
        {open && (
          <nav className="border-t border-slate-200 bg-white px-4 py-2 lg:hidden" aria-label="Mobile">
            {[...links, { to: '/profile', label: 'Profile' }].map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => cx(linkClass({ isActive }), 'block')} onClick={() => setOpen(false)}>
                {link.label}
              </NavLink>
            ))}
            <button type="button" onClick={handleLogout} className="block w-full rounded-md px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100">
              Log out
            </button>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
