import React, { useState } from 'react';
import { ArrowRight, Database, Lock, ShieldCheck } from 'lucide-react';
import { inspectSupabaseSchema } from '../lib/schemaInspector';
import {
  getActiveSupabaseConfig,
  saveSupabaseConfig,
  validateSupabaseInputs,
} from '../lib/supabaseClient';
import type { SchemaInspectionResult } from '../types/blade';

interface ConnectSupabaseViewProps {
  onConnected: (schema: SchemaInspectionResult) => void;
}

export function ConnectSupabaseView({ onConnected }: ConnectSupabaseViewProps) {
  const existing = getActiveSupabaseConfig();
  const [url, setUrl] = useState(existing?.url ?? '');
  const [publishableKey, setPublishableKey] = useState(existing?.publishableKey ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validateSupabaseInputs(url, publishableKey);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      saveSupabaseConfig({ url, publishableKey });
      const schema = await inspectSupabaseSchema();
      onConnected(schema);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to connect to Supabase project with the provided URL and Publishable Key.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col lg:flex-row">
      <div className="lg:w-5/12 p-8 sm:p-12 lg:p-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-zinc-800">
        <div>
          <div className="flex items-center gap-3">
            <img
              src="/assets/aistudio/Bold_Red_Geometric_B_Logo_701917dd.png"
              alt="BLADE"
              className="w-10 h-10 rounded-md object-cover shrink-0"
            />
            <span className="font-display font-bold tracking-tight text-lg text-white">
              BLADE ADMIN PANEL
            </span>
          </div>

          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mt-12 leading-tight max-w-md">
            Connect your Android app&apos;s Supabase backend.
          </h1>
          <p className="text-sm text-zinc-400 mt-4 leading-relaxed max-w-md">
            BLADE connects directly to your existing production Supabase project as a single source
            of truth. Existing tables, users, videos, and storage buckets are inspected
            automatically without duplicating data.
          </p>
        </div>

        <div className="mt-10 pt-8 border-t border-zinc-800 space-y-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-zinc-300 leading-relaxed">
              Requires only your <strong className="text-white">Supabase Project URL</strong> and{' '}
              <strong className="text-white">Publishable Key</strong>. Never enter{' '}
              <code className="font-mono text-zinc-200">service_role</code> or database passwords.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <Database className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
            <p className="text-xs text-zinc-400 leading-relaxed">
              All admin mutations are verified server-side via Supabase Auth JWTs and PostgreSQL
              Row Level Security policies.
            </p>
          </div>
        </div>
      </div>

      <div className="lg:w-7/12 bg-white text-zinc-950 p-8 sm:p-12 lg:p-16 flex items-center justify-center">
        <div className="w-full max-w-md">
          <h2 className="font-display text-2xl font-bold text-zinc-950">Supabase Connection</h2>
          <p className="text-sm text-zinc-600 mt-1.5">
            Enter your two frontend Supabase credentials to inspect the live schema.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label
                htmlFor="supabase-url"
                className="block text-xs font-semibold text-zinc-900 mb-1.5"
              >
                Supabase Project URL
              </label>
              <input
                id="supabase-url"
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-project-ref.supabase.co"
                className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-red-600"
              />
            </div>

            <div>
              <label
                htmlFor="supabase-key"
                className="block text-xs font-semibold text-zinc-900 mb-1.5"
              >
                Supabase Publishable Key
              </label>
              <input
                id="supabase-key"
                type="text"
                required
                value={publishableKey}
                onChange={(e) => setPublishableKey(e.target.value)}
                placeholder="sb_publishable_... or eyJhbGci..."
                className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-red-600"
              />
              <p className="text-[11px] text-zinc-500 mt-1.5 flex items-center gap-1.5">
                <Lock className="w-3 h-3" />
                Only the public Publishable / anon key is accepted here.
              </p>
            </div>

            {error && (
              <div className="p-3.5 rounded-md bg-red-50 border border-red-200 text-xs text-red-700 leading-relaxed">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-zinc-950 hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50"
            >
              {loading ? 'Inspecting Supabase Schema…' : 'Connect & Inspect Schema'}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
