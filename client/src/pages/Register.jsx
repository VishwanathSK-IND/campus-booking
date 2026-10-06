import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, Button, Field, Input } from '../components/ui.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useToast } from '../hooks/useToast.jsx';
import AuthLayout from '../layouts/AuthLayout.jsx';

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', department: '', password: '' });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await register({ ...form, department: form.department || undefined });
      toast.success('Welcome! Your account is ready.');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err.details) setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Student accounts can be created here. Faculty accounts are set up by the campus administrator."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Full name" htmlFor="name" error={fieldErrors.name}>
          <Input id="name" autoComplete="name" required value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Campus email" htmlFor="email" error={fieldErrors.email}>
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Department (optional)" htmlFor="department" error={fieldErrors.department}>
          <Input id="department" value={form.department} onChange={set('department')} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters, including a letter and a number." error={fieldErrors.password}>
          <Input id="password" type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} />
        </Field>
        <Button type="submit" className="w-full" loading={submitting} loadingText="Creating account…">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
