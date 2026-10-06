import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { Loading } from './components/ui.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import Register from './pages/Register.jsx';
import { GuestOnly, RequireAuth, RequireRole } from './routes/guards.jsx';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Resources = lazy(() => import('./pages/Resources.jsx'));
const ResourceDetail = lazy(() => import('./pages/ResourceDetail.jsx'));
const BookResource = lazy(() => import('./pages/BookResource.jsx'));
const MyBookings = lazy(() => import('./pages/MyBookings.jsx'));
const BookingDetail = lazy(() => import('./pages/BookingDetail.jsx'));
const CheckIn = lazy(() => import('./pages/CheckIn.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Approvals = lazy(() => import('./pages/Approvals.jsx'));
const Kiosk = lazy(() => import('./pages/Kiosk.jsx'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard.jsx'));
const AdminResources = lazy(() => import('./pages/admin/AdminResources.jsx'));
const AdminResourceForm = lazy(() => import('./pages/admin/AdminResourceForm.jsx'));
const AdminBookings = lazy(() => import('./pages/admin/AdminBookings.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'));
const AdminAnalytics = lazy(() => import('./pages/admin/AdminAnalytics.jsx'));
const AdminPolicy = lazy(() => import('./pages/admin/AdminPolicy.jsx'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit.jsx'));

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route element={<GuestOnly />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>

        <Route element={<RequireAuth />}>
          {/* Full-screen venue display, no navigation chrome. */}
          <Route element={<RequireRole roles={['ADMIN', 'FACULTY']} />}>
            <Route path="/kiosk/:resourceId" element={<Kiosk />} />
          </Route>

          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/resources" element={<Resources />} />
            <Route path="/resources/:resourceId" element={<ResourceDetail />} />
            <Route path="/resources/:resourceId/book" element={<BookResource />} />
            <Route path="/my-bookings" element={<MyBookings />} />
            <Route path="/bookings/:bookingId" element={<BookingDetail />} />
            <Route path="/check-in" element={<CheckIn />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/profile" element={<Profile />} />

            <Route element={<RequireRole roles={['ADMIN', 'FACULTY']} />}>
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/analytics" element={<AdminAnalytics />} />
            </Route>

            <Route element={<RequireRole roles={['ADMIN']} />}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/resources" element={<AdminResources />} />
              <Route path="/admin/resources/new" element={<AdminResourceForm />} />
              <Route path="/admin/resources/:resourceId/edit" element={<AdminResourceForm />} />
              <Route path="/admin/bookings" element={<AdminBookings />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/analytics" element={<AdminAnalytics />} />
              <Route path="/admin/policy" element={<AdminPolicy />} />
              <Route path="/admin/audit" element={<AdminAudit />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
