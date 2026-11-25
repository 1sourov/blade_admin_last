import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Database, KeyRound, ShieldCheck, UserPlus } from 'lucide-react';
import { SqlSetupModal } from '../components/SqlSetupModal';
import { inspectSupabaseSchema } from '../lib/schemaInspector';
import {
  checkAdminSetupStatus,
  createFirstAdminAccount,
  signInAsAdmin,
} from '../services/adminApi';
import type { AdminRecord, SchemaInspectionResult } from '../types/blade';

interface AuthViewProps {
  schema: SchemaInspectionResult;
  onSchemaUpdated: (schema: SchemaInspectionResult) => void;
  onAuthenticated: (admin: AdminRecord) => void;
  onChangeConnection: () => void;
}

export function AuthView({
  schema,
  onSchemaUpdated,
  onAuthenticated,
  onChangeConnection,
}: AuthViewProps) {
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<'setup' | 'login'>('login');
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);

  // First-time Admin Setup form
  const [setupEmail, setSetupEmail] = useState('');
  const [setupUsername, setSetupUsername] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');

  // Normal Login form
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const loadSetupStatus = async () => {
    setChecking(true);
    setError(null);
    try {
      const status = await checkAdminSetupStatus();
      setMigrationMissing(status.migrationMissing);
      setMode(status.hasAdmin ? 'login' : 'setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify admin setup status.');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void loadSetupStatus();
  }, []);

  const handleRecheckSchema = async () => {
    try {
      const nextSchema = await inspectSupabaseSchema();
      onSchemaUpdated(nextSchema);
      setShowSqlModal(false);
      await loadSetupStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Schema inspection failed.');
    }
  };

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    if (!setupEmail.trim() || !setupEmail.includes('@')) {
      setError('Enter a valid email address for Supabase Auth.');
      return;
    }
    if (!setupUsername.trim() || setupUsername.trim().length < 3) {
      setError('Admin username must be at least 3 characters.');
      return;
    }
    if (setupPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (setupPassword !== setupConfirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await createFirstAdminAccount({
        email: setupEmail,
        username: setupUsername,
        password: setupPassword,
      });

      setSetupPassword('');
      setSetupConfirm('');
      setIdentifier(setupEmail);
      setMode('login');

      if (res.needsEmailConfirmation) {
        setInfoMessage(
          'Admin account registered. Check your inbox to confirm your email address, then sign in below.'
        );
      } else {
        setInfoMessage('Admin account created securely. Sign in to access BLADE ADMIN PANEL.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create admin account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    if (!identifier.trim() || !password) {
      setError('Enter your username or email and password.');
      return;
    }

    setSubmitting(true);
    try {
      const admin = await signInAsAdmin({ identifier, password });
      onAuthenticated(admin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col justify-between p-6 sm:p-10">
      <div className="flex items-center justify-between gap-4 max-w-5xl w-full mx-auto">
        <div className="flex items-center gap-3">
          <img
            src="/assets/aistudio/Bold_Red_Geometric_B_Logo_701917dd.png"
            alt="BLADE"
            className="w-9 h-9 rounded-md object-cover shrink-0"
          />
          <span className="font-display font-bold tracking-tight text-white">
            BLADE ADMIN PANEL
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowSqlModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 border border-zinc-800 rounded-md hover:text-white hover:border-zinc-700 transition-colors"
          >
            <Database className="w-3.5 h-3.5" />
            SQL Setup
          </button>
          <button
            type="button"
            onClick={onChangeConnection}
            className="text-xs font-medium text-zinc-400 hover:text-white transition-colors"
          >
            Switch Supabase Project
          </button>
        </div>
      </div>

      <div className="max-w-md w-full mx-auto my-10 bg-white text-zinc-950 rounded-lg border border-zinc-200 shadow-2xl overflow-hidden">
        <div className="p-8">
          {checking ? (
            <div className="py-12 text-center">
              <div className="w-6 h-6 border-2 border-zinc-300 border-t-red-600 rounded-full animate-spin mx-auto" />
              <p className="text-sm text-zinc-600 mt-3">Checking admin authorization status…</p>
            </div>
          ) : migrationMissing ? (
            <div>
              <div className="p-2.5 rounded-md bg-red-50 text-red-600 inline-flex">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h1 className="font-display text-xl font-bold text-zinc-950 mt-4">
                One-Time SQL Setup Required
              </h1>
              <p className="text-sm text-zinc-600 mt-2 leading-relaxed">
                Your Supabase project is connected, and BLADE inspected{' '}
                <strong className="text-zinc-950">
                  {Object.keys(schema.rawTables).length} existing tables
                </strong>
                . Run the non-destructive BLADE compatibility migration in your Supabase SQL Editor
                to enable secure admin authorization and RLS.
              </p>
              <div className="mt-6 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setShowSqlModal(true)}
                  className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-zinc-950 hover:bg-zinc-800 rounded-md transition-colors"
                >
                  View & Copy SQL Migration
                </button>
                <button
                  type="button"
                  onClick={handleRecheckSchema}
                  className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                >
                  I Ran the Migration — Continue
                </button>
              </div>
            </div>
          ) : mode === 'setup' ? (
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-red-600">
                <UserPlus className="w-4 h-4" />
                First-Launch Setup
              </div>
              <h1 className="font-display text-2xl font-bold text-zinc-950 mt-2">
                CREATE ADMIN ACCOUNT
              </h1>
              <p className="text-xs text-zinc-600 mt-1.5 leading-relaxed">
                Create the primary BLADE administrator via Supabase Auth. Once created, this setup
                screen locks permanently.
              </p>

              <form onSubmit={handleSetupSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">
                    Admin Email
                  </label>
                  <input
                    type="email"
                    required
                    value={setupEmail}
                    onChange={(e) => setSetupEmail(e.target.value)}
                    placeholder="admin@yourdomain.com"
                    className="w-full px-3.5 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">
                    Admin Username
                  </label>
                  <input
                    type="text"
                    required
                    value={setupUsername}
                    onChange={(e) => setSetupUsername(e.target.value)}
                    placeholder="blade_admin"
                    className="w-full px-3.5 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full px-3.5 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={setupConfirm}
                    onChange={(e) => setSetupConfirm(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full px-3.5 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-red-600"
                  />
                </div>

                {error && (
                  <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Creating Admin Account…' : 'Create Admin Account'}
                  {!submitting && <ArrowRight className="w-4 h-4" />}
                </button>
              </form>

              <div className="mt-5 pt-4 border-t border-zinc-200 text-center">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-xs font-medium text-zinc-600 hover:text-zinc-950"
                >
                  Already confirmed an admin account? Sign in
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-600">
                <KeyRound className="w-4 h-4 text-red-600" />
                Protected Console
              </div>
              <h1 className="font-display text-2xl font-bold text-zinc-950 mt-2">
                Admin Sign In
              </h1>
              <p className="text-xs text-zinc-600 mt-1.5">
                Authenticate with your authorized BLADE administrator credentials.
              </p>

              {infoMessage && (
                <div className="mt-4 p-3 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                  {infoMessage}
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">
                    Username or Email
                  </label>
                  <input
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="admin@yourdomain.com or blade_admin"
                    className="w-full px-3.5 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full px-3.5 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-red-600"
                  />
                </div>

                {error && (
                  <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-zinc-950 hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Verifying Credentials…' : 'Sign In to Dashboard'}
                  {!submitting && <ArrowRight className="w-4 h-4" />}
                </button>
              </form>
            </div>
          )}
        </div>

        <div className="px-8 py-3.5 bg-zinc-50 border-t border-zinc-200 flex items-center gap-2 text-[11px] text-zinc-500">
          <ShieldCheck className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          Normal Android app users cannot access this console.
        </div>
      </div>

      <div className="text-center text-xs text-zinc-500">
        BLADE ADMIN PANEL · Single Source of Truth via Supabase
      </div>

      <SqlSetupModal
        open={showSqlModal}
        schema={schema}
        onClose={() => setShowSqlModal(false)}
        onRecheck={handleRecheckSchema}
      />
    </div>
  );
}
