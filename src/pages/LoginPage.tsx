import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const DEMO_ACCOUNTS = [
  { label: 'Manager', email: 'manager@shifts.demo', role: 'Manager' },
  { label: 'Harish (Employee)', email: 'ravi@shifts.demo', role: 'Employee' },
  { label: 'Surya (Employee)', email: 'kumar@shifts.demo', role: 'Employee' },
  { label: 'Dileep (Employee)', email: 'suresh@shifts.demo', role: 'Employee' },
  { label: 'Venkatesh (Employee)', email: 'mahesh@shifts.demo', role: 'Employee' },
  { label: 'Prasad (Employee)', email: 'ramesh@shifts.demo', role: 'Employee' },
  { label: 'D K Rao (Employee)', email: 'prasad@shifts.demo', role: 'Employee' },
  { label: 'S.G.S.N (Employee)', email: 'naresh@shifts.demo', role: 'Employee' },
  { label: 'Theja (Employee)', email: 'venkat@shifts.demo', role: 'Employee' },
];

export default function LoginPage() {
  const { login, isDemo } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword('demo123');
    setError('');
  }

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col items-center justify-center px-4 py-12">
      {/* Background pattern */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-brand-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-500 rounded-2xl mb-4 shadow-lg shadow-brand-500/25">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-navy-50">Smart Shift Planner</h1>
          <p className="text-navy-400 text-sm mt-1">Industrial shift management system</p>
          {isDemo && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 border border-amber-500/25 rounded-full text-amber-400 text-xs font-mono">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
              DEMO MODE — No Firebase required
            </div>
          )}
        </div>

        {/* Form card */}
        <div className="bg-navy-800 border border-navy-700 rounded-2xl p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-navy-400 mb-1.5 font-mono uppercase tracking-wide">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="w-full bg-navy-900 border border-navy-600 text-navy-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-navy-600 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-navy-400 mb-1.5 font-mono uppercase tracking-wide">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-navy-900 border border-navy-600 text-navy-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-navy-600 transition-colors"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-rose-900/30 border border-rose-500/30 px-3 py-2 text-xs text-rose-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors shadow-sm shadow-brand-500/20 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in…
                </>
              ) : 'Sign In'}
            </button>
          </form>

          {/* Demo credentials */}
          {isDemo && (
            <div className="mt-5 pt-5 border-t border-navy-700">
              <p className="text-xs text-navy-500 font-mono mb-3 uppercase tracking-wide">Demo accounts (password: demo123)</p>
              <div className="space-y-1.5">
                {DEMO_ACCOUNTS.map(acc => (
                  <button
                    key={acc.email}
                    onClick={() => fillDemo(acc.email)}
                    className="w-full text-left px-3 py-2 rounded-lg bg-navy-900 hover:bg-navy-700 border border-navy-700 hover:border-navy-600 transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-navy-300 group-hover:text-navy-100">{acc.label}</div>
                        <div className="text-[10px] text-navy-600 font-mono">{acc.email}</div>
                      </div>
                      <span className="text-[10px] bg-navy-800 text-navy-500 px-1.5 py-0.5 rounded font-mono border border-navy-700">
                        {acc.role}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-navy-600 mt-6 font-mono">
          HPCL Industrial Shift Management System v1.0
        </p>
      </div>
    </div>
  );
}
