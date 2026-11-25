import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, RotateCcw, Search, XCircle } from 'lucide-react';
import { Avatar } from '../components/ui/Avatar';
import { TableSkeleton } from '../components/ui/Skeletons';
import { VerificationLabel } from '../components/ui/StatusText';
import { useToast } from '../components/ui/ToastProvider';
import { formatCompactNumber, formatDate, isSafeHttpUrl } from '../lib/formatters';
import { getSupabaseClient } from '../lib/supabaseClient';
import { fetchVerificationQueue, updateUserVerification } from '../services/adminApi';
import type {
  SchemaInspectionResult,
  VerificationRequestRecord,
  VerificationState,
} from '../types/blade';

interface VerificationPageProps {
  schema: SchemaInspectionResult;
  onSelectUser: (userId: string) => void;
}

export function VerificationPage({ schema, onSelectUser }: VerificationPageProps) {
  const { pushToast } = useToast();
  const [allItems, setAllItems] = useState<VerificationRequestRecord[]>([]);
  const [filter, setFilter] = useState<'all' | VerificationState>('verified');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadQueue = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetchVerificationQueue(schema, 'all');
        setAllItems(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load verification queue.');
      } finally {
        setLoading(false);
      }
    },
    [schema]
  );

  useEffect(() => {
    void loadQueue(false);
  }, [loadQueue]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    const channel = supabase.channel('blade-verification-realtime');
    const tables = [schema.verifications?.table, schema.users?.table].filter(Boolean) as string[];
    for (const table of tables) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => void loadQueue(true)
      );
    }
    if (tables.length > 0) {
      channel.subscribe();
    }
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [schema, loadQueue]);

  const counts = useMemo(() => {
    const tally = {
      verified: 0,
      pending: 0,
      rejected: 0,
      revoked: 0,
      all: allItems.length,
    };
    for (const item of allItems) {
      if (item.status === 'verified') tally.verified += 1;
      else if (item.status === 'pending') tally.pending += 1;
      else if (item.status === 'rejected') tally.rejected += 1;
      else if (item.status === 'revoked') tally.revoked += 1;
    }
    return tally;
  }, [allItems]);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((item) => {
      if (filter !== 'all' && item.status !== filter) return false;
      if (!q) return true;
      return (
        item.userName.toLowerCase().includes(q) ||
        item.userUsername.toLowerCase().includes(q) ||
        item.userId.toLowerCase().includes(q) ||
        item.userEmail.toLowerCase().includes(q)
      );
    });
  }, [allItems, filter, search]);

  const handleAction = async (
    item: VerificationRequestRecord,
    nextState: VerificationState
  ) => {
    setBusyId(item.id);
    try {
      await updateUserVerification(
        schema,
        item.userId,
        nextState,
        schema.verifications && item.id !== item.userId ? item.id : undefined
      );
      pushToast({
        title: `Verification ${nextState}`,
        description: item.userUsername ? `@${item.userUsername}` : item.userId,
        variant: 'success',
      });
      await loadQueue(true);
    } catch (err) {
      pushToast({
        title: 'Verification update failed',
        description: err instanceof Error ? err.message : 'Database rejected update.',
        variant: 'error',
      });
    } finally {
      setBusyId(null);
    }
  };

  const tabs: Array<{ id: 'all' | VerificationState; label: string; count: number }> = [
    { id: 'verified', label: 'Verified Users', count: counts.verified },
    { id: 'pending', label: 'Pending', count: counts.pending },
    { id: 'rejected', label: 'Rejected', count: counts.rejected },
    { id: 'revoked', label: 'Revoked', count: counts.revoked },
    { id: 'all', label: 'All', count: counts.all },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-zinc-950">USER VERIFICATION</h1>
          <p className="text-sm text-zinc-600 mt-0.5">
            Review verification requests and manage all verified creators in real time without
            duplicate records.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 rounded-lg">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap tabular-nums ${
                filter === tab.id
                  ? 'bg-white text-zinc-950 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-950'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-3">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by username, name, email, or user ID…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        {loading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : items.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <BadgeCheck className="w-8 h-8 text-zinc-300 mx-auto" />
            <p className="text-sm font-semibold text-zinc-950 mt-3">
              No {filter === 'all' ? '' : filter} verification records
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              Verified users and verification requests from Supabase appear here automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                  <th className="py-3 px-4">Creator</th>
                  <th className="py-3 px-4">User ID</th>
                  <th className="py-3 px-4">Verification Status</th>
                  <th className="py-3 px-4 text-right">Followers</th>
                  <th className="py-3 px-4 text-right">Videos</th>
                  <th className="py-3 px-4">Submitted / Joined</th>
                  <th className="py-3 px-4">Document / Note</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-sm">
                {items.map((item) => {
                  const docUrl = isSafeHttpUrl(item.documentUrl);
                  const isBusy = busyId === item.id;
                  return (
                    <tr key={item.userId} className="hover:bg-zinc-50">
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => onSelectUser(item.userId)}
                          className="flex items-center gap-3 text-left group"
                        >
                          <Avatar
                            src={item.userAvatarUrl}
                            name={item.userName || item.userUsername || item.userId}
                          />
                          <div>
                            <div className="font-semibold text-zinc-950 group-hover:text-red-600">
                              {item.userName || 'Unnamed User'}
                            </div>
                            <div className="text-xs font-mono text-zinc-500">
                              {item.userUsername
                                ? `@${item.userUsername}`
                                : item.userEmail || 'No username'}
                            </div>
                          </div>
                        </button>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-zinc-600 select-all">
                        {item.userId}
                      </td>
                      <td className="py-3 px-4">
                        <VerificationLabel state={item.status} />
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-xs">
                        {formatCompactNumber(item.followersCount)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-xs">
                        {formatCompactNumber(item.videoCount)}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-600 whitespace-nowrap tabular-nums">
                        {formatDate(item.createdAt)}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-600 max-w-xs">
                        {docUrl && (
                          <a
                            href={docUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-red-600 hover:underline font-medium mr-2"
                          >
                            View ID Document
                          </a>
                        )}
                        <span className="truncate">{item.note || (docUrl ? '' : '—')}</span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          {item.status !== 'verified' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleAction(item, 'verified')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-zinc-950 hover:bg-zinc-800 rounded disabled:opacity-50 whitespace-nowrap"
                            >
                              <BadgeCheck className="w-3.5 h-3.5 text-red-500" />
                              Verify
                            </button>
                          )}
                          {item.status === 'pending' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleAction(item, 'rejected')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded disabled:opacity-50 whitespace-nowrap"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Reject
                            </button>
                          )}
                          {item.status === 'verified' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleAction(item, 'revoked')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 border border-zinc-300 hover:bg-zinc-100 rounded disabled:opacity-50 whitespace-nowrap"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Revoke
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
