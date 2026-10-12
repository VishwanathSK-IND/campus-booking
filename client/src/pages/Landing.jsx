import { ButtonLink } from '../components/ui.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { Logo } from '../layouts/AppLayout.jsx';

const FEATURES = [
  ['Real availability', 'See exactly which slots are free, booked, pending approval or blocked — updated live as others book.'],
  ['No double bookings', 'Overlapping reservations are rejected by the server, even when two people click Book at the same moment.'],
  ['Approvals built in', 'Seminar halls and specialist labs route requests to the assigned faculty or admin for review.'],
  ['Fair waitlists', 'Join a waitlist for a taken slot. When it frees up, the next person in line gets a time-limited offer.'],
  ['One-click check-in', 'Check in with one click when your booking starts. Unused bookings are released automatically.'],
  ['Usage insights', 'Utilisation, peak hours and no-show rates help administrators plan campus resources.'],
];

export default function Landing() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-brand-50/60">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <div className="flex gap-2">
          {user ? (
            <ButtonLink to="/dashboard">Go to dashboard</ButtonLink>
          ) : (
            <>
              <ButtonLink to="/login" variant="ghost">
                Log in
              </ButtonLink>
              <ButtonLink to="/register">Create account</ButtonLink>
            </>
          )}
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pt-12 pb-16 text-center sm:px-6 sm:pt-20">
        <p className="mb-3 inline-block rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-800">Campus Resource &amp; Lab Booking System</p>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Book labs, halls, courts and equipment — without the WhatsApp chaos.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
          One place for students, faculty and administrators to find free resources, reserve them reliably, get approvals and
          keep every booking accountable.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <ButtonLink to={user ? '/resources' : '/register'} size="lg">
            {user ? 'Browse resources' : 'Get started'}
          </ButtonLink>
          {!user && (
            <ButtonLink to="/login" variant="secondary" size="lg">
              I already have an account
            </ButtonLink>
          )}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {FEATURES.map(([title, text]) => (
          <div key={title} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-semibold text-slate-900">{title}</h2>
            <p className="mt-1.5 text-sm text-slate-600">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
