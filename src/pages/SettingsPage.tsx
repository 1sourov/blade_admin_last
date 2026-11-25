import React, { useState } from 'react';
import { CheckCircle2, Database, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { SqlSetupModal } from '../components/SqlSetupModal';
import { useToast } from '../components/ui/ToastProvider';
import { inspectSupabaseSchema } from '../lib/schemaInspector';
import {
  getActiveSupabaseConfig,
  getPreferences,
  savePreferences,
  saveSupabaseConfig,
  validateSupabaseInputs,
} from '../lib/supabaseClient';
import { updateStorageQuotaGb } from '../services/adminApi';
import type { AdminPanelPreferences, SchemaInspectionResult } from '../types/blade';

interface SettingsPageProps {
  schema: SchemaInspectionResult;
  onSchemaUpdated: (next: SchemaInspectionResult) => void;
}

export function SettingsPage({ schema, onSchemaUpdated }: SettingsPageProps) {
  const { pushToast } = useToast();
  const activeConn = getActiveSupabaseConfig();

  const [url, setUrl] = useState(activeConn?.url ?? '');
  const [publishableKey, setPublishableKey] = useState(activeConn?.publishableKey ?? '');
  const [savingConn, setSavingConn] = useState(false);

  const [prefs, setPrefs] = useState<AdminPanelPreferences>(getPreferences());
  const [inspecting, setInspecting] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);

  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    const errMsg = validateSupabaseInputs(url, publishableKey);
    if (errMsg) {
      pushToast({ title: 'Invalid Supabase credentials', description: errMsg, variant: 'error' });
      return;
    }

    setSavingConn(true);
    try {
      saveSupabaseConfig({ url, publishableKey });
      const nextSchema = await inspectSupabaseSchema();
      onSchemaUpdated(nextSchema);
      pushToast({
        title: 'Supabase connection updated',
        description: `Inspected ${Object.keys(nextSchema.rawTables).length} tables.`,
        variant: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Connection failed',
        description: err instanceof Error ? err.message : 'Unable to reach Supabase.',
        variant: 'error',
      });
    } finally {
      setSavingConn(false);
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    savePreferences(prefs);
    try {
      await updateStorageQuotaGb(prefs.storageQuotaGb ?? null);
      pushToast({ title: 'Storage preferences & quota saved', variant: 'success' });
    } catch (err) {
      pushToast({
        title: 'Saved locally, database sync failed',
        description: err instanceof Error ? err.message : 'Unable to sync quota to Supabase.',
        variant: 'error',
      });
    }
  };

  const handleReinspect = async () => {
    setInspecting(true);
    try {
      const next = await inspectSupabaseSchema();
      onSchemaUpdated(next);
      pushToast({
        title: 'Schema re-inspected',
        description: `Detected ${Object.keys(next.rawTables).length} public tables.`,
        variant: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Schema inspection failed',
        description: err instanceof Error ? err.message : 'Inspection error.',
        variant: 'error',
      });
    } finally {
      setInspecting(false);
    }
  };

  const hasActivityRpcs =
    schema.rawRpcs.includes('user_heartbeat') &&
    schema.rawRpcs.includes('start_video_watch_session') &&
    schema.rawRpcs.includes('stop_video_watch_session') &&
    schema.rawRpcs.includes('get_blade_activity_stats') &&
    (schema.migrationVersion ?? 0) >= 6;
  const hasModerationEnforcement =
    schema.rawRpcs.includes('admin_set_video_moderation') &&
    schema.rawRpcs.includes('admin_set_user_status') &&
    schema.rawRpcs.includes('admin_create_user') &&
    schema.rawRpcs.includes('is_current_user_active_unblocked') &&
    schema.rawRpcs.includes('is_video_publicly_visible') &&
    (schema.migrationVersion ?? 0) >= 6;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-zinc-950">SETTINGS</h1>
        <p className="text-sm text-zinc-600 mt-0.5">
          Supabase connection, storage bucket mapping, moderation rules, and live schema adapter.
        </p>
      </div>

      {/* Supabase Connection (ONLY 2 VALUES) */}
      <form
        onSubmit={handleSaveConnection}
        className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-zinc-950">Supabase Connection</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Connects using only your Supabase Project URL and Publishable Key. No secret keys are
              accepted or stored.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="w-4 h-4" /> Publishable Key Only
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-900 mb-1">
              Supabase Project URL
            </label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-900 mb-1">
              Supabase Publishable Key
            </label>
            <input
              type="text"
              required
              value={publishableKey}
              onChange={(e) => setPublishableKey(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingConn}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-zinc-950 hover:bg-zinc-800 rounded-md disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {savingConn ? 'Testing Connection…' : 'Save & Reconnect'}
          </button>
        </div>
      </form>

      {/* Storage Preferences */}
      <form
        onSubmit={handleSavePreferences}
        className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4"
      >
        <div>
          <h2 className="text-base font-bold text-zinc-950">Storage Buckets &amp; Moderation Policy</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Match your existing Android Supabase Storage bucket names. Video moderation uses
            non-destructive Hide &amp; Block states so database records and media files are never
            permanently deleted.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-900 mb-1">Videos Bucket</label>
            <input
              type="text"
              value={prefs.videoBucket}
              onChange={(e) => setPrefs((p) => ({ ...p, videoBucket: e.target.value }))}
              className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-900 mb-1">
              Thumbnails Bucket
            </label>
            <input
              type="text"
              value={prefs.thumbnailBucket}
              onChange={(e) => setPrefs((p) => ({ ...p, thumbnailBucket: e.target.value }))}
              className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-900 mb-1">
              Avatars Bucket
            </label>
            <input
              type="text"
              value={prefs.avatarBucket}
              onChange={(e) => setPrefs((p) => ({ ...p, avatarBucket: e.target.value }))}
              className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-900 mb-1">
              Storage Quota (GB)
            </label>
            <input
              type="number"
              min="0.1"
              step="any"
              placeholder="Auto (1 GB Free / 100 GB Pro)"
              value={prefs.storageQuotaGb ?? ''}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const num = Number(raw);
                setPrefs((p) => ({
                  ...p,
                  storageQuotaGb: raw && Number.isFinite(num) && num > 0 ? num : null,
                }));
              }}
              className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-md"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-zinc-950 hover:bg-zinc-800 rounded-md"
          >
            <Save className="w-3.5 h-3.5" /> Save Bucket Preferences
          </button>
        </div>
      </form>

      {/* Live Detected Schema Map */}
      <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-zinc-950">
              Live Android Database Schema Mapping
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Inspected {Object.keys(schema.rawTables).length} tables and {schema.rawRpcs.length}{' '}
              RPCs from your Supabase project.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleReinspect()}
              disabled={inspecting}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-zinc-300 rounded-md hover:bg-zinc-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${inspecting ? 'animate-spin' : ''}`} />
              Re-inspect Schema
            </button>
            <button
              type="button"
              onClick={() => setShowSqlModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md"
            >
              <Database className="w-3.5 h-3.5" />
              View Tailored SQL Migration
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          {[
            {
              label: 'Users / Profiles',
              value: schema.users
                ? `${schema.users.table} (id: ${schema.users.idCol})`
                : 'Not detected',
              ok: Boolean(schema.users),
            },
            {
              label: 'Videos',
              value: schema.videos
                ? `${schema.videos.table} (owner FK: ${schema.videos.ownerIdCol})`
                : 'Not detected',
              ok: Boolean(schema.videos),
            },
            {
              label: 'Categories',
              value: schema.categories ? schema.categories.table : 'Not detected',
              ok: Boolean(schema.categories),
            },
            {
              label: 'Comments',
              value: schema.comments ? schema.comments.table : 'Not detected',
              ok: Boolean(schema.comments),
            },
            {
              label: 'Reports',
              value: schema.reports ? schema.reports.table : 'Not detected',
              ok: Boolean(schema.reports),
            },
            {
              label: 'Verifications',
              value: schema.verifications
                ? schema.verifications.table
                : 'Using user verification fields',
              ok: Boolean(schema.verifications || schema.users?.verifiedCol),
            },
            {
              label: 'Admin Authorization',
              value: schema.hasAdminTable ? 'blade_admins active' : 'Migration needed',
              ok: schema.hasAdminTable,
            },
            {
              label: 'Live App-Entry & Presence RPCs (v6)',
              value: hasActivityRpcs
                ? 'auth.sessions + user_heartbeat + live_sessions v6'
                : 'Run SQL migration v6 to enable',
              ok: hasActivityRpcs,
            },
            {
              label: 'Admin Create User, Moderation & RLS (v6)',
              value: hasModerationEnforcement
                ? 'admin_create_user + moderation & user block RLS v6'
                : 'Run SQL migration v6 to enforce in output app',
              ok: hasModerationEnforcement,
            },
            {
              label: 'Storage Stats RPC',
              value: schema.hasStorageStatsRpc ? 'get_blade_storage_stats()' : 'Fallback mode',
              ok: schema.hasStorageStatsRpc,
            },
          ].map((row) => (
            <div key={row.label} className="p-3 rounded-md border border-zinc-200 bg-zinc-50">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-zinc-900">{row.label}</span>
                {row.ok && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
              </div>
              <div className="font-mono text-[11px] text-zinc-600 mt-1 truncate">{row.value}</div>
            </div>
          ))}
        </div>
      </div>

      <SqlSetupModal
        open={showSqlModal}
        schema={schema}
        onClose={() => setShowSqlModal(false)}
        onRecheck={() => {
          setShowSqlModal(false);
          void handleReinspect();
        }}
      />
    </div>
  );
}
