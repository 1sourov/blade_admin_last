import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BadgeCheck,
  Ban,
  ChevronLeft,
  ChevronRight,
  Database,
  Edit3,
  Eye,
  RotateCcw,
  Search,
  ShieldAlert,
  UserPlus,
  X,
} from 'lucide-react';
import { AddUserModal } from '../components/AddUserModal';
import { SqlSetupModal } from '../components/SqlSetupModal';
import { Avatar } from '../components/ui/Avatar';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { TableSkeleton } from '../components/ui/Skeletons';
import {
  AccountStatusLabel,
  UserPresenceLabel,
  VerificationLabel,
} from '../components/ui/StatusText';
import { useToast } from '../components/ui/ToastProvider';
import { formatCompactNumber, formatDate, formatRelativeTime } from '../lib/formatters';
import { inspectSupabaseSchema } from '../lib/schemaInspector';
import { getSupabaseClient } from '../lib/supabaseClient';
import {
  fetchLiveActiveSessions,
  fetchLiveUserIds,
  fetchUsersPage,
  isUserHeartbeatOnline,
  subscribeOnlinePresence,
  updateUserAccountStatus,
  updateUserProfileFields,
  updateUserVerification,
} from '../services/adminApi';
import type {
  AccountStatus,
  ActiveUserSession,
  AppUser,
  SchemaInspectionResult,
} from '../types/blade';
import type { UsersQuickFilter } from './DashboardPage';

interface UsersPageProps {
  schema: SchemaInspectionResult;
  initialQuickFilter?: UsersQuickFilter;
  onSelectUser: (userId: string) => void;
  onSchemaUpdated?: (next: SchemaInspectionResult) => void;
}

const PAGE_SIZE = 20;

export function UsersPage({
  schema,
  initialQuickFilter,
  onSelectUser,
  onSchemaUpdated,
}: UsersPageProps) {
  const { pushToast } = useToast();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<UsersQuickFilter>(initialQuickFilter ?? 'all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked' | 'suspended'>(
    initialQuickFilter === 'blocked' ? 'blocked' : 'all'
  );
  const [verificationFilter, setVerificationFilter] = useState<
    'all' | 'verified' | 'pending' | 'unverified'
  >(initialQuickFilter === 'verified' ? 'verified' : 'all');
  const [activityFilter, setActivityFilter] = useState<'all' | 'online' | 'offline'>(
    initialQuickFilter === 'online'
      ? 'online'
      : initialQuickFilter === 'offline'
      ? 'offline'
      : 'all'
  );
  const [sortBy, setSortBy] = useState<
    'created_at' | 'followers' | 'videos' | 'views' | 'name' | 'last_active'
  >('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [presenceOnlineIds, setPresenceOnlineIds] = useState<Set<string>>(new Set());
  const [dbLiveUserIds, setDbLiveUserIds] = useState<Set<string>>(new Set());
  const [liveSessionsMap, setLiveSessionsMap] = useState<Map<string, ActiveUserSession>>(
    new Map()
  );
  const presenceIdsRef = useRef<Set<string>>(new Set());
  const presenceSessionsRef = useRef<Map<string, ActiveUserSession>>(new Map());
  const [, setClockTick] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  // Add User Modal
  const [showAddUserModal, setShowAddUserModal] = useState(false);

  // Edit Modal
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editBio, setEditBio] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Confirmation Modal
  const [confirmState, setConfirmState] = useState<{
    type: 'block' | 'unblock' | 'suspend' | 'unverify';
    user: AppUser;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);

  const needsUserBlockSql =
    !schema.rawRpcs.includes('admin_set_user_status') ||
    !schema.rawRpcs.includes('admin_create_user') ||
    !schema.rawRpcs.includes('start_video_watch_session') ||
    !schema.rawRpcs.includes('is_current_user_active_unblocked') ||
    !schema.rawRpcs.includes('get_blade_migration_version') ||
    (schema.migrationVersion ?? 0) < 6 ||
    !schema.users?.blockedCol;

  // Sync preset filter if navigated from Dashboard KPI cards
  useEffect(() => {
    if (!initialQuickFilter) return;
    setQuickFilter(initialQuickFilter);
    setStatusFilter(initialQuickFilter === 'blocked' ? 'blocked' : 'all');
    setVerificationFilter(initialQuickFilter === 'verified' ? 'verified' : 'all');
    setActivityFilter(
      initialQuickFilter === 'online'
        ? 'online'
        : initialQuickFilter === 'offline'
        ? 'offline'
        : 'all'
    );
    setPage(1);
  }, [initialQuickFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const applyQuickFilter = (preset: UsersQuickFilter) => {
    setQuickFilter(preset);
    setStatusFilter(preset === 'blocked' ? 'blocked' : 'all');
    setVerificationFilter(preset === 'verified' ? 'verified' : 'all');
    setActivityFilter(preset === 'online' ? 'online' : preset === 'offline' ? 'offline' : 'all');
    setPage(1);
  };

  const loadUsers = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [dbLiveIds, dbSessions] = await Promise.all([
          fetchLiveUserIds(schema).catch(() => []),
          fetchLiveActiveSessions(schema, Array.from(presenceIdsRef.current)).catch(() => []),
        ]);
        const nextLiveIds = new Set<string>(dbLiveIds);
        const nextSessions = new Map<string, ActiveUserSession>();
        for (const s of dbSessions) {
          nextLiveIds.add(s.userId);
          nextSessions.set(s.userId, s);
        }
        for (const [uid, ps] of presenceSessionsRef.current.entries()) {
          nextLiveIds.add(uid);
          if (!nextSessions.has(uid)) {
            nextSessions.set(uid, ps);
          } else {
            const existing = nextSessions.get(uid)!;
            nextSessions.set(uid, {
              ...existing,
              currentVideoId: existing.currentVideoId ?? ps.currentVideoId,
              currentVideoTitle: existing.currentVideoTitle ?? ps.currentVideoTitle,
              device: existing.device ?? ps.device,
              platform: existing.platform ?? ps.platform,
            });
          }
        }
        setDbLiveUserIds(nextLiveIds);
        setLiveSessionsMap(nextSessions);

        const mergedLiveIds =
          activityFilter === 'online' || activityFilter === 'offline'
            ? Array.from(new Set([...nextLiveIds, ...presenceIdsRef.current]))
            : undefined;

        const res = await fetchUsersPage(schema, {
          page,
          pageSize: PAGE_SIZE,
          search: debouncedSearch,
          statusFilter,
          verificationFilter,
          activityFilter,
          liveUserIds: mergedLiveIds,
          sortBy,
          sortDir,
        });
        setUsers(res.users);
        setTotal(res.total);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load users from Supabase.';
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [
      schema,
      page,
      debouncedSearch,
      statusFilter,
      verificationFilter,
      activityFilter,
      sortBy,
      sortDir,
    ]
  );

  useEffect(() => {
    void loadUsers(false);
  }, [loadUsers]);

  // Auto-refresh every 10s and tick local heartbeat evaluation every 10s
  useEffect(() => {
    const dataTimer = setInterval(() => {
      void loadUsers(true);
    }, 10_000);
    const clockTimer = setInterval(() => {
      setClockTick((t) => t + 1);
    }, 10_000);
    return () => {
      clearInterval(dataTimer);
      clearInterval(clockTimer);
    };
  }, [loadUsers]);

  // Realtime updates for users/presence/videos tables + Realtime Presence
  useEffect(() => {
    if (!schema.users) return;
    const supabase = getSupabaseClient();
    const presenceTable = schema.presenceTable ?? 'user_presence';
    const dbChannel = supabase
      .channel('blade-users-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: schema.users.table },
        () => {
          void loadUsers(true);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: presenceTable },
        () => {
          void loadUsers(true);
        }
      );

    if (schema.videos) {
      dbChannel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: schema.videos.table },
        () => {
          void loadUsers(true);
        }
      );
    }
    dbChannel.subscribe();

    let initialEmission = true;
    const unsubPresence = subscribeOnlinePresence((ids, sessions) => {
      const merged = new Set<string>(ids);
      const sessionMap = new Map<string, ActiveUserSession>();
      for (const sess of sessions) {
        merged.add(sess.userId);
        sessionMap.set(sess.userId, sess);
      }
      presenceIdsRef.current = merged;
      presenceSessionsRef.current = sessionMap;
      setPresenceOnlineIds(merged);
      if (!initialEmission) {
        void loadUsers(true);
      }
      initialEmission = false;
    });

    return () => {
      void supabase.removeChannel(dbChannel);
      unsubPresence();
    };
  }, [schema.users, schema.videos, schema.presenceTable, loadUsers]);

  const openEditModal = (user: AppUser) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditUsername(user.username);
    setEditPhone(user.phone);
    setEditBio(user.bio);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSavingEdit(true);
    try {
      await updateUserProfileFields(schema, editingUser.id, {
        name: editName,
        username: editUsername,
        phone: editPhone,
        bio: editBio,
      });
      pushToast({
        title: 'User updated',
        description: `Saved profile changes for ${editUsername || editName}.`,
        variant: 'success',
      });
      setEditingUser(null);
      await loadUsers(true);
    } catch (err) {
      pushToast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Failed to update user.',
        variant: 'error',
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleStatusChange = async (user: AppUser, nextStatus: AccountStatus) => {
    setActionBusyId(user.id);
    try {
      await updateUserAccountStatus(schema, user.id, nextStatus);
      pushToast({
        title:
          nextStatus === 'blocked'
            ? 'User blocked'
            : nextStatus === 'active'
            ? 'User unblocked / restored'
            : `User status set to ${nextStatus}`,
        description: `${user.username ? `@${user.username}` : user.name || user.id}`,
        variant: 'success',
      });
      await loadUsers(true);
    } catch (err) {
      pushToast({
        title: 'Status update failed',
        description: err instanceof Error ? err.message : 'Operation denied.',
        variant: 'error',
      });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleVerifyToggle = async (user: AppUser, verify: boolean) => {
    setActionBusyId(user.id);
    try {
      await updateUserVerification(schema, user.id, verify ? 'verified' : 'revoked');
      pushToast({
        title: verify ? 'User verified' : 'Verification revoked',
        description: `${user.username ? `@${user.username}` : user.name || user.id}`,
        variant: 'success',
      });
      await loadUsers(true);
    } catch (err) {
      pushToast({
        title: 'Verification update failed',
        description: err instanceof Error ? err.message : 'Operation failed.',
        variant: 'error',
      });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmState) return;
    setConfirmBusy(true);
    try {
      if (confirmState.type === 'block') {
        await updateUserAccountStatus(schema, confirmState.user.id, 'blocked');
        pushToast({
          title: 'User blocked',
          description: 'Restricted from uploading, commenting, liking, and messaging.',
          variant: 'success',
        });
      } else if (confirmState.type === 'unblock') {
        await updateUserAccountStatus(schema, confirmState.user.id, 'active');
        pushToast({
          title: 'User unblocked',
          description: 'Account access restored in real time.',
          variant: 'success',
        });
      } else if (confirmState.type === 'suspend') {
        await updateUserAccountStatus(schema, confirmState.user.id, 'suspended');
        pushToast({ title: 'User suspended', variant: 'success' });
      } else if (confirmState.type === 'unverify') {
        await updateUserVerification(schema, confirmState.user.id, 'revoked');
        pushToast({ title: 'Verification revoked', variant: 'success' });
      }
      setConfirmState(null);
      await loadUsers(true);
    } catch (err) {
      pushToast({
        title: 'Action failed',
        description: err instanceof Error ? err.message : 'Backend rejected operation.',
        variant: 'error',
      });
    } finally {
      setConfirmBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const onlineCol = schema.users?.onlineCol ?? null;

  const liveActiveCount = new Set([...dbLiveUserIds, ...presenceOnlineIds]).size;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-bold text-zinc-950">Users</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 tabular-nums">
              <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
              Live Active Users: {liveActiveCount}
            </span>
          </div>
          <p className="text-sm text-zinc-600 mt-0.5 tabular-nums">
            {total} matching users in <span className="font-mono">{schema.users?.table ?? 'profiles'}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 rounded-lg">
            {(
              [
                { id: 'all', label: 'All Users' },
                { id: 'online', label: 'Active Users (Live)' },
                { id: 'offline', label: 'Offline Users' },
                { id: 'verified', label: 'Verified Users' },
                { id: 'blocked', label: 'Blocked Users' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => applyQuickFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  quickFilter === tab.id
                    ? 'bg-white text-zinc-950 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-950'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowAddUserModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md shadow-sm transition-colors whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" />
            Add User
          </button>
        </div>
      </div>

      {/* Search, Filters & Sort */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, username, email, phone, or user ID…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-red-600"
          />
        </div>

        <select
          aria-label="Filter by account status"
          value={statusFilter}
          onChange={(e) => {
            const val = e.target.value as typeof statusFilter;
            setStatusFilter(val);
            setQuickFilter(val === 'blocked' ? 'blocked' : 'all');
            setPage(1);
          }}
          className="px-3 py-2 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
          <option value="suspended">Suspended</option>
        </select>

        <select
          aria-label="Filter by verification"
          value={verificationFilter}
          onChange={(e) => {
            const val = e.target.value as typeof verificationFilter;
            setVerificationFilter(val);
            if (val === 'verified') setQuickFilter('verified');
            setPage(1);
          }}
          className="px-3 py-2 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
        >
          <option value="all">All Verifications</option>
          <option value="verified">Verified</option>
          <option value="pending">Pending</option>
          <option value="unverified">Unverified</option>
        </select>

        <select
          aria-label="Sort users"
          value={`${sortBy}:${sortDir}`}
          onChange={(e) => {
            const [col, dir] = e.target.value.split(':');
            setSortBy(col as typeof sortBy);
            setSortDir(dir as 'asc' | 'desc');
            setPage(1);
          }}
          className="px-3 py-2 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
        >
          <option value="created_at:desc">Newest Registered</option>
          <option value="created_at:asc">Oldest Registered</option>
          <option value="last_active:desc">Recently Active</option>
          <option value="followers:desc">Most Followers</option>
          <option value="views:desc">Most Views</option>
          <option value="name:asc">Name (A–Z)</option>
        </select>
      </div>

      {needsUserBlockSql && (
        <div className="bg-zinc-950 text-white rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 border border-zinc-800">
          <div className="text-xs space-y-1">
            <div className="font-semibold text-sm">
              Enable Full Android User Blocking Enforcement
            </div>
            <p className="text-zinc-300">
              Run the updated SQL migration to install{' '}
              <span className="font-mono">admin_set_user_status()</span>,{' '}
              <span className="font-mono">is_current_user_active_unblocked()</span>, and restrictive
              RLS across videos, comments, likes, followers, messages, and storage so blocked users
              are restricted immediately in the Android app.
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

      {/* Responsive Table */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        {loading ? (
          <TableSkeleton rows={8} cols={8} />
        ) : users.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <p className="text-sm font-semibold text-zinc-950">No users found</p>
            <p className="text-xs text-zinc-500 mt-1">
              {debouncedSearch ||
              statusFilter !== 'all' ||
              verificationFilter !== 'all' ||
              activityFilter !== 'all'
                ? 'Try adjusting your search query or filters.'
                : 'No users exist in the connected Supabase database yet.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                  <th className="py-3 px-4 whitespace-nowrap">User &amp; ID</th>
                  <th className="py-3 px-4 whitespace-nowrap">Username</th>
                  <th className="py-3 px-4 whitespace-nowrap">Live Presence</th>
                  <th className="py-3 px-4 whitespace-nowrap">Account Status</th>
                  <th className="py-3 px-4 whitespace-nowrap">Verification</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Followers</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Videos</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Views</th>
                  <th className="py-3 px-4 whitespace-nowrap">Registered</th>
                  <th className="py-3 px-4 whitespace-nowrap">Last Heartbeat</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-sm">
                {users.map((u) => {
                  const busy = actionBusyId === u.id;
                  const rawOnline = onlineCol
                    ? (u.raw[onlineCol] as boolean | null | undefined)
                    : undefined;
                  const rawUserId = typeof u.raw.user_id === 'string' ? u.raw.user_id : null;
                  const activeSession =
                    liveSessionsMap.get(u.id) ??
                    (rawUserId ? liveSessionsMap.get(rawUserId) : undefined);
                  const liveOnline =
                    Boolean(activeSession) ||
                    dbLiveUserIds.has(u.id) ||
                    (rawUserId ? dbLiveUserIds.has(rawUserId) : false) ||
                    presenceOnlineIds.has(u.id) ||
                    (rawUserId ? presenceOnlineIds.has(rawUserId) : false) ||
                    isUserHeartbeatOnline(u.lastActiveAt, rawOnline);

                  return (
                    <tr key={u.id} className="hover:bg-zinc-50 transition-colors">
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => onSelectUser(u.id)}
                          className="flex items-center gap-3 text-left group"
                        >
                          <Avatar src={u.avatarUrl} name={u.name || u.username || u.email} />
                          <div className="min-w-0">
                            <div className="font-semibold text-zinc-950 group-hover:text-red-600 transition-colors truncate max-w-[180px]">
                              {u.name || 'Unnamed User'}
                            </div>
                            <div className="text-[11px] font-mono text-zinc-500 select-all">
                              {u.id}
                            </div>
                            {(u.email || u.phone) && (
                              <div className="text-[11px] text-zinc-400 truncate max-w-[200px]">
                                {u.email || u.phone}
                              </div>
                            )}
                          </div>
                        </button>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-zinc-700 whitespace-nowrap">
                        {u.username ? `@${u.username}` : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="space-y-0.5">
                          <UserPresenceLabel isOnline={liveOnline} />
                          {activeSession?.currentVideoId && (
                            <div className="text-[11px] text-red-700 font-medium truncate max-w-[190px]">
                              Watching: {activeSession.currentVideoTitle || activeSession.currentVideoId}
                            </div>
                          )}
                          {(activeSession?.device || activeSession?.platform) && (
                            <div className="text-[10px] text-zinc-400 truncate max-w-[190px]">
                              {[activeSession.device, activeSession.platform]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <AccountStatusLabel status={u.accountStatus} />
                      </td>
                      <td className="py-3 px-4">
                        <VerificationLabel state={u.verificationStatus} />
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-xs font-medium text-zinc-900">
                        {formatCompactNumber(u.followersCount)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-xs font-semibold text-zinc-950">
                        {formatCompactNumber(u.videoCount)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-xs text-zinc-700">
                        {formatCompactNumber(u.totalViews)}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-600 whitespace-nowrap tabular-nums">
                        {formatDate(u.joinedAt)}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-500 whitespace-nowrap">
                        {formatRelativeTime(u.lastActiveAt)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectUser(u.id)}
                            title="View user details"
                            className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 rounded transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(u)}
                            title="Edit user"
                            className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 rounded transition-colors"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          {u.isVerified ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setConfirmState({ type: 'unverify', user: u })}
                              title="Revoke verification"
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            >
                              <BadgeCheck className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleVerifyToggle(u, true)}
                              title="Verify user"
                              className="p-1.5 text-zinc-500 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
                            >
                              <BadgeCheck className="w-4 h-4" />
                            </button>
                          )}

                          {u.accountStatus === 'blocked' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setConfirmState({ type: 'unblock', user: u })}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 rounded transition-colors whitespace-nowrap shrink-0"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Unblock
                            </button>
                          ) : u.accountStatus === 'suspended' ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleStatusChange(u, 'active')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 rounded transition-colors whitespace-nowrap shrink-0"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Restore
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmState({ type: 'block', user: u })}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded transition-colors whitespace-nowrap shrink-0"
                              >
                                <Ban className="w-3.5 h-3.5" />
                                Block
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmState({ type: 'suspend', user: u })}
                                title="Suspend user"
                                className="p-1.5 text-amber-700 hover:bg-amber-50 rounded transition-colors"
                              >
                                <ShieldAlert className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmState({ type: 'block', user: u })}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded transition-colors whitespace-nowrap shrink-0"
                              >
                                <Ban className="w-3.5 h-3.5" />
                                Block
                              </button>
                            </>
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

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 bg-zinc-50 text-xs text-zinc-600">
          <div className="tabular-nums">
            Page {page} of {totalPages} · {total} users
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-zinc-300 rounded hover:bg-zinc-100 disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-zinc-300 rounded hover:bg-zinc-100 disabled:opacity-40"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md bg-white border border-zinc-200 rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <h3 className="text-base font-bold text-zinc-950">Edit User Profile</h3>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="p-1 text-zinc-400 hover:text-zinc-950"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
              {schema.users?.nameCol && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              )}
              {schema.users?.usernameCol && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">Username</label>
                  <input
                    type="text"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              )}
              {schema.users?.phoneCol && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">Phone</label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              )}
              {schema.users?.bioCol && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">Bio</label>
                  <textarea
                    rows={3}
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-md hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 text-sm font-semibold text-white bg-zinc-950 hover:bg-zinc-800 rounded-md disabled:opacity-50"
                >
                  {savingEdit ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmModal
        open={Boolean(confirmState)}
        title={
          confirmState?.type === 'block'
            ? 'Block User Account'
            : confirmState?.type === 'unblock'
            ? 'Unblock User Account'
            : confirmState?.type === 'suspend'
            ? 'Suspend User Account'
            : 'Revoke Verification'
        }
        description={
          confirmState?.type === 'block'
            ? `Block ${confirmState.user.username ? `@${confirmState.user.username}` : confirmState.user.id}? Their account and data will remain intact, but the Android app and RLS rules will immediately block uploads, comments, likes, and messaging.`
            : confirmState?.type === 'unblock'
            ? `Unblock ${confirmState.user.username ? `@${confirmState.user.username}` : confirmState.user.id} and restore normal Android app access immediately?`
            : confirmState?.type === 'suspend'
            ? `Suspend ${confirmState.user.username ? `@${confirmState.user.username}` : confirmState.user.id}?`
            : `Revoke verified badge for ${confirmState?.user.username ? `@${confirmState.user.username}` : confirmState?.user.id}?`
        }
        confirmLabel={
          confirmState?.type === 'block'
            ? 'Block User'
            : confirmState?.type === 'unblock'
            ? 'Unblock User'
            : confirmState?.type === 'suspend'
            ? 'Suspend User'
            : 'Revoke Badge'
        }
        destructive={confirmState?.type === 'block'}
        loading={confirmBusy}
        onConfirm={() => void handleConfirmAction()}
        onCancel={() => setConfirmState(null)}
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

      <AddUserModal
        open={showAddUserModal}
        schema={schema}
        onClose={() => setShowAddUserModal(false)}
        onCreated={() => {
          void loadUsers(true);
        }}
      />
    </div>
  );
}
