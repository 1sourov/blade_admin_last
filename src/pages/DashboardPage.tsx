import { useCallback, useEffect, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { SqlSetupModal } from '../components/SqlSetupModal';
import { MetricChartCard } from '../components/ui/Charts';
import { KpiGridSkeleton } from '../components/ui/Skeletons';
import { useToast } from '../components/ui/ToastProvider';
import { formatBytes, formatCompactNumber } from '../lib/formatters';
import { inspectSupabaseSchema } from '../lib/schemaInspector';
import { getSupabaseClient } from '../lib/supabaseClient';
import {
  fetchAnalyticsTimeSeries,
  fetchDashboardMetrics,
  subscribeOnlinePresence,
} from '../services/adminApi';
import type {
  DashboardMetrics,
  NavSection,
  SchemaInspectionResult,
  TimeSeriesPoint,
} from '../types/blade';

export type UsersQuickFilter = 'all' | 'online' | 'offline' | 'verified' | 'blocked';

interface DashboardPageProps {
  schema: SchemaInspectionResult;
  onNavigate: (section: NavSection, usersPreset?: UsersQuickFilter) => void;
  onSchemaUpdated?: (next: SchemaInspectionResult) => void;
}

export function DashboardPage({ schema, onNavigate, onSchemaUpdated }: DashboardPageProps) {
  const { pushToast } = useToast();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [series, setSeries] = useState<TimeSeriesPoint[]>([]);
  const [presenceOnlineIds, setPresenceOnlineIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSqlModal, setShowSqlModal] = useState(false);

  const needsActivitySql =
    !schema.rawRpcs.includes('get_blade_activity_stats') ||
    !schema.rawRpcs.includes('user_heartbeat') ||
    !schema.rawRpcs.includes('start_video_watch_session') ||
    !schema.rawRpcs.includes('admin_set_video_moderation') ||
    !schema.rawRpcs.includes('admin_set_user_status') ||
    !schema.rawRpcs.includes('admin_create_user') ||
    !schema.rawRpcs.includes('is_video_publicly_visible') ||
    !schema.rawRpcs.includes('get_blade_migration_version') ||
    (schema.migrationVersion ?? 0) < 6;

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [m, s] = await Promise.all([
          fetchDashboardMetrics(schema),
          fetchAnalyticsTimeSeries(schema, 14),
        ]);
        setMetrics(m);
        setSeries(s);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load dashboard metrics.';
        setError(msg);
        if (!silent) {
          pushToast({ title: 'Dashboard load failed', description: msg, variant: 'error' });
        }
      } finally {
        setLoading(false);
      }
    },
    [schema, pushToast]
  );

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  // Automatic 10-second refresh so 2-minute user heartbeats & expired watching sessions stay accurate without manual reload
  useEffect(() => {
    const interval = setInterval(() => {
      void loadData(true);
    }, 10_000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Realtime DB sync + Realtime Presence tracking for live Android active users & video watching
  useEffect(() => {
    const supabase = getSupabaseClient();
    const dbChannel = supabase.channel('blade-dashboard-realtime');
    const tables = Array.from(
      new Set(
        [
          schema.users?.table,
          schema.videos?.table,
          schema.verifications?.table,
          schema.comments?.table,
          schema.presenceTable ?? 'user_presence',
        ].filter(Boolean) as string[]
      )
    );

    for (const table of tables) {
      dbChannel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          void loadData(true);
        }
      );
    }
    dbChannel.subscribe();

    const unsubPresence = subscribeOnlinePresence((ids) => {
      setPresenceOnlineIds(ids);
    });

    return () => {
      void supabase.removeChannel(dbChannel);
      unsubPresence();
    };
  }, [schema, loadData]);

  const mergedLiveCount =
    metrics === null
      ? presenceOnlineIds.length
      : new Set([...(metrics.liveUserIds ?? []), ...presenceOnlineIds]).size;

  const effectiveLiveUsers =
    metrics === null
      ? presenceOnlineIds.length > 0
        ? presenceOnlineIds.length
        : null
      : metrics.liveActiveUsers !== null
      ? Math.max(metrics.liveActiveUsers, mergedLiveCount)
      : mergedLiveCount;

  const effectiveActiveToday =
    metrics === null
      ? null
      : metrics.activeUsersToday !== null || effectiveLiveUsers !== null
      ? Math.max(metrics.activeUsersToday ?? 0, effectiveLiveUsers ?? 0)
      : null;

  const effectiveActive7d =
    metrics === null
      ? null
      : metrics.activeUsers7d !== null || effectiveActiveToday !== null
      ? Math.max(metrics.activeUsers7d ?? 0, effectiveActiveToday ?? 0)
      : null;

  const effectiveOfflineUsers =
    metrics === null
      ? null
      : metrics.totalUsers !== null && effectiveLiveUsers !== null
      ? Math.max(0, metrics.totalUsers - effectiveLiveUsers)
      : metrics.offlineUsers;

  const activityKpis: Array<{
    label: string;
    value: string;
    liveDot?: boolean;
    highlightRed?: boolean;
    action?: () => void;
  }> = metrics
    ? [
        {
          label: 'Total Registered Users',
          value: formatCompactNumber(metrics.totalUsers),
          action: () => onNavigate('users', 'all'),
        },
        {
          label: 'Currently Active Users (LIVE)',
          value: formatCompactNumber(effectiveLiveUsers),
          liveDot: true,
          action: () => onNavigate('users', 'online'),
        },
        {
          label: 'Active Users Today',
          value: formatCompactNumber(effectiveActiveToday),
          action: () => onNavigate('users', 'all'),
        },
        {
          label: 'Active Users Last 7 Days',
          value: formatCompactNumber(effectiveActive7d),
        },
        {
          label: 'Offline Users',
          value: formatCompactNumber(effectiveOfflineUsers),
          action: () => onNavigate('users', 'offline'),
        },
        {
          label: 'New Users Today',
          value: formatCompactNumber(metrics.newUsersToday),
        },
      ]
    : [];

  const platformKpis: Array<{
    label: string;
    value: string;
    highlightRed?: boolean;
    action?: () => void;
  }> = metrics
    ? [
        {
          label: 'Verified Users',
          value: formatCompactNumber(metrics.verifiedUsers),
          action: () => onNavigate('verification'),
        },
        {
          label: 'Blocked Users',
          value: formatCompactNumber(metrics.blockedUsers),
          highlightRed: (metrics.blockedUsers ?? 0) > 0,
          action: () => onNavigate('users', 'blocked'),
        },
        {
          label: 'Total Videos',
          value: formatCompactNumber(metrics.totalVideos),
          action: () => onNavigate('videos'),
        },
        { label: 'Uploaded Today', value: formatCompactNumber(metrics.videosUploadedToday) },
        { label: 'Total Views', value: formatCompactNumber(metrics.totalViews) },
        { label: 'Total Likes', value: formatCompactNumber(metrics.totalLikes) },
        { label: 'Total Comments', value: formatCompactNumber(metrics.totalComments) },
        { label: 'Total Followers', value: formatCompactNumber(metrics.totalFollowers) },
        {
          label: 'Pending Verifications',
          value: formatCompactNumber(metrics.pendingVerifications),
          highlightRed: (metrics.pendingVerifications ?? 0) > 0,
          action: () => onNavigate('verification'),
        },
        {
          label: 'Storage Used',
          value: metrics.storage.available
            ? formatBytes(metrics.storage.totalBytesUsed)
            : 'Unavailable',
          action: () => onNavigate('storage'),
        },
        {
          label: 'Storage Available',
          value:
            metrics.storage.totalBytesQuota !== null && metrics.storage.totalBytesUsed !== null
              ? formatBytes(
                  Math.max(0, metrics.storage.totalBytesQuota - metrics.storage.totalBytesUsed)
                )
              : 'Unavailable',
          action: () => onNavigate('storage'),
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-zinc-950">Platform Overview</h1>
          <p className="text-sm text-zinc-600 mt-0.5">
            Live Supabase metrics and 2-minute heartbeat video watch sessions synced with your Android application.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-950 text-white text-xs font-semibold tabular-nums">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span>
              Live Active Users:{' '}
              {effectiveLiveUsers === null ? '—' : String(effectiveLiveUsers).padStart(2, '0')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void loadData(false)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-zinc-800 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => onNavigate('upload-video')}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors whitespace-nowrap"
          >
            Upload Video
          </button>
        </div>
      </div>

      {needsActivitySql && (
        <div className="bg-zinc-950 text-white rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 border border-zinc-800">
          <div className="text-xs space-y-1">
            <div className="font-semibold text-sm">
              Supabase SQL Update v6 Required for Immediate App-Entry Live User Tracking &amp; Admin Sync
            </div>
            <p className="text-zinc-300">
              Run the non-destructive SQL migration v6 to enable{' '}
              <span className="font-mono">user_heartbeat()</span>,{' '}
              <span className="font-mono">blade_get_auth_session_activity()</span>,{' '}
              <span className="font-mono">get_blade_activity_stats()</span>, and{' '}
              <span className="font-mono">admin_create_user()</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowSqlModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md whitespace-nowrap shrink-0"
          >
            <Database className="w-3.5 h-3.5" />
            Open SQL Migration
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !metrics ? (
        <KpiGridSkeleton count={12} />
      ) : (
        <div className="space-y-4">
          {/* Real-Time Active User Monitoring */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Real-Time User Activity
              </h2>
              <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
                Auto-updating · 2m heartbeat window
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {activityKpis.map((item) => {
                const Tag = item.action ? 'button' : 'div';
                return (
                  <Tag
                    key={item.label}
                    {...(item.action ? { type: 'button' as const, onClick: item.action } : {})}
                    className={`text-left bg-white border rounded-lg p-4 transition-colors ${
                      item.liveDot
                        ? 'border-zinc-950 bg-zinc-950 text-white'
                        : 'border-zinc-200 text-zinc-950'
                    } ${item.action ? 'hover:border-red-600 cursor-pointer' : ''}`}
                  >
                    <div
                      className={`flex items-center gap-1.5 text-xs font-medium truncate ${
                        item.liveDot ? 'text-zinc-300' : 'text-zinc-500'
                      }`}
                    >
                      {item.liveDot && (
                        <span
                          className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">{item.label}</span>
                    </div>
                    <div
                      className={`text-2xl font-bold mt-2 tabular-nums ${
                        item.liveDot
                          ? 'text-white'
                          : item.highlightRed
                          ? 'text-red-600'
                          : 'text-zinc-950'
                      }`}
                    >
                      {item.value}
                    </div>
                  </Tag>
                );
              })}
            </div>
          </div>

          {/* Content, Moderation & Storage Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {platformKpis.map((item) => {
              const Tag = item.action ? 'button' : 'div';
              return (
                <Tag
                  key={item.label}
                  {...(item.action ? { type: 'button' as const, onClick: item.action } : {})}
                  className={`text-left bg-white border border-zinc-200 rounded-lg p-4 transition-colors ${
                    item.action ? 'hover:border-zinc-400 cursor-pointer' : ''
                  }`}
                >
                  <div className="text-xs font-medium text-zinc-500 truncate">{item.label}</div>
                  <div
                    className={`text-xl font-bold mt-2 tabular-nums ${
                      item.highlightRed ? 'text-red-600' : 'text-zinc-950'
                    }`}
                  >
                    {item.value}
                  </div>
                </Tag>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MetricChartCard
          title="User Growth"
          subtitle="New user registrations over the last 14 days"
          data={series}
          seriesKey="users"
          type="area"
          accent="black"
          loading={loading}
        />
        <MetricChartCard
          title="Video Uploads"
          subtitle="Daily uploaded videos over the last 14 days"
          data={series}
          seriesKey="videos"
          type="bar"
          accent="red"
          loading={loading}
        />
        <MetricChartCard
          title="Views"
          subtitle="Video views attributed to uploads in the last 14 days"
          data={series}
          seriesKey="views"
          type="area"
          accent="black"
          loading={loading}
        />
        <MetricChartCard
          title="Engagement"
          subtitle="Combined likes and comments over the last 14 days"
          data={series}
          seriesKey="engagement"
          type="bar"
          accent="black"
          loading={loading}
        />
      </div>

      <MetricChartCard
        title="Active Users"
        subtitle="Users with recorded activity per day over the last 14 days"
        data={series}
        seriesKey="activeUsers"
        type="area"
        accent="red"
        loading={loading}
      />

      <SqlSetupModal
        open={showSqlModal}
        schema={schema}
        onClose={() => setShowSqlModal(false)}
        onRecheck={async () => {
          setShowSqlModal(false);
          try {
            const next = await inspectSupabaseSchema();
            onSchemaUpdated?.(next);
            pushToast({ title: 'Supabase schema refreshed', variant: 'success' });
          } catch (err) {
            pushToast({
              title: 'Schema check failed',
              description: err instanceof Error ? err.message : 'Could not inspect schema.',
              variant: 'error',
            });
          }
        }}
      />
    </div>
  );
}
