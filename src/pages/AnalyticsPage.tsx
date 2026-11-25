import { useCallback, useEffect, useState } from 'react';
import { MetricChartCard } from '../components/ui/Charts';
import { Avatar } from '../components/ui/Avatar';
import { formatCompactNumber } from '../lib/formatters';
import {
  fetchAnalyticsTimeSeries,
  fetchUsersPage,
  fetchVideosPage,
} from '../services/adminApi';
import type {
  AppUser,
  SchemaInspectionResult,
  TimeSeriesPoint,
  VideoRecord,
} from '../types/blade';

interface AnalyticsPageProps {
  schema: SchemaInspectionResult;
  onSelectUser: (userId: string) => void;
}

export function AnalyticsPage({ schema, onSelectUser }: AnalyticsPageProps) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [series, setSeries] = useState<TimeSeriesPoint[]>([]);
  const [topVideos, setTopVideos] = useState<VideoRecord[]>([]);
  const [topCreators, setTopCreators] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ts, vids, users] = await Promise.all([
        fetchAnalyticsTimeSeries(schema, days),
        schema.videos
          ? fetchVideosPage(schema, {
              page: 1,
              pageSize: 8,
              search: '',
              statusFilter: 'all',
              visibilityFilter: 'all',
              categoryFilter: 'all',
              sortBy: 'views',
              sortDir: 'desc',
            })
          : Promise.resolve({ videos: [], total: 0 }),
        schema.users
          ? fetchUsersPage(schema, {
              page: 1,
              pageSize: 8,
              search: '',
              statusFilter: 'all',
              verificationFilter: 'all',
              sortBy: 'followers',
              sortDir: 'desc',
            })
          : Promise.resolve({ users: [], total: 0 }),
      ]);
      setSeries(ts);
      setTopVideos(vids.videos);
      setTopCreators(users.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, [schema, days]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-zinc-950">ANALYTICS</h1>
          <p className="text-sm text-zinc-600 mt-0.5">
            Real database time-series and top-performing creators &amp; videos.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg">
          {([7, 30, 90] as const).map((windowDays) => (
            <button
              key={windowDays}
              type="button"
              onClick={() => setDays(windowDays)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                days === windowDays
                  ? 'bg-white text-zinc-950 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-950'
              }`}
            >
              {windowDays} Days
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MetricChartCard
          title="User Growth"
          subtitle={`Daily signups (${days}d)`}
          data={series}
          seriesKey="users"
          type="area"
          accent="black"
          loading={loading}
        />
        <MetricChartCard
          title="Video Uploads"
          subtitle={`Daily uploads (${days}d)`}
          data={series}
          seriesKey="videos"
          type="bar"
          accent="red"
          loading={loading}
        />
        <MetricChartCard
          title="Views"
          subtitle={`Views by upload date (${days}d)`}
          data={series}
          seriesKey="views"
          type="area"
          accent="black"
          loading={loading}
        />
        <MetricChartCard
          title="Engagement"
          subtitle={`Likes + comments (${days}d)`}
          data={series}
          seriesKey="engagement"
          type="bar"
          accent="black"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Creators */}
        <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-200">
            <h2 className="text-sm font-bold text-zinc-950">Top Creators by Followers</h2>
          </div>
          {topCreators.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-500">No data available</div>
          ) : (
            <div className="divide-y divide-zinc-200">
              {topCreators.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onSelectUser(u.id)}
                  className="w-full px-5 py-3 flex items-center justify-between gap-3 hover:bg-zinc-50 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar src={u.avatarUrl} name={u.name || u.username} size="sm" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-950 truncate">
                        {u.name || 'Unnamed User'}
                      </div>
                      <div className="text-xs font-mono text-zinc-500 truncate">
                        {u.username ? `@${u.username}` : u.id}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-zinc-950 tabular-nums">
                      {formatCompactNumber(u.followersCount)}
                    </div>
                    <div className="text-[11px] text-zinc-500 tabular-nums">
                      {u.videoCount} videos
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Top Videos */}
        <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-200">
            <h2 className="text-sm font-bold text-zinc-950">Top Videos by Views</h2>
          </div>
          {topVideos.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-500">No data available</div>
          ) : (
            <div className="divide-y divide-zinc-200">
              {topVideos.map((v) => (
                <div
                  key={v.id}
                  className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-zinc-50"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-950 truncate">
                      {v.caption || 'Untitled video'}
                    </div>
                    <div className="text-xs text-zinc-500 truncate">
                      {v.ownerUsername ? `@${v.ownerUsername}` : v.ownerId} ·{' '}
                      {v.categoryName || 'Uncategorized'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-zinc-950 tabular-nums">
                      {formatCompactNumber(v.viewsCount)} views
                    </div>
                    <div className="text-[11px] text-zinc-500 tabular-nums">
                      {formatCompactNumber(v.likesCount)} likes
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
