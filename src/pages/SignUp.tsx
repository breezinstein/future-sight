import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, ArrowRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Spinner } from '@/components/Spinner';
import { ApiError } from '@/api/client';

export function SignUp() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      await signUp(email, name, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign up failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-surface-container-lowest text-on-surface min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-inverse-primary/5 blur-[120px] rounded-full pointer-events-none" />

      <main className="w-full max-w-[400px] z-10 fs-fade-in">
        <div className="mb-8 text-center flex flex-col items-center">
          <div className="w-12 h-12 bg-surface border border-surface-container-high rounded-lg flex items-center justify-center mb-4">
            <Eye size={28} className="text-inverse-primary" strokeWidth={2.4} />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Future Sight</h1>
          <p className="text-on-surface-variant mt-1 text-sm">Start planning your household's future</p>
        </div>

        <div className="bg-surface border border-surface-container-high rounded-xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-inverse-primary/30 to-transparent" />
          <h2 className="text-lg font-semibold mb-4">Create your account</h2>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="fs-label" htmlFor="name">Your name</label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                required
                className="fs-input"
                placeholder="Alex Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="fs-label" htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                className="fs-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="fs-label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                className="fs-input"
                placeholder="At least 8 characters"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <div className="px-3 py-2 rounded bg-error-container/30 border border-error/40 text-error text-sm">
                {error}
              </div>
            )}

            <button type="submit" disabled={submitting} className="fs-btn fs-btn-primary mt-2">
              {submitting ? <Spinner /> : <>Create account <ArrowRight size={16} /></>}
            </button>
          </form>

          <div className="mt-8 relative flex items-center justify-center">
            <div className="absolute w-full border-t border-surface-container-high" />
            <span className="bg-surface px-4 fs-label relative">Already have one?</span>
          </div>

          <div className="mt-4 text-center">
            <Link to="/sign-in" className="fs-btn fs-btn-secondary w-full">
              Sign in instead
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
