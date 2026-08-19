import { useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Banner } from '../components';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not sign in. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">Z</div>
          <h1>Zigama Staff</h1>
          <p className="page-sub">
            Branch console. Customers use the mobile app.
          </p>
        </div>

        <form className="card" onSubmit={submit}>
          <Banner kind="error">{error}</Banner>

          <div className="field">
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@zigama.test"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%' }}
            disabled={busy || !email.includes('@') || password.length < 8}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="demo">
          <strong>Demo accounts</strong>
          <br />
          admin@zigama.test · Admin@12345
          <br />
          manager@zigama.test · Manager@12345
        </div>
      </div>
    </div>
  );
}
