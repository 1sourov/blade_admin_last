import { createClient } from '@supabase/supabase-js';
import type {
  AccountStatus,
  ActiveUserSession,
  AdminRecord,
  AppUser,
  CategoryRecord,
  CommentRecord,
  DashboardMetrics,
  DeletionStrategy,
  ReportRecord,
  SchemaInspectionResult,
  StorageBucketSummary,
  StorageObjectItem,
  StorageStats,
  TimeSeriesPoint,
  UserTableMapping,
  VerificationRequestRecord,
  VerificationState,
  VideoRecord,
  VideoStatus,
  VideoTableMapping,
  VideoVisibility,
} from '../types/blade';
import {
  getActiveSupabaseConfig,
  getPreferences,
  getSupabaseClient,
  savePreferences,
} from '../lib/supabaseClient';
import { slugifyCategory } from '../lib/formatters';

function getNum(row: Record<string, unknown>, col: string | null): number {
  if (!col) return 0;
  const val = row[col];
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) {
    return Number(val);
  }
  return 0;
}

function getStr(row: Record<string, unknown>, col: string | null): string {
  if (!col) return '';
  const val = row[col];
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return '';
}

export const HEARTBEAT_ONLINE_WINDOW_MS = 2 * 60 * 1000;

export const ACTIVITY_TIMESTAMP_COLS = [
  'last_active_at',
  'last_seen_at',
  'last_heartbeat_at',
  'last_online_at',
  'last_activity_at',
  'last_seen',
  'last_active',
  'seen_at',
  'online_at',
] as const;

export function extractLatestUserActivityTs(
  row: Record<string, unknown>,
  primaryCol?: string | null
): string | null {
  const candidates = primaryCol
    ? [primaryCol, ...ACTIVITY_TIMESTAMP_COLS.filter((c) => c !== primaryCol)]
    : [...ACTIVITY_TIMESTAMP_COLS];
  let bestStr: string | null = null;
  let bestMs = -Infinity;
  for (const col of candidates) {
    const raw = row[col];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const ms = new Date(raw).getTime();
    if (!Number.isNaN(ms) && ms > bestMs) {
      bestMs = ms;
      bestStr = raw;
    }
  }
  return bestStr;
}

export function extractPresenceUserIds(channel: {
  presenceState: () => Record<string, unknown[]>;
}): string[] {
  const state = channel.presenceState();
  const ids = new Set<string>();
  for (const [key, metas] of Object.entries(state)) {
    if (!Array.isArray(metas) || metas.length === 0) {
      if (key) ids.add(key);
      continue;
    }
    let addedFromMeta = false;
    let sawOnlyObserver = true;
    for (const rawMeta of metas) {
      const meta = (rawMeta && typeof rawMeta === 'object' ? rawMeta : {}) as Record<
        string,
        unknown
      >;
      if (meta.role === 'admin_observer') {
        continue;
      }
      sawOnlyObserver = false;
      const candidate =
        (meta.user_id as string | undefined) ||
        (meta.userId as string | undefined) ||
        (meta.uid as string | undefined) ||
        (meta.id as string | undefined);
      if (typeof candidate === 'string' && candidate.trim()) {
        ids.add(candidate.trim());
        addedFromMeta = true;
      }
    }
    if (!sawOnlyObserver && !addedFromMeta && key) {
      ids.add(key);
    }
  }
  return Array.from(ids);
}

export function extractPresenceSessions(channel: {
  presenceState: () => Record<string, unknown[]>;
}): ActiveUserSession[] {
  const state = channel.presenceState();
  const byUser = new Map<string, ActiveUserSession>();
  for (const [key, metas] of Object.entries(state)) {
    if (!Array.isArray(metas) || metas.length === 0) continue;
    for (const rawMeta of metas) {
      const meta = (rawMeta && typeof rawMeta === 'object' ? rawMeta : {}) as Record<
        string,
        unknown
      >;
      if (meta.role === 'admin_observer') continue;
      const uid = String(
        meta.user_id || meta.userId || meta.uid || meta.id || key || ''
      ).trim();
      if (!uid) continue;
      const currentVideoId =
        String(meta.current_video_id || meta.video_id || meta.videoId || '').trim() || null;
      const currentVideoTitle =
        String(meta.current_video_title || meta.video_title || meta.videoTitle || '').trim() || null;
      const sessionStartedAt =
        String(meta.session_started_at || meta.started_at || meta.online_at || '').trim() || null;
      const lastActiveAt =
        String(meta.last_active_at || meta.last_seen_at || meta.online_at || '').trim() ||
        new Date().toISOString();
      const rawStatus = String(meta.status || '').toLowerCase().trim();
      const status: ActiveUserSession['status'] =
        rawStatus === 'watching' || currentVideoId ? 'watching' : 'online';
      byUser.set(uid, {
        userId: uid,
        userName: String(meta.user_name || meta.full_name || meta.name || '').trim(),
        username: String(meta.username || '').trim(),
        avatarUrl: String(meta.avatar_url || meta.avatarUrl || '').trim(),
        currentVideoId,
        currentVideoTitle,
        sessionStartedAt,
        lastActiveAt,
        status,
        device: String(meta.device || meta.device_model || '').trim(),
        platform: String(meta.platform || meta.os || '').trim(),
      });
    }
  }
  return Array.from(byUser.values());
}

export function detectClientDeviceInfo(): { device: string; platform: string } {
  if (typeof navigator === 'undefined') {
    return { device: 'Admin Web', platform: 'Web' };
  }
  const ua = navigator.userAgent || '';
  let platform = 'Web';
  if (/Android/i.test(ua)) platform = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) platform = 'iOS';
  else if (/Windows/i.test(ua)) platform = 'Windows Web';
  else if (/Mac OS X|Macintosh/i.test(ua)) platform = 'macOS Web';
  else if (/Linux/i.test(ua)) platform = 'Linux Web';

  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  return { device: `${platform} (${browser})`, platform };
}

export async function sendVideoWatchHeartbeat(params: {
  videoId?: string | null;
  videoTitle?: string | null;
  isOnline?: boolean;
  status?: 'watching' | 'online' | 'offline';
  device?: string;
  platform?: string;
  presenceTable?: string | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return;

  const isOnline = params.isOnline ?? true;
  const info = detectClientDeviceInfo();
  const device = params.device ?? info.device;
  const platform = params.platform ?? info.platform;
  const nextStatus =
    params.status ?? (!isOnline ? 'offline' : params.videoId ? 'watching' : 'online');

  const { error } = await supabase.rpc('user_heartbeat', {
    p_is_online: isOnline,
    p_video_id: params.videoId ?? null,
    p_video_title: params.videoTitle ?? null,
    p_status: nextStatus,
    p_device: device,
    p_platform: platform,
  });

  if (!error) return;

  // Backward compatible fallback for pre-v5 1-arg user_heartbeat(boolean)
  const msg = error.message.toLowerCase();
  if (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    msg.includes('could not find the function')
  ) {
    await supabase.rpc('user_heartbeat', { p_is_online: isOnline }).then(
      () => undefined,
      () => undefined
    );
    const pt = params.presenceTable || 'user_presence';
    const nowIso = new Date().toISOString();
    if (isOnline) {
      await supabase
        .from(pt)
        .upsert(
          {
            user_id: session.user.id,
            current_video_id: params.videoId ?? null,
            current_video_title: params.videoTitle ?? null,
            status: nextStatus,
            is_online: true,
            device,
            platform,
            last_active_at: nowIso,
            ended_at: null,
            updated_at: nowIso,
          },
          { onConflict: 'user_id' }
        )
        .then(
          () => undefined,
          () => undefined
        );
    } else {
      await supabase
        .from(pt)
        .update({
          is_online: false,
          status: 'offline',
          current_video_id: null,
          current_video_title: null,
          ended_at: nowIso,
          updated_at: nowIso,
        })
        .eq('user_id', session.user.id)
        .then(
          () => undefined,
          () => undefined
        );
    }
  }
}

// ---------------------------------------------------------------------------
// SHARED REALTIME PRESENCE & IMMEDIATE APP-ENTRY SESSION TRACKING
// ---------------------------------------------------------------------------

const PRESENCE_CHANNEL_NAMES = [
  'blade-online-users',
  'online-users',
  'presence',
  'active-users',
  'video-watchers',
] as const;

type PresenceSubscriber = (ids: string[], sessions: ActiveUserSession[]) => void;

const presenceSubscribers = new Set<PresenceSubscriber>();
let managedPresenceChannels: ReturnType<ReturnType<typeof getSupabaseClient>['channel']>[] = [];
let managedClientSignature = '';
let localTrackedPayload: Record<string, unknown> | null = null;
let localAppSessionStartedAt: string | null = null;

function computeMergedPresenceSnapshot(): {
  ids: string[];
  sessions: ActiveUserSession[];
} {
  const ids = new Set<string>();
  const sessions = new Map<string, ActiveUserSession>();

  for (const ch of managedPresenceChannels) {
    for (const id of extractPresenceUserIds(ch)) {
      ids.add(id);
    }
    for (const sess of extractPresenceSessions(ch)) {
      ids.add(sess.userId);
      sessions.set(sess.userId, sess);
    }
  }

  // Ensure local entering user is reflected immediately even before server presence echo completes
  if (localTrackedPayload && typeof localTrackedPayload.user_id === 'string') {
    const uid = localTrackedPayload.user_id;
    ids.add(uid);
    if (!sessions.has(uid)) {
      sessions.set(uid, {
        userId: uid,
        userName: String(localTrackedPayload.user_name ?? ''),
        username: String(localTrackedPayload.username ?? ''),
        avatarUrl: String(localTrackedPayload.avatar_url ?? ''),
        currentVideoId: null,
        currentVideoTitle: null,
        sessionStartedAt:
          typeof localTrackedPayload.session_started_at === 'string'
            ? localTrackedPayload.session_started_at
            : null,
        lastActiveAt:
          typeof localTrackedPayload.last_active_at === 'string'
            ? localTrackedPayload.last_active_at
            : new Date().toISOString(),
        status: 'online',
        device: String(localTrackedPayload.device ?? ''),
        platform: String(localTrackedPayload.platform ?? ''),
      });
    }
  }

  return {
    ids: Array.from(ids),
    sessions: Array.from(sessions.values()),
  };
}

function notifyPresenceSubscribers(): void {
  const snap = computeMergedPresenceSnapshot();
  for (const cb of presenceSubscribers) {
    cb(snap.ids, snap.sessions);
  }
}

function ensureManagedPresenceChannels(): void {
  const cfg = getActiveSupabaseConfig();
  if (!cfg) return;
  const sig = `${cfg.url}::${cfg.publishableKey}`;
  const supabase = getSupabaseClient();

  if (managedPresenceChannels.length > 0 && managedClientSignature === sig) {
    return;
  }

  if (managedPresenceChannels.length > 0) {
    for (const ch of managedPresenceChannels) {
      void supabase.removeChannel(ch);
    }
    managedPresenceChannels = [];
  }

  managedClientSignature = sig;
  managedPresenceChannels = PRESENCE_CHANNEL_NAMES.map((name) => {
    const ch = supabase.channel(name);
    ch.on('presence', { event: 'sync' }, notifyPresenceSubscribers)
      .on('presence', { event: 'join' }, notifyPresenceSubscribers)
      .on('presence', { event: 'leave' }, notifyPresenceSubscribers)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && name === 'blade-online-users' && localTrackedPayload) {
          void ch.track(localTrackedPayload).catch(() => undefined);
        }
      });
    return ch;
  });
}

function cleanupManagedPresenceChannelsIfIdle(): void {
  if (presenceSubscribers.size > 0 || localTrackedPayload !== null) return;
  if (managedPresenceChannels.length === 0) return;
  try {
    const supabase = getSupabaseClient();
    for (const ch of managedPresenceChannels) {
      void supabase.removeChannel(ch);
    }
  } catch {
    // Ignore if config cleared
  }
  managedPresenceChannels = [];
  managedClientSignature = '';
}

export function subscribeOnlinePresence(callback: PresenceSubscriber): () => void {
  presenceSubscribers.add(callback);
  ensureManagedPresenceChannels();
  const snap = computeMergedPresenceSnapshot();
  callback(snap.ids, snap.sessions);

  return () => {
    presenceSubscribers.delete(callback);
    cleanupManagedPresenceChannelsIfIdle();
  };
}

export async function sendAppEntryHeartbeat(schema?: SchemaInspectionResult | null): Promise<void> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return;

  const info = detectClientDeviceInfo();
  await sendVideoWatchHeartbeat({
    videoId: null,
    videoTitle: null,
    isOnline: true,
    status: 'online',
    device: info.device,
    platform: info.platform,
    presenceTable: schema?.presenceTable ?? 'user_presence',
  });

  // Also ensure users table reflects immediate entry even before SQL v6 is executed
  if (schema?.users) {
    const u = schema.users;
    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {};
    if (u.lastActiveCol) updatePayload[u.lastActiveCol] = nowIso;
    if (u.onlineCol) updatePayload[u.onlineCol] = true;
    if (Object.keys(updatePayload).length > 0) {
      await supabase
        .from(u.table)
        .update(updatePayload)
        .eq(u.idCol, session.user.id)
        .then(
          () => undefined,
          () => undefined
        );
    }
  }
}

export async function startAppEntryPresence(
  schema?: SchemaInspectionResult | null,
  admin?: AdminRecord | null
): Promise<void> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return;

  const nowIso = new Date().toISOString();
  if (!localAppSessionStartedAt) {
    localAppSessionStartedAt = nowIso;
  }
  const info = detectClientDeviceInfo();
  const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    (typeof meta.full_name === 'string' && meta.full_name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    admin?.username ||
    session.user.email ||
    session.user.id;
  const username =
    admin?.username ||
    (typeof meta.username === 'string' ? meta.username.trim() : '') ||
    '';
  const avatarUrl =
    (typeof meta.avatar_url === 'string' && meta.avatar_url.trim()) || '';

  localTrackedPayload = {
    user_id: session.user.id,
    user_name: displayName,
    username,
    email: session.user.email ?? '',
    avatar_url: avatarUrl,
    status: 'online',
    session_started_at: localAppSessionStartedAt,
    last_active_at: nowIso,
    device: info.device,
    platform: info.platform,
  };

  ensureManagedPresenceChannels();
  const primaryChannel = managedPresenceChannels[0];
  if (primaryChannel) {
    void primaryChannel.track(localTrackedPayload).catch(() => undefined);
  }
  notifyPresenceSubscribers();

  await sendAppEntryHeartbeat(schema);
}

export async function stopAppEntryPresence(schema?: SchemaInspectionResult | null): Promise<void> {
  localTrackedPayload = null;
  localAppSessionStartedAt = null;
  const primaryChannel = managedPresenceChannels[0];
  if (primaryChannel) {
    await primaryChannel.untrack().catch(() => undefined);
  }
  notifyPresenceSubscribers();

  await sendVideoWatchHeartbeat({
    isOnline: false,
    status: 'offline',
    presenceTable: schema?.presenceTable ?? 'user_presence',
  }).catch(() => undefined);

  cleanupManagedPresenceChannelsIfIdle();
}

export function sendOfflineBeacon(): void {
  localTrackedPayload = null;
  localAppSessionStartedAt = null;
  const primaryChannel = managedPresenceChannels[0];
  if (primaryChannel) {
    void primaryChannel.untrack().catch(() => undefined);
  }
  notifyPresenceSubscribers();

  const cfg = getActiveSupabaseConfig();
  if (!cfg || typeof fetch === 'undefined') return;
  try {
    const supabase = getSupabaseClient();
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return;
      void fetch(`${cfg.url}/rest/v1/rpc/user_heartbeat`, {
        method: 'POST',
        keepalive: true,
        headers: {
          apikey: cfg.publishableKey,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_is_online: false, p_status: 'offline' }),
      }).catch(() => undefined);
    });
  } catch {
    // Ignore errors during page unload
  }
}

export function isUserHeartbeatOnline(
  lastActiveAt: string | null | undefined,
  onlineFlag?: boolean | null
): boolean {
  if (onlineFlag === false) return false;
  if (!lastActiveAt) return false;
  const ts = new Date(lastActiveAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= HEARTBEAT_ONLINE_WINDOW_MS;
}

function normalizeUser(row: Record<string, unknown>, m: UserTableMapping): AppUser {
  const rawStatus = m.statusCol ? String(row[m.statusCol] ?? '').toLowerCase() : '';
  const isBlocked = m.blockedCol ? Boolean(row[m.blockedCol]) : false;
  const isSuspended = m.suspendedCol ? Boolean(row[m.suspendedCol]) : false;

  let accountStatus: AccountStatus = 'active';
  if (rawStatus === 'deleted') accountStatus = 'deleted';
  else if (rawStatus === 'blocked' || rawStatus === 'banned' || isBlocked)
    accountStatus = 'blocked';
  else if (rawStatus === 'suspended' || isSuspended) accountStatus = 'suspended';

  const rawVerifyStatus = m.verificationStatusCol
    ? String(row[m.verificationStatusCol] ?? '').toLowerCase()
    : '';
  const boolVerified = m.verifiedCol ? Boolean(row[m.verifiedCol]) : false;

  let verificationStatus: VerificationState = 'unverified';
  if (
    rawVerifyStatus === 'verified' ||
    rawVerifyStatus === 'approved' ||
    (boolVerified && !rawVerifyStatus)
  ) {
    verificationStatus = 'verified';
  } else if (rawVerifyStatus === 'pending') {
    verificationStatus = 'pending';
  } else if (rawVerifyStatus === 'rejected') {
    verificationStatus = 'rejected';
  } else if (rawVerifyStatus === 'revoked') {
    verificationStatus = 'revoked';
  }

  const lastActiveAt = extractLatestUserActivityTs(row, m.lastActiveCol);
  const rawOnlineFlag = m.onlineCol
    ? (row[m.onlineCol] as boolean | null | undefined)
    : ('is_online' in row
        ? (row.is_online as boolean | null | undefined)
        : 'online' in row
        ? (row.online as boolean | null | undefined)
        : undefined);

  return {
    id: String(row[m.idCol] ?? ''),
    name: getStr(row, m.nameCol),
    username: getStr(row, m.usernameCol),
    email: getStr(row, m.emailCol),
    phone: getStr(row, m.phoneCol),
    avatarUrl: getStr(row, m.avatarCol),
    bio: getStr(row, m.bioCol),
    isVerified: boolVerified || verificationStatus === 'verified',
    verificationStatus,
    accountStatus,
    followersCount: getNum(row, m.followersCountCol),
    followingCount: getNum(row, m.followingCountCol),
    videoCount: getNum(row, m.videosCountCol),
    totalViews: getNum(row, m.viewsCountCol),
    totalLikes: 0,
    totalComments: 0,
    joinedAt: m.createdAtCol ? (row[m.createdAtCol] as string | null) ?? null : null,
    lastActiveAt,
    isOnline: isUserHeartbeatOnline(lastActiveAt, rawOnlineFlag),
    raw: row,
  };
}

function isTruthyFlag(val: unknown): boolean {
  if (val === true || val === 1) return true;
  if (typeof val === 'string') {
    const s = val.toLowerCase().trim();
    return s === 'true' || s === 't' || s === '1' || s === 'yes';
  }
  return false;
}

function isExplicitFalseFlag(val: unknown): boolean {
  if (val === false || val === 0) return true;
  if (typeof val === 'string') {
    const s = val.toLowerCase().trim();
    return s === 'false' || s === 'f' || s === '0' || s === 'no';
  }
  return false;
}

function normalizeVideo(
  row: Record<string, unknown>,
  m: VideoTableMapping,
  ownersById: Map<string, AppUser>,
  categoriesById: Map<string, CategoryRecord>
): VideoRecord {
  const ownerId = String(row[m.ownerIdCol] ?? '');
  const owner = ownersById.get(ownerId);
  const categoryId = m.categoryIdCol ? ((row[m.categoryIdCol] as string | null) ?? null) : null;
  const categoryFromMap = categoryId ? categoriesById.get(categoryId)?.name : undefined;
  const rawHashtags = m.hashtagsCol ? row[m.hashtagsCol] : null;
  let hashtags: string[] = [];
  if (Array.isArray(rawHashtags)) {
    hashtags = rawHashtags.map((h) => String(h).trim()).filter(Boolean);
  } else if (typeof rawHashtags === 'string') {
    hashtags = rawHashtags
      .split(/[\s,]+/)
      .map((h) => h.trim())
      .filter(Boolean);
  }

  const rawStatus = String(
    (m.statusCol ? row[m.statusCol] : undefined) ??
      row.status ??
      row.moderation_status ??
      'published'
  )
    .toLowerCase()
    .trim();
  const rawModStatus = String(row.moderation_status ?? '').toLowerCase().trim();

  const isFlagBlocked =
    isTruthyFlag(m.isBlockedCol ? row[m.isBlockedCol] : undefined) ||
    isTruthyFlag(row.is_blocked) ||
    isTruthyFlag(row.blocked);
  const isFlagHidden =
    isTruthyFlag(m.isHiddenCol ? row[m.isHiddenCol] : undefined) ||
    isTruthyFlag(row.is_hidden) ||
    isTruthyFlag(row.hidden);
  const isFlagDeleted =
    isTruthyFlag(row.is_deleted) || isTruthyFlag(row.deleted);
  const isUnpublishedBool =
    isExplicitFalseFlag(row.is_active) ||
    isExplicitFalseFlag(row.is_visible) ||
    isExplicitFalseFlag(row.is_published) ||
    isExplicitFalseFlag(row.is_public);

  let status: VideoStatus = 'published';
  if (isFlagBlocked || rawStatus === 'blocked' || rawModStatus === 'blocked') {
    status = 'blocked';
  } else if (
    isFlagDeleted ||
    rawStatus === 'deleted' ||
    rawStatus === 'removed' ||
    rawModStatus === 'deleted'
  ) {
    status = 'deleted';
  } else if (
    isFlagHidden ||
    rawStatus === 'hidden' ||
    rawModStatus === 'hidden' ||
    (isUnpublishedBool && rawStatus !== 'draft')
  ) {
    status = 'hidden';
  } else if (rawStatus === 'draft') {
    status = 'draft';
  }

  const rawVis = (
    m.visibilityCol ? String(row[m.visibilityCol] ?? 'public') : 'public'
  ).toLowerCase();
  const visibility: VideoVisibility =
    rawVis === 'followers' || rawVis === 'private' ? rawVis : 'public';

  return {
    id: String(row[m.idCol] ?? ''),
    ownerId,
    ownerName: owner?.name || '',
    ownerUsername: owner?.username || '',
    ownerAvatarUrl: owner?.avatarUrl || '',
    ownerVerified: owner?.isVerified || false,
    videoUrl: getStr(row, m.videoUrlCol),
    storagePath: getStr(row, m.storagePathCol),
    thumbnailUrl: getStr(row, m.thumbnailUrlCol),
    thumbnailPath: getStr(row, m.thumbnailPathCol),
    caption: getStr(row, m.captionCol),
    description: getStr(row, m.descriptionCol),
    hashtags,
    categoryId,
    categoryName: getStr(row, m.categoryNameCol) || categoryFromMap || '',
    status,
    visibility,
    viewsCount: getNum(row, m.viewsCol),
    likesCount: getNum(row, m.likesCol),
    commentsCount: getNum(row, m.commentsCol),
    durationSeconds: m.durationCol ? (row[m.durationCol] as number | null) ?? null : null,
    createdAt: m.createdAtCol ? (row[m.createdAtCol] as string | null) ?? null : null,
    raw: row,
  };
}

// ---------------------------------------------------------------------------
// AUTHENTICATION & FIRST-RUN ADMIN BOOTSTRAP
// ---------------------------------------------------------------------------

export async function checkAdminSetupStatus(): Promise<{
  hasAdmin: boolean;
  migrationMissing: boolean;
}> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('check_admin_setup_status');
  if (error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('could not find the function') ||
      msg.includes('does not exist') ||
      error.code === 'PGRST202' ||
      error.code === '42883'
    ) {
      return { hasAdmin: false, migrationMissing: true };
    }
    throw new Error(error.message);
  }
  const hasAdmin = Boolean((data as { has_admin?: boolean } | null)?.has_admin);
  return { hasAdmin, migrationMissing: false };
}

export async function createFirstAdminAccount(params: {
  email: string;
  username: string;
  password: string;
}): Promise<{ needsEmailConfirmation: boolean }> {
  const supabase = getSupabaseClient();
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: params.email.trim(),
    password: params.password,
    options: {
      data: {
        username: params.username.trim(),
      },
    },
  });

  if (signUpError) {
    throw new Error(signUpError.message);
  }

  if (!signUpData.session) {
    // Email confirmation enabled on Supabase Auth project.
    return { needsEmailConfirmation: true };
  }

  const { error: bootError } = await supabase.rpc('bootstrap_first_admin', {
    p_username: params.username.trim(),
  });
  if (bootError) {
    await supabase.auth.signOut();
    throw new Error(bootError.message);
  }

  // Requirement: "After the first admin account is created: ... redirect to the normal login screen"
  await supabase.auth.signOut();
  return { needsEmailConfirmation: false };
}

export async function signInAsAdmin(params: {
  identifier: string;
  password: string;
}): Promise<AdminRecord> {
  const supabase = getSupabaseClient();
  const rawIdentifier = params.identifier.trim();
  let emailToUse = rawIdentifier;

  if (!rawIdentifier.includes('@')) {
    const { data: resolvedEmail, error: resolveErr } = await supabase.rpc(
      'resolve_admin_login_email',
      { p_identifier: rawIdentifier }
    );
    if (resolveErr) {
      throw new Error(resolveErr.message);
    }
    if (!resolvedEmail || typeof resolvedEmail !== 'string') {
      throw new Error('No active administrator found matching that username.');
    }
    emailToUse = resolvedEmail;
  }

  const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
    email: emailToUse,
    password: params.password,
  });

  if (signInError || !authData.user) {
    throw new Error(signInError?.message || 'Invalid login credentials.');
  }

  // Verify admin authorization server-side via RLS-protected blade_admins
  const { data: adminRow, error: adminErr } = await supabase
    .from('blade_admins')
    .select('*')
    .eq('user_id', authData.user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (adminErr || !adminRow) {
    // Attempt first-admin claim ONLY if zero admins exist (e.g., user confirmed email after first-run signup)
    const status = await checkAdminSetupStatus().catch(() => ({
      hasAdmin: true,
      migrationMissing: false,
    }));
    if (!status.hasAdmin && !status.migrationMissing) {
      const usernameMeta =
        (authData.user.user_metadata?.username as string | undefined) ||
        emailToUse.split('@')[0];
      const { error: bootErr } = await supabase.rpc('bootstrap_first_admin', {
        p_username: usernameMeta,
      });
      if (!bootErr) {
        const { data: claimedRow } = await supabase
          .from('blade_admins')
          .select('*')
          .eq('user_id', authData.user.id)
          .maybeSingle();
        if (claimedRow) {
          return {
            id: String(claimedRow.id),
            userId: String(claimedRow.user_id),
            email: String(claimedRow.email),
            username: String(claimedRow.username),
            role: claimedRow.role as AdminRecord['role'],
            isActive: Boolean(claimedRow.is_active),
            createdAt: claimedRow.created_at ?? null,
            lastSignInAt: authData.user.last_sign_in_at ?? null,
          };
        }
      }
    }

    await supabase.auth.signOut();
    throw new Error(
      'Unauthorized: This account does not have BLADE administrator privileges.'
    );
  }

  return {
    id: String(adminRow.id),
    userId: String(adminRow.user_id),
    email: String(adminRow.email),
    username: String(adminRow.username),
    role: adminRow.role as AdminRecord['role'],
    isActive: Boolean(adminRow.is_active),
    createdAt: adminRow.created_at ?? null,
    lastSignInAt: authData.user.last_sign_in_at ?? null,
  };
}

export async function restoreAdminSession(): Promise<AdminRecord | null> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data: adminRow, error } = await supabase
    .from('blade_admins')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !adminRow) {
    await supabase.auth.signOut();
    return null;
  }

  return {
    id: String(adminRow.id),
    userId: String(adminRow.user_id),
    email: String(adminRow.email),
    username: String(adminRow.username),
    role: adminRow.role as AdminRecord['role'],
    isActive: Boolean(adminRow.is_active),
    createdAt: adminRow.created_at ?? null,
    lastSignInAt: session.user.last_sign_in_at ?? null,
  };
}

export async function signOutAdmin(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// STORAGE STATS & FILE MANAGEMENT
// ---------------------------------------------------------------------------

const ONE_GB_BYTES = 1024 * 1024 * 1024;
const PRO_DEFAULT_BYTES = 100 * ONE_GB_BYTES;

function resolveEffectiveQuotaBytes(
  usedBytes: number,
  serverQuotaBytes?: number | null
): { quotaBytes: number; isDefault: boolean } {
  if (
    typeof serverQuotaBytes === 'number' &&
    Number.isFinite(serverQuotaBytes) &&
    serverQuotaBytes > 0
  ) {
    return { quotaBytes: serverQuotaBytes, isDefault: false };
  }

  const prefs = getPreferences();
  if (
    typeof prefs.storageQuotaGb === 'number' &&
    Number.isFinite(prefs.storageQuotaGb) &&
    prefs.storageQuotaGb > 0
  ) {
    return {
      quotaBytes: Math.round(prefs.storageQuotaGb * ONE_GB_BYTES),
      isDefault: false,
    };
  }

  return {
    quotaBytes: usedBytes > ONE_GB_BYTES ? PRO_DEFAULT_BYTES : ONE_GB_BYTES,
    isDefault: true,
  };
}

export async function updateStorageQuotaGb(quotaGb: number | null): Promise<number> {
  const prefs = getPreferences();
  const normalizedGb =
    typeof quotaGb === 'number' && Number.isFinite(quotaGb) && quotaGb > 0
      ? Number(quotaGb.toFixed(2))
      : null;

  savePreferences({
    ...prefs,
    storageQuotaGb: normalizedGb,
  });

  const quotaBytes = normalizedGb ? Math.round(normalizedGb * ONE_GB_BYTES) : null;
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('admin_set_storage_quota', {
    p_quota_bytes: quotaBytes,
  });

  if (error) {
    const msg = error.message.toLowerCase();
    const isMissingRpc =
      msg.includes('could not find the function') ||
      msg.includes('does not exist') ||
      error.code === 'PGRST202' ||
      error.code === '42883';
    if (!isMissingRpc) {
      throw new Error(error.message);
    }
  }

  return quotaBytes ?? ONE_GB_BYTES;
}

export async function fetchStorageStats(): Promise<StorageStats> {
  const supabase = getSupabaseClient();

  // Primary path: secure SECURITY DEFINER RPC reading real storage.objects metadata
  const { data: rpcData, error: rpcError } = await supabase.rpc('get_blade_storage_stats');
  if (!rpcError && rpcData) {
    const parsed = rpcData as {
      total_bytes?: number;
      quota_bytes?: number | null;
      quota_is_default?: boolean;
      file_count?: number;
      video_bytes?: number;
      image_bytes?: number;
      buckets?: Array<{
        name: string;
        is_public: boolean;
        file_count: number;
        bytes_used: number;
      }>;
    };
    const total = Number(parsed.total_bytes ?? 0);
    const vid = Number(parsed.video_bytes ?? 0);
    const img = Number(parsed.image_bytes ?? 0);

    let serverQuota: number | null =
      typeof parsed.quota_bytes === 'number' && Number.isFinite(parsed.quota_bytes) && parsed.quota_bytes > 0
        ? parsed.quota_bytes
        : null;
    let isDefault = Boolean(parsed.quota_is_default);

    // If older RPC version did not return quota_bytes or returned auto-default, also check local preference
    const prefs = getPreferences();
    if ((!serverQuota || isDefault) && prefs.storageQuotaGb && prefs.storageQuotaGb > 0) {
      serverQuota = Math.round(prefs.storageQuotaGb * ONE_GB_BYTES);
      isDefault = false;
    }

    const resolved =
      serverQuota && serverQuota > 0
        ? { quotaBytes: serverQuota, isDefault }
        : resolveEffectiveQuotaBytes(total);

    return {
      available: true,
      totalBytesUsed: total,
      totalBytesQuota: resolved.quotaBytes,
      quotaIsDefault: resolved.isDefault,
      videoBytesUsed: vid,
      imageBytesUsed: img,
      otherBytesUsed: Math.max(0, total - vid - img),
      fileCount: Number(parsed.file_count ?? 0),
      buckets: (parsed.buckets ?? []).map((b) => ({
        name: b.name,
        isPublic: b.is_public,
        fileCount: Number(b.file_count ?? 0),
        bytesUsed: Number(b.bytes_used ?? 0),
      })),
    };
  }

  // Fallback: listBuckets via Storage API + recursive bucket inspection on configured/common buckets
  const prefs = getPreferences();
  const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets();

  const bucketList: Array<{ name: string; public: boolean }> =
    !bucketErr && buckets && buckets.length > 0
      ? buckets.map((b) => ({ name: b.name, public: Boolean(b.public) }))
      : [];

  // If listBuckets returned nothing (common with restricted storage.buckets RLS), probe configured buckets
  if (bucketList.length === 0) {
    const candidateNames = Array.from(
      new Set(
        [
          prefs.videoBucket,
          prefs.thumbnailBucket,
          prefs.avatarBucket,
          'videos',
          'thumbnails',
          'avatars',
          'media',
          'uploads',
        ]
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
    for (const name of candidateNames) {
      const { error: probeErr } = await supabase.storage.from(name).list('', { limit: 1 });
      if (!probeErr) {
        bucketList.push({ name, public: true });
      }
    }
  }

  if (bucketList.length === 0) {
    const resolved = resolveEffectiveQuotaBytes(0);
    return {
      available: true,
      totalBytesUsed: 0,
      totalBytesQuota: resolved.quotaBytes,
      quotaIsDefault: resolved.isDefault,
      videoBytesUsed: 0,
      imageBytesUsed: 0,
      otherBytesUsed: 0,
      fileCount: 0,
      buckets: [],
      unavailableReason:
        rpcError?.message ||
        bucketErr?.message ||
        'Run the Blade SQL migration to read full bucket metadata via get_blade_storage_stats().',
    };
  }

  const bucketSummaries: StorageBucketSummary[] = [];
  let totalBytes = 0;
  let totalFiles = 0;
  let videoBytes = 0;
  let imageBytes = 0;

  for (const b of bucketList) {
    const items = await listBucketObjects(b.name).catch(() => []);
    let bBytes = 0;
    const bFiles = items.length;
    for (const item of items) {
      const size = Number(item.sizeBytes ?? 0);
      const mime = String(item.mimeType ?? '');
      bBytes += size;
      if (mime.startsWith('video/') || b.name.toLowerCase().includes('video')) {
        videoBytes += size;
      } else if (
        mime.startsWith('image/') ||
        b.name.toLowerCase().includes('thumb') ||
        b.name.toLowerCase().includes('avatar')
      ) {
        imageBytes += size;
      }
    }
    totalBytes += bBytes;
    totalFiles += bFiles;
    bucketSummaries.push({
      name: b.name,
      isPublic: b.public,
      fileCount: bFiles,
      bytesUsed: bBytes,
    });
  }

  const resolved = resolveEffectiveQuotaBytes(totalBytes);

  return {
    available: true,
    totalBytesUsed: totalBytes,
    totalBytesQuota: resolved.quotaBytes,
    quotaIsDefault: resolved.isDefault,
    videoBytesUsed: videoBytes,
    imageBytesUsed: imageBytes,
    otherBytesUsed: Math.max(0, totalBytes - videoBytes - imageBytes),
    fileCount: totalFiles,
    buckets: bucketSummaries,
  };
}

export async function listBucketObjects(
  bucket: string,
  prefix = ''
): Promise<StorageObjectItem[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 100,
    sortBy: { column: 'created_at', order: 'desc' },
  });
  if (error) throw new Error(error.message);
  if (!data) return [];

  const items: StorageObjectItem[] = [];
  for (const entry of data) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    // If entry.id is null, it's a virtual folder in Supabase Storage
    if (!entry.id) {
      const nested = await listBucketObjects(bucket, fullPath).catch(() => []);
      items.push(...nested);
      continue;
    }
    const meta = (entry.metadata ?? {}) as { size?: number; mimetype?: string };
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(fullPath);
    items.push({
      id: entry.id,
      bucket,
      name: entry.name,
      path: fullPath,
      sizeBytes: typeof meta.size === 'number' ? meta.size : null,
      mimeType: typeof meta.mimetype === 'string' ? meta.mimetype : 'application/octet-stream',
      createdAt: entry.created_at ?? null,
      updatedAt: entry.updated_at ?? null,
      publicUrl: pub?.publicUrl ?? null,
    });
  }
  return items;
}

export async function deleteStorageObject(bucket: string, path: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// DASHBOARD & REALTIME ANALYTICS
// ---------------------------------------------------------------------------

function getDetectedUserActivityCols(schema: SchemaInspectionResult): string[] {
  const u = schema.users;
  if (!u) return [];
  const rawCols = schema.rawTables[u.table]?.columns ?? {};
  const existingKeys = new Set(Object.keys(rawCols).map((k) => k.toLowerCase()));
  const cols: string[] = [];
  if (u.lastActiveCol) cols.push(u.lastActiveCol);
  for (const cand of ACTIVITY_TIMESTAMP_COLS) {
    const matched = Object.keys(rawCols).find((k) => k.toLowerCase() === cand.toLowerCase());
    if (matched && !cols.includes(matched)) {
      cols.push(matched);
    } else if (!matched && existingKeys.size === 0 && cand === 'last_active_at' && !cols.includes(cand)) {
      cols.push(cand);
    }
  }
  return cols;
}

async function fetchPresenceTableLiveIds(
  schema: SchemaInspectionResult,
  cutoffIso: string
): Promise<string[]> {
  const tableName = schema.presenceTable ?? 'user_presence';
  const supabase = getSupabaseClient();
  const pTable = schema.rawTables[tableName];
  const colNames = pTable ? Object.keys(pTable.columns) : [];
  const findC = (cands: string[]) =>
    colNames.find((k) => cands.some((c) => c.toLowerCase() === k.toLowerCase()));

  const tsCol =
    findC([
      'last_seen_at',
      'last_active_at',
      'last_heartbeat_at',
      'last_online_at',
      'updated_at',
      'last_seen',
      'created_at',
    ]) ?? (colNames.length === 0 ? 'last_active_at' : undefined);
  const uidCol = findC(['user_id', 'profile_id', 'uid', 'id']) ?? 'user_id';
  const onlineCol =
    findC(['is_online', 'online']) ?? (colNames.length === 0 ? 'is_online' : undefined);

  if (!tsCol && !onlineCol) return [];

  let q = supabase.from(tableName).select('*').limit(1000);
  if (tsCol) {
    q = q.gte(tsCol, cutoffIso);
  } else if (onlineCol) {
    q = q.eq(onlineCol, true);
  }
  const { data, error } = await q;
  if (error || !data) return [];

  const cutoffMs = new Date(cutoffIso).getTime();
  const ids = new Set<string>();
  for (const row of data as unknown as Record<string, unknown>[]) {
    const onlineVal = onlineCol ? row[onlineCol] : undefined;
    if (onlineVal === false) continue;
    if (tsCol && typeof row[tsCol] === 'string') {
      const ms = new Date(row[tsCol] as string).getTime();
      if (!Number.isNaN(ms) && ms < cutoffMs) continue;
    }
    const uid =
      (row[uidCol] as string | undefined) ||
      (row.user_id as string | undefined) ||
      (row.profile_id as string | undefined) ||
      (row.id as string | undefined);
    if (typeof uid === 'string' && uid.trim()) {
      ids.add(uid.trim());
    }
  }
  return Array.from(ids);
}

async function fetchFallbackLiveUserIdsFromTable(
  schema: SchemaInspectionResult,
  cutoffIso: string
): Promise<string[]> {
  const u = schema.users;
  if (!u) return [];
  const activityCols = getDetectedUserActivityCols(schema);
  if (activityCols.length === 0) return [];
  const supabase = getSupabaseClient();
  const selectCols = Array.from(
    new Set([u.idCol, ...(u.onlineCol ? [u.onlineCol] : []), ...activityCols])
  ).join(',');
  const orExpr = activityCols.map((c) => `${c}.gte.${cutoffIso}`).join(',');
  const { data, error } = await supabase.from(u.table).select(selectCols).or(orExpr).limit(1000);
  if (error || !data) return [];
  const ids: string[] = [];
  for (const row of data as unknown as Record<string, unknown>[]) {
    const ts = extractLatestUserActivityTs(row, u.lastActiveCol);
    const rawOnline = u.onlineCol ? (row[u.onlineCol] as boolean | null | undefined) : undefined;
    if (isUserHeartbeatOnline(ts, rawOnline)) {
      const id = String(row[u.idCol] ?? '').trim();
      if (id) ids.push(id);
    }
  }
  return ids;
}

export async function fetchLiveUserIds(schema: SchemaInspectionResult): Promise<string[]> {
  const supabase = getSupabaseClient();
  const twoMinutesAgoIso = new Date(Date.now() - HEARTBEAT_ONLINE_WINDOW_MS).toISOString();
  const [{ data, error }, presenceTableIds] = await Promise.all([
    supabase.rpc('get_blade_activity_stats'),
    fetchPresenceTableLiveIds(schema, twoMinutesAgoIso),
  ]);

  const parsed = !error && data && typeof data === 'object'
    ? (data as { live_user_ids?: unknown })
    : null;

  if (parsed && Array.isArray(parsed.live_user_ids)) {
    const merged = new Set<string>([
      ...parsed.live_user_ids.map((id) => String(id)).filter(Boolean),
      ...presenceTableIds,
    ]);
    return Array.from(merged);
  }

  const fallbackIds = await fetchFallbackLiveUserIdsFromTable(schema, twoMinutesAgoIso);
  return Array.from(new Set<string>([...fallbackIds, ...presenceTableIds]));
}

export async function fetchDashboardMetrics(
  schema: SchemaInspectionResult
): Promise<DashboardMetrics> {
  const supabase = getSupabaseClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  const twoMinutesAgoIso = new Date(Date.now() - HEARTBEAT_ONLINE_WINDOW_MS).toISOString();
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 86400_000).toISOString();

  const u = schema.users;
  const v = schema.videos;
  const activityCols = getDetectedUserActivityCols(schema);

  // Query server-side live activity RPC if available (auto-expires >2min stale sessions)
  const activityRpcPromise = supabase.rpc('get_blade_activity_stats');

  const multiColCountQuery = (sinceIso: string) => {
    if (!u || activityCols.length === 0) return Promise.resolve({ count: null, error: null });
    const orExpr = activityCols.map((c) => `${c}.gte.${sinceIso}`).join(',');
    return supabase.from(u.table).select('*', { count: 'exact', head: true }).or(orExpr);
  };

  const [
    activityRpcRes,
    totalUsersRes,
    newUsersRes,
    activeTodayRes,
    activeUsers7dRes,
    verifiedUsersRes,
    blockedUsersRes,
    totalVideosRes,
    videosTodayRes,
    videoSumsRes,
    likesTableRes,
    commentsTableRes,
    followersTableRes,
    pendingVerifRes,
    storageStats,
    presenceTableIds,
  ] = await Promise.all([
    activityRpcPromise,
    u
      ? supabase.from(u.table).select('*', { count: 'exact', head: true })
      : Promise.resolve({ count: null, error: null }),
    u && u.createdAtCol
      ? supabase
          .from(u.table)
          .select('*', { count: 'exact', head: true })
          .gte(u.createdAtCol, todayIso)
      : Promise.resolve({ count: null, error: null }),
    multiColCountQuery(todayIso),
    multiColCountQuery(sevenDaysAgoIso),
    u && (u.verifiedCol || u.verificationStatusCol)
      ? u.verifiedCol
        ? supabase.from(u.table).select('*', { count: 'exact', head: true }).eq(u.verifiedCol, true)
        : supabase
            .from(u.table)
            .select('*', { count: 'exact', head: true })
            .eq(u.verificationStatusCol!, 'verified')
      : Promise.resolve({ count: null, error: null }),
    u && (u.statusCol || u.blockedCol)
      ? u.statusCol && u.blockedCol
        ? supabase
            .from(u.table)
            .select('*', { count: 'exact', head: true })
            .or(`${u.statusCol}.in.(blocked,banned),${u.blockedCol}.eq.true`)
        : u.statusCol
        ? supabase
            .from(u.table)
            .select('*', { count: 'exact', head: true })
            .in(u.statusCol, ['blocked', 'banned'])
        : supabase.from(u.table).select('*', { count: 'exact', head: true }).eq(u.blockedCol!, true)
      : Promise.resolve({ count: null, error: null }),
    v
      ? supabase.from(v.table).select('*', { count: 'exact', head: true })
      : Promise.resolve({ count: null, error: null }),
    v && v.createdAtCol
      ? supabase
          .from(v.table)
          .select('*', { count: 'exact', head: true })
          .gte(v.createdAtCol, todayIso)
      : Promise.resolve({ count: null, error: null }),
    v
      ? supabase
          .from(v.table)
          .select(
            [v.viewsCol, v.likesCol, v.commentsCol].filter(Boolean).join(',') || v.idCol
          )
          .limit(5000)
      : Promise.resolve({ data: null, error: null }),
    schema.likesTable
      ? supabase.from(schema.likesTable).select('*', { count: 'exact', head: true })
      : Promise.resolve({ count: null, error: null }),
    schema.comments
      ? supabase.from(schema.comments.table).select('*', { count: 'exact', head: true })
      : Promise.resolve({ count: null, error: null }),
    schema.followersTable
      ? supabase.from(schema.followersTable).select('*', { count: 'exact', head: true })
      : Promise.resolve({ count: null, error: null }),
    schema.verifications
      ? supabase
          .from(schema.verifications.table)
          .select('*', { count: 'exact', head: true })
          .eq(schema.verifications.statusCol, 'pending')
      : u && u.verificationStatusCol
      ? supabase
          .from(u.table)
          .select('*', { count: 'exact', head: true })
          .eq(u.verificationStatusCol, 'pending')
      : Promise.resolve({ count: null, error: null }),
    fetchStorageStats(),
    fetchPresenceTableLiveIds(schema, twoMinutesAgoIso),
  ]);

  let totalViews: number | null = null;
  let summedLikes = 0;
  let summedComments = 0;
  if (v && videoSumsRes && 'data' in videoSumsRes && Array.isArray(videoSumsRes.data)) {
    const rows = videoSumsRes.data as unknown as Record<string, unknown>[];
    if (v.viewsCol) {
      totalViews = rows.reduce((acc, r) => acc + getNum(r, v.viewsCol), 0);
    }
    if (v.likesCol) {
      summedLikes = rows.reduce((acc, r) => acc + getNum(r, v.likesCol), 0);
    }
    if (v.commentsCol) {
      summedComments = rows.reduce((acc, r) => acc + getNum(r, v.commentsCol), 0);
    }
  }

  let totalFollowers: number | null = followersTableRes.count ?? null;
  if (totalFollowers === null && u && u.followersCountCol) {
    const { data: fRows } = await supabase
      .from(u.table)
      .select(u.followersCountCol)
      .limit(5000);
    if (fRows) {
      totalFollowers = (fRows as unknown as Record<string, unknown>[]).reduce(
        (acc, r) => acc + getNum(r, u.followersCountCol),
        0
      );
    }
  }

  const rpcAct =
    !activityRpcRes.error && activityRpcRes.data && typeof activityRpcRes.data === 'object'
      ? (activityRpcRes.data as {
          total_users?: number;
          live_active_users?: number;
          live_user_ids?: unknown;
          live_sessions?: unknown;
          active_users_today?: number;
          active_users_7d?: number;
          offline_users?: number;
          new_users_today?: number;
        })
      : null;

  const hasRpcLiveIds = Boolean(rpcAct && Array.isArray(rpcAct.live_user_ids));
  const rpcLiveIds = hasRpcLiveIds
    ? (rpcAct!.live_user_ids as unknown[]).map((id) => String(id)).filter(Boolean)
    : [];

  // If v3+ RPC (returning live_user_ids) is not installed yet, also scan all detected activity timestamp columns
  const fallbackTableLiveIds = !hasRpcLiveIds
    ? await fetchFallbackLiveUserIdsFromTable(schema, twoMinutesAgoIso)
    : [];

  const mergedLiveIds = Array.from(
    new Set<string>([...rpcLiveIds, ...fallbackTableLiveIds, ...presenceTableIds])
  );

  const sessionMap = new Map<string, ActiveUserSession>();
  if (rpcAct && Array.isArray(rpcAct.live_sessions)) {
    for (const raw of rpcAct.live_sessions as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object') continue;
      const uid = String(raw.user_id ?? '').trim();
      if (!uid || sessionMap.has(uid)) continue;
      const vid = String(raw.current_video_id ?? '').trim() || null;
      const st = String(raw.status ?? '').toLowerCase().trim();
      sessionMap.set(uid, {
        userId: uid,
        userName: String(raw.user_name ?? '').trim(),
        username: String(raw.username ?? '').trim(),
        avatarUrl: String(raw.avatar_url ?? '').trim(),
        currentVideoId: vid,
        currentVideoTitle: String(raw.current_video_title ?? '').trim() || null,
        sessionStartedAt:
          typeof raw.session_started_at === 'string' ? raw.session_started_at : null,
        lastActiveAt: typeof raw.last_active_at === 'string' ? raw.last_active_at : null,
        status: st === 'watching' || vid ? 'watching' : 'online',
        device: String(raw.device ?? '').trim(),
        platform: String(raw.platform ?? '').trim(),
      });
    }
  }

  // Enrich from presenceTable or fallback user rows if v5 live_sessions is absent or incomplete
  if (
    sessionMap.size < mergedLiveIds.length ||
    (!rpcAct?.live_sessions && (schema.presenceTable || mergedLiveIds.length > 0))
  ) {
    const extraSessions = await fetchLiveActiveSessions(schema, mergedLiveIds).catch(() => []);
    for (const s of extraSessions) {
      const existing = sessionMap.get(s.userId);
      if (!existing) {
        sessionMap.set(s.userId, s);
      } else {
        sessionMap.set(s.userId, {
          ...existing,
          currentVideoId: existing.currentVideoId ?? s.currentVideoId,
          currentVideoTitle: existing.currentVideoTitle ?? s.currentVideoTitle,
          sessionStartedAt: existing.sessionStartedAt ?? s.sessionStartedAt,
          device: existing.device || s.device,
          platform: existing.platform || s.platform,
          status:
            existing.currentVideoId || s.currentVideoId || s.status === 'watching'
              ? 'watching'
              : existing.status,
        });
      }
    }
  }

  const liveSessions = Array.from(sessionMap.values());

  const totalUsers = rpcAct?.total_users ?? totalUsersRes.count ?? null;
  const liveActiveUsers =
    totalUsers === null && !rpcAct && mergedLiveIds.length === 0
      ? null
      : hasRpcLiveIds
      ? mergedLiveIds.length
      : Math.max(rpcAct?.live_active_users ?? 0, mergedLiveIds.length);
  const activeUsersToday = Math.max(
    rpcAct?.active_users_today ?? 0,
    !activeTodayRes.error ? activeTodayRes.count ?? 0 : 0,
    mergedLiveIds.length
  );
  const activeUsers7d = Math.max(
    rpcAct?.active_users_7d ?? 0,
    !activeUsers7dRes.error ? activeUsers7dRes.count ?? 0 : 0,
    activeUsersToday
  );
  const offlineUsers =
    totalUsers !== null && liveActiveUsers !== null
      ? Math.max(0, totalUsers - liveActiveUsers)
      : rpcAct?.offline_users ?? null;
  const newUsersToday = rpcAct?.new_users_today ?? newUsersRes.count ?? null;

  return {
    totalUsers,
    liveActiveUsers,
    liveUserIds: mergedLiveIds,
    liveSessions,
    activeUsersToday: totalUsers !== null || activeUsersToday > 0 ? activeUsersToday : null,
    activeUsers7d: totalUsers !== null || activeUsers7d > 0 ? activeUsers7d : null,
    offlineUsers,
    newUsersToday,
    verifiedUsers: verifiedUsersRes.count ?? null,
    blockedUsers: blockedUsersRes.count ?? null,
    totalVideos: totalVideosRes.count ?? null,
    videosUploadedToday: videosTodayRes.count ?? null,
    totalViews,
    totalLikes: likesTableRes.count ?? (v?.likesCol ? summedLikes : null),
    totalComments: commentsTableRes.count ?? (v?.commentsCol ? summedComments : null),
    totalFollowers,
    pendingVerifications: pendingVerifRes.count ?? null,
    storage: storageStats,
  };
}

export async function fetchLiveActiveSessions(
  schema: SchemaInspectionResult,
  knownLiveUserIds: string[] = []
): Promise<ActiveUserSession[]> {
  const supabase = getSupabaseClient();
  const twoMinutesAgoIso = new Date(Date.now() - HEARTBEAT_ONLINE_WINDOW_MS).toISOString();
  const cutoffMs = new Date(twoMinutesAgoIso).getTime();

  const byUser = new Map<string, Partial<ActiveUserSession>>();

  if (schema.presenceTable) {
    const { data: presRows } = await supabase
      .from(schema.presenceTable)
      .select('*')
      .limit(500);
    if (presRows) {
      for (const r of presRows as unknown as Record<string, unknown>[]) {
        const isOnlineFlag =
          r.is_online !== false && r.online !== false && String(r.status ?? '').toLowerCase() !== 'offline';
        const tsStr =
          extractLatestUserActivityTs(r, 'last_active_at') ||
          (typeof r.updated_at === 'string' ? r.updated_at : null) ||
          (typeof r.created_at === 'string' ? r.created_at : null);
        const ms = tsStr ? new Date(tsStr).getTime() : NaN;
        if (!isOnlineFlag || Number.isNaN(ms) || ms < cutoffMs) continue;

        const uid = String(r.user_id || r.profile_id || r.uid || r.id || '').trim();
        if (!uid) continue;

        const prev = byUser.get(uid);
        const prevMs = prev?.lastActiveAt ? new Date(prev.lastActiveAt).getTime() : -Infinity;
        if (prev && prevMs >= ms) continue;

        const vid = String(r.current_video_id || r.video_id || r.watching_video_id || '').trim() || null;
        const vtitle = String(r.current_video_title || r.video_title || '').trim() || null;
        const st = String(r.status || '').toLowerCase().trim();
        byUser.set(uid, {
          userId: uid,
          currentVideoId: vid,
          currentVideoTitle: vtitle,
          sessionStartedAt:
            (typeof r.session_started_at === 'string' && r.session_started_at) ||
            (typeof r.started_at === 'string' && r.started_at) ||
            tsStr,
          lastActiveAt: tsStr,
          status: st === 'watching' || vid ? 'watching' : 'online',
          device: String(r.device || r.device_name || r.device_model || '').trim(),
          platform: String(r.platform || r.os || '').trim(),
        });
      }
    }
  }

  for (const uid of knownLiveUserIds) {
    if (uid && !byUser.has(uid)) {
      byUser.set(uid, {
        userId: uid,
        currentVideoId: null,
        currentVideoTitle: null,
        sessionStartedAt: null,
        lastActiveAt: null,
        status: 'online',
        device: '',
        platform: '',
      });
    }
  }

  const allUserIds = Array.from(byUser.keys());
  if (allUserIds.length === 0) return [];

  const userMap = new Map<string, AppUser>();
  if (schema.users) {
    const u = schema.users;
    const { data: uRows } = await supabase
      .from(u.table)
      .select('*')
      .in(u.idCol, allUserIds.slice(0, 200));
    if (uRows) {
      for (const ur of uRows as unknown as Record<string, unknown>[]) {
        const norm = normalizeUser(ur, u);
        userMap.set(norm.id, norm);
        if (typeof ur.user_id === 'string' && ur.user_id) {
          userMap.set(ur.user_id, norm);
        }
      }
    }
  }

  const videoIdsToResolve = Array.from(
    new Set(
      Array.from(byUser.values())
        .filter((s) => s.currentVideoId && !s.currentVideoTitle)
        .map((s) => s.currentVideoId!)
    )
  );
  const videoTitleMap = new Map<string, string>();
  if (schema.videos && videoIdsToResolve.length > 0) {
    const v = schema.videos;
    const { data: vRows } = await supabase
      .from(v.table)
      .select([v.idCol, v.captionCol].filter(Boolean).join(','))
      .in(v.idCol, videoIdsToResolve.slice(0, 200));
    if (vRows) {
      for (const vr of vRows as unknown as Record<string, unknown>[]) {
        const vid = String(vr[v.idCol] ?? '');
        const title = getStr(vr, v.captionCol);
        if (vid && title) videoTitleMap.set(vid, title);
      }
    }
  }

  const results: ActiveUserSession[] = [];
  for (const [uid, s] of byUser.entries()) {
    const user = userMap.get(uid);
    const vid = s.currentVideoId ?? null;
    const vtitle = s.currentVideoTitle ?? (vid ? videoTitleMap.get(vid) ?? null : null);
    results.push({
      userId: uid,
      userName: user?.name || user?.username || uid,
      username: user?.username || '',
      avatarUrl: user?.avatarUrl || '',
      currentVideoId: vid,
      currentVideoTitle: vtitle,
      sessionStartedAt: s.sessionStartedAt ?? user?.lastActiveAt ?? null,
      lastActiveAt: s.lastActiveAt ?? user?.lastActiveAt ?? null,
      status: s.status === 'watching' || vid ? 'watching' : 'online',
      device: s.device ?? '',
      platform: s.platform ?? '',
    });
  }

  results.sort((a, b) => {
    const ams = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
    const bms = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
    return bms - ams;
  });

  return results;
}

export async function fetchAnalyticsTimeSeries(
  schema: SchemaInspectionResult,
  days = 14
): Promise<TimeSeriesPoint[]> {
  const supabase = getSupabaseClient();
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - (days - 1));
  const startIso = startDate.toISOString();

  const buckets = new Map<string, TimeSeriesPoint>();
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, {
      date: key,
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      users: 0,
      videos: 0,
      views: 0,
      engagement: 0,
      activeUsers: 0,
    });
  }

  const u = schema.users;
  const v = schema.videos;

  const [userRows, videoRows] = await Promise.all([
    u && u.createdAtCol
      ? supabase
          .from(u.table)
          .select([u.createdAtCol, u.lastActiveCol].filter(Boolean).join(','))
          .gte(u.createdAtCol, startIso)
          .limit(5000)
      : Promise.resolve({ data: null }),
    v && v.createdAtCol
      ? supabase
          .from(v.table)
          .select(
            [v.createdAtCol, v.viewsCol, v.likesCol, v.commentsCol].filter(Boolean).join(',')
          )
          .gte(v.createdAtCol, startIso)
          .limit(5000)
      : Promise.resolve({ data: null }),
  ]);

  if (u && u.createdAtCol && userRows.data) {
    for (const row of userRows.data as unknown as Record<string, unknown>[]) {
      const created = String(row[u.createdAtCol] ?? '').slice(0, 10);
      const bucket = buckets.get(created);
      if (bucket) bucket.users += 1;

      if (u.lastActiveCol && row[u.lastActiveCol]) {
        const activeDay = String(row[u.lastActiveCol]).slice(0, 10);
        const activeBucket = buckets.get(activeDay);
        if (activeBucket) activeBucket.activeUsers += 1;
      } else if (bucket) {
        bucket.activeUsers += 1;
      }
    }
  }

  if (v && v.createdAtCol && videoRows.data) {
    for (const row of videoRows.data as unknown as Record<string, unknown>[]) {
      const created = String(row[v.createdAtCol] ?? '').slice(0, 10);
      const bucket = buckets.get(created);
      if (bucket) {
        bucket.videos += 1;
        bucket.views += getNum(row, v.viewsCol);
        bucket.engagement += getNum(row, v.likesCol) + getNum(row, v.commentsCol);
      }
    }
  }

  return Array.from(buckets.values());
}

// ---------------------------------------------------------------------------
// USERS MANAGEMENT & USER DETAILS
// ---------------------------------------------------------------------------

export interface UsersQueryParams {
  page: number;
  pageSize: number;
  search: string;
  statusFilter: 'all' | 'active' | 'blocked' | 'suspended';
  verificationFilter: 'all' | 'verified' | 'pending' | 'unverified';
  activityFilter?: 'all' | 'online' | 'offline';
  liveUserIds?: string[];
  sortBy: 'created_at' | 'followers' | 'videos' | 'views' | 'name' | 'last_active';
  sortDir: 'asc' | 'desc';
}

export async function fetchUsersPage(
  schema: SchemaInspectionResult,
  params: UsersQueryParams
): Promise<{ users: AppUser[]; total: number }> {
  const m = schema.users;
  if (!m) {
    throw new Error('No users or profiles table detected in Supabase schema.');
  }
  const supabase = getSupabaseClient();
  let query = supabase.from(m.table).select('*', { count: 'exact' });

  const term = params.search.trim();
  if (term) {
    const safeTerm = term.replace(/[,()]/g, ' ');
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(safeTerm);
    const searchCols = [m.nameCol, m.usernameCol, m.emailCol, m.phoneCol].filter(
      Boolean
    ) as string[];
    const orParts = searchCols.map((c) => `${c}.ilike.%${safeTerm}%`);
    if (isUuid) {
      orParts.push(`${m.idCol}.eq.${safeTerm}`);
    }
    if (orParts.length > 0) {
      query = query.or(orParts.join(','));
    }
  }

  if (params.statusFilter !== 'all') {
    if (params.statusFilter === 'blocked') {
      if (m.statusCol && m.blockedCol) {
        query = query.or(`${m.statusCol}.in.(blocked,banned),${m.blockedCol}.eq.true`);
      } else if (m.blockedCol) {
        query = query.eq(m.blockedCol, true);
      } else if (m.statusCol) {
        query = query.in(m.statusCol, ['blocked', 'banned']);
      }
    } else if (params.statusFilter === 'active') {
      if (m.statusCol) query = query.or(`${m.statusCol}.eq.active,${m.statusCol}.is.null`);
      if (m.blockedCol) query = query.or(`${m.blockedCol}.is.null,${m.blockedCol}.eq.false`);
    } else if (m.statusCol) {
      query = query.eq(m.statusCol, params.statusFilter);
    }
  }

  if (params.verificationFilter !== 'all') {
    if (params.verificationFilter === 'verified') {
      if (m.verifiedCol && m.verificationStatusCol) {
        query = query.or(`${m.verifiedCol}.eq.true,${m.verificationStatusCol}.eq.verified`);
      } else if (m.verifiedCol) {
        query = query.eq(m.verifiedCol, true);
      } else if (m.verificationStatusCol) {
        query = query.eq(m.verificationStatusCol, 'verified');
      }
    } else if (m.verificationStatusCol) {
      query = query.eq(m.verificationStatusCol, params.verificationFilter);
    } else if (m.verifiedCol) {
      query = query.eq(m.verifiedCol, false);
    }
  }

  if (params.activityFilter === 'online' && params.liveUserIds !== undefined) {
    if (params.liveUserIds.length === 0) {
      return { users: [], total: 0 };
    }
  }

  const hasSeparateUserIdCol =
    Boolean(schema.rawTables[m.table]?.columns['user_id']) && m.idCol !== 'user_id';

  const applyActivityFilter = (
    q: typeof query,
    useOnlineCol: boolean,
    useLastActive: boolean
  ) => {
    if (!params.activityFilter || params.activityFilter === 'all') {
      return q;
    }
    if (params.liveUserIds !== undefined) {
      const ids = params.liveUserIds;
      if (params.activityFilter === 'online') {
        if (hasSeparateUserIdCol) {
          const list = ids.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
          return q.or(`${m.idCol}.in.(${list}),user_id.in.(${list})`);
        }
        return q.in(m.idCol, ids);
      }
      if (params.activityFilter === 'offline') {
        if (ids.length === 0) return q;
        const list = `(${ids.map((id) => `"${id.replace(/"/g, '')}"`).join(',')})`;
        let next = q.not(m.idCol, 'in', list);
        if (hasSeparateUserIdCol) {
          next = next.not('user_id', 'in', list);
        }
        return next;
      }
    }

    if (!useLastActive || !m.lastActiveCol) {
      return q;
    }
    const twoMinutesAgoIso = new Date(Date.now() - HEARTBEAT_ONLINE_WINDOW_MS).toISOString();
    if (params.activityFilter === 'online') {
      let next = q.gte(m.lastActiveCol, twoMinutesAgoIso);
      if (useOnlineCol && m.onlineCol) {
        next = next.or(`${m.onlineCol}.is.null,${m.onlineCol}.eq.true`);
      }
      return next;
    }
    if (params.activityFilter === 'offline') {
      if (useOnlineCol && m.onlineCol) {
        return q.or(
          `${m.lastActiveCol}.is.null,${m.lastActiveCol}.lt.${twoMinutesAgoIso},${m.onlineCol}.eq.false`
        );
      }
      return q.or(`${m.lastActiveCol}.is.null,${m.lastActiveCol}.lt.${twoMinutesAgoIso}`);
    }
    return q;
  };

  let orderCol = m.createdAtCol || m.idCol;
  if (params.sortBy === 'followers' && m.followersCountCol) orderCol = m.followersCountCol;
  else if (params.sortBy === 'videos' && m.videosCountCol) orderCol = m.videosCountCol;
  else if (params.sortBy === 'views' && m.viewsCountCol) orderCol = m.viewsCountCol;
  else if (params.sortBy === 'last_active' && m.lastActiveCol) orderCol = m.lastActiveCol;
  else if (params.sortBy === 'name' && (m.nameCol || m.usernameCol))
    orderCol = m.nameCol || m.usernameCol || m.idCol;

  const from = (params.page - 1) * params.pageSize;
  const to = from + params.pageSize - 1;

  let { data, count, error } = await applyActivityFilter(query, true, true)
    .order(orderCol, { ascending: params.sortDir === 'asc' })
    .range(from, to);

  if (
    error &&
    (error.message.toLowerCase().includes('does not exist') ||
      error.message.toLowerCase().includes('schema cache') ||
      error.code === 'PGRST204' ||
      error.code === '42703')
  ) {
    if (params.activityFilter === 'online') {
      // Retry without onlineCol first; if lastActiveCol itself is missing, 0 online users
      const retryNoOnline = await applyActivityFilter(query, false, true)
        .order(m.createdAtCol || m.idCol, { ascending: params.sortDir === 'asc' })
        .range(from, to);
      if (!retryNoOnline.error) {
        data = retryNoOnline.data;
        count = retryNoOnline.count;
        error = null;
      } else {
        return { users: [], total: 0 };
      }
    } else {
      const retryNoActivity = await applyActivityFilter(query, false, false)
        .order(m.createdAtCol || m.idCol, { ascending: params.sortDir === 'asc' })
        .range(from, to);
      data = retryNoActivity.data;
      count = retryNoActivity.count;
      error = retryNoActivity.error;
    }
  }
  if (error) throw new Error(error.message);

  const users = ((data ?? []) as Record<string, unknown>[]).map((r) => normalizeUser(r, m));

  // Enrich real video counts & views per user from videos table if needed
  if (schema.videos && users.length > 0) {
    const v = schema.videos;
    const ids = users.map((u) => u.id);
    const { data: videoRows } = await supabase
      .from(v.table)
      .select([v.ownerIdCol, v.viewsCol, v.statusCol].filter(Boolean).join(','))
      .in(v.ownerIdCol, ids);

    if (videoRows) {
      const countMap = new Map<string, { cnt: number; views: number }>();
      for (const vr of videoRows as unknown as Record<string, unknown>[]) {
        const oid = String(vr[v.ownerIdCol] ?? '');
        const st = v.statusCol ? String(vr[v.statusCol] ?? '').toLowerCase() : 'published';
        if (st === 'deleted') continue;
        const curr = countMap.get(oid) ?? { cnt: 0, views: 0 };
        curr.cnt += 1;
        curr.views += getNum(vr, v.viewsCol);
        countMap.set(oid, curr);
      }
      for (const user of users) {
        const stats = countMap.get(user.id);
        if (stats) {
          user.videoCount = stats.cnt;
          if (!m.viewsCountCol || user.totalViews === 0) {
            user.totalViews = stats.views;
          }
        }
      }
    }
  }

  return { users, total: count ?? users.length };
}

export async function searchUsersMinimal(
  schema: SchemaInspectionResult,
  search: string
): Promise<AppUser[]> {
  const m = schema.users;
  if (!m) return [];
  const supabase = getSupabaseClient();
  let query = supabase.from(m.table).select('*').limit(30);
  const term = search.trim();
  if (term) {
    const cols = [m.nameCol, m.usernameCol, m.emailCol].filter(Boolean) as string[];
    if (cols.length > 0) {
      const safe = term.replace(/[,()]/g, ' ');
      query = query.or(cols.map((c) => `${c}.ilike.%${safe}%`).join(','));
    }
  }
  if (m.createdAtCol) query = query.order(m.createdAtCol, { ascending: false });
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => normalizeUser(r, m));
}

export async function fetchUserDetails(
  schema: SchemaInspectionResult,
  userId: string
): Promise<{ user: AppUser; videos: VideoRecord[] }> {
  const m = schema.users;
  if (!m) throw new Error('Users table not detected.');
  const supabase = getSupabaseClient();

  const { data: userRow, error: userErr } = await supabase
    .from(m.table)
    .select('*')
    .eq(m.idCol, userId)
    .single();

  if (userErr || !userRow) {
    throw new Error(userErr?.message || 'User record not found.');
  }

  const user = normalizeUser(userRow as Record<string, unknown>, m);
  let videos: VideoRecord[] = [];

  if (schema.videos) {
    const v = schema.videos;
    let vQuery = supabase.from(v.table).select('*').eq(v.ownerIdCol, userId);
    if (v.createdAtCol) vQuery = vQuery.order(v.createdAtCol, { ascending: false });
    const { data: videoRows, error: vidErr } = await vQuery;
    if (vidErr) throw new Error(vidErr.message);

    const categories = await fetchCategories(schema).catch(() => []);
    const catMap = new Map(categories.map((c) => [c.id, c]));
    const ownerMap = new Map([[user.id, user]]);

    videos = ((videoRows ?? []) as Record<string, unknown>[]).map((r) =>
      normalizeVideo(r, v, ownerMap, catMap)
    );

    user.videoCount = videos.filter((vid) => vid.status !== 'deleted').length;
    user.totalViews = videos.reduce((acc, vid) => acc + vid.viewsCount, 0);
    user.totalLikes = videos.reduce((acc, vid) => acc + vid.likesCount, 0);
    user.totalComments = videos.reduce((acc, vid) => acc + vid.commentsCount, 0);
  }

  return { user, videos };
}

export async function updateUserProfileFields(
  schema: SchemaInspectionResult,
  userId: string,
  updates: { name?: string; username?: string; bio?: string; phone?: string }
): Promise<void> {
  const m = schema.users;
  if (!m) throw new Error('Users table not detected.');
  const supabase = getSupabaseClient();
  const payload: Record<string, unknown> = {};
  if (m.nameCol && updates.name !== undefined) payload[m.nameCol] = updates.name.trim();
  if (m.usernameCol && updates.username !== undefined)
    payload[m.usernameCol] = updates.username.trim();
  if (m.bioCol && updates.bio !== undefined) payload[m.bioCol] = updates.bio.trim();
  if (m.phoneCol && updates.phone !== undefined) payload[m.phoneCol] = updates.phone.trim();

  if (Object.keys(payload).length === 0) {
    throw new Error('No editable columns available on this user table.');
  }

  const { error } = await supabase.from(m.table).update(payload).eq(m.idCol, userId);
  if (error) throw new Error(error.message);
}

export interface CreateAdminUserInput {
  fullName: string;
  username?: string;
  email: string;
  phone: string;
  avatarFile?: File | null;
  avatarUrl?: string;
  bio?: string;
  accountStatus: 'active' | 'blocked' | 'suspended';
  verificationStatus: 'unverified' | 'pending' | 'verified';
  password?: string;
}

export async function createAdminUser(
  schema: SchemaInspectionResult,
  input: CreateAdminUserInput
): Promise<AppUser> {
  const m = schema.users;
  if (!m) throw new Error('Users table not detected in Supabase schema.');

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const username = (input.username ?? '').trim().replace(/^@+/, '').toLowerCase();
  const bio = (input.bio ?? '').trim();
  const password = (input.password ?? '').trim();

  if (!fullName) throw new Error('Full Name is required.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid Email address.');
  }
  const phoneDigits = phone.replace(/\D/g, '');
  if (!phone || phoneDigits.length < 7) {
    throw new Error('Please enter a valid Phone Number (at least 7 digits).');
  }
  if (username && !/^[a-z0-9._-]{2,32}$/i.test(username)) {
    throw new Error('Username must be 2–32 characters (letters, numbers, ".", "_", or "-").');
  }
  if (password && password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const supabase = getSupabaseClient();
  const prefs = getPreferences();

  // Pre-check duplicates in public users table before uploading any avatar
  if (m.emailCol) {
    const { data: dupEmail } = await supabase
      .from(m.table)
      .select(m.idCol)
      .ilike(m.emailCol, email)
      .limit(1);
    if (dupEmail && dupEmail.length > 0) {
      throw new Error(`A user with email "${email}" already exists.`);
    }
  }
  if (m.usernameCol && username) {
    const { data: dupUser } = await supabase
      .from(m.table)
      .select(m.idCol)
      .ilike(m.usernameCol, username)
      .limit(1);
    if (dupUser && dupUser.length > 0) {
      throw new Error(`Username "@${username}" is already taken.`);
    }
  }
  if (m.phoneCol) {
    const { data: dupPhone } = await supabase
      .from(m.table)
      .select(`${m.idCol},${m.phoneCol}`)
      .limit(1000);
    if (dupPhone) {
      const normalizedTarget = phone.replace(/[^0-9+]/g, '');
      const hasDupPhone = (dupPhone as unknown as Record<string, unknown>[]).some((row) => {
        const existing = String(row[m.phoneCol!] ?? '').replace(/[^0-9+]/g, '');
        return existing !== '' && (existing === normalizedTarget || existing.replace(/\D/g, '') === phoneDigits);
      });
      if (hasDupPhone) {
        throw new Error(`A user with phone number "${phone}" already exists.`);
      }
    }
  }

  // Upload profile photo to Supabase Storage if a file was selected
  let finalAvatarUrl = (input.avatarUrl ?? '').trim();
  let uploadedAvatarPath = '';
  if (input.avatarFile) {
    const ext =
      input.avatarFile.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    uploadedAvatarPath = `admin-created/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from(prefs.avatarBucket)
      .upload(uploadedAvatarPath, input.avatarFile, {
        contentType: input.avatarFile.type || 'image/jpeg',
        upsert: false,
      });
    if (uploadErr) {
      throw new Error(`Profile photo upload failed (${prefs.avatarBucket}): ${uploadErr.message}`);
    }
    const { data: pubData } = supabase.storage
      .from(prefs.avatarBucket)
      .getPublicUrl(uploadedAvatarPath);
    finalAvatarUrl = pubData.publicUrl;
  }

  const rollbackAvatar = async () => {
    if (uploadedAvatarPath) {
      await supabase.storage
        .from(prefs.avatarBucket)
        .remove([uploadedAvatarPath])
        .catch(() => undefined);
    }
  };

  // Primary path: secure SECURITY DEFINER admin_create_user RPC (creates auth.users + public users row atomically)
  const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_create_user', {
    p_full_name: fullName,
    p_email: email,
    p_phone: phone,
    p_username: username || null,
    p_avatar_url: finalAvatarUrl || null,
    p_bio: bio || null,
    p_status: input.accountStatus,
    p_verification_status: input.verificationStatus,
    p_password: password || null,
  });

  if (!rpcErr && rpcData && typeof rpcData === 'object') {
    const createdId = String((rpcData as { id?: string }).id ?? '');
    if (createdId) {
      const { data: row } = await supabase
        .from(m.table)
        .select('*')
        .eq(m.idCol, createdId)
        .maybeSingle();
      if (row) {
        return normalizeUser(row as Record<string, unknown>, m);
      }
    }
    return {
      id: createdId,
      name: fullName,
      username,
      email,
      phone,
      avatarUrl: finalAvatarUrl,
      bio,
      isVerified: input.verificationStatus === 'verified',
      verificationStatus: input.verificationStatus,
      accountStatus: input.accountStatus,
      followersCount: 0,
      followingCount: 0,
      videoCount: 0,
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      joinedAt: new Date().toISOString(),
      lastActiveAt: null,
      isOnline: false,
      raw: (rpcData as Record<string, unknown>) ?? {},
    };
  }

  const rpcMsg = rpcErr?.message.toLowerCase() ?? '';
  const isMissingRpc =
    rpcErr?.code === 'PGRST202' ||
    rpcErr?.code === '42883' ||
    rpcMsg.includes('could not find the function') ||
    rpcMsg.includes('does not exist');

  if (!isMissingRpc && rpcErr) {
    await rollbackAvatar();
    throw new Error(rpcErr.message);
  }

  // Fallback if v5 SQL migration hasn't been executed yet: create Auth user via non-persisting client
  const config = getActiveSupabaseConfig();
  if (!config) {
    await rollbackAvatar();
    throw new Error('Supabase connection is not configured.');
  }
  const ephemeralClient = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const tempPassword =
    password || `Blade_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

  const { data: signUpData, error: signUpErr } = await ephemeralClient.auth.signUp({
    email,
    password: tempPassword,
    options: {
      data: {
        full_name: fullName,
        name: fullName,
        username: username || email.split('@')[0],
        phone,
        avatar_url: finalAvatarUrl,
      },
    },
  });

  if (signUpErr || !signUpData.user) {
    await rollbackAvatar();
    throw new Error(
      signUpErr?.message ||
        'Failed to create user. Run the BLADE SQL Migration v5 in Settings to enable admin_create_user().'
    );
  }

  const newUid = signUpData.user.id;
  const upsertPayload: Record<string, unknown> = {
    [m.idCol]: newUid,
  };
  if (m.nameCol) upsertPayload[m.nameCol] = fullName;
  if (m.usernameCol && username) upsertPayload[m.usernameCol] = username;
  if (m.emailCol) upsertPayload[m.emailCol] = email;
  if (m.phoneCol) upsertPayload[m.phoneCol] = phone;
  if (m.avatarCol && finalAvatarUrl) upsertPayload[m.avatarCol] = finalAvatarUrl;
  if (m.bioCol && bio) upsertPayload[m.bioCol] = bio;
  if (m.statusCol) upsertPayload[m.statusCol] = input.accountStatus;
  if (m.blockedCol) upsertPayload[m.blockedCol] = input.accountStatus === 'blocked';
  if (m.suspendedCol) upsertPayload[m.suspendedCol] = input.accountStatus === 'suspended';
  if (m.verifiedCol) upsertPayload[m.verifiedCol] = input.verificationStatus === 'verified';
  if (m.verificationStatusCol) upsertPayload[m.verificationStatusCol] = input.verificationStatus;

  const { data: upsertedRow, error: upsertErr } = await supabase
    .from(m.table)
    .upsert(upsertPayload, { onConflict: m.idCol })
    .select('*')
    .single();

  if (upsertErr) {
    await rollbackAvatar();
    throw new Error(
      `Auth user created (${email}), but profile upsert failed: ${upsertErr.message}. Run SQL Migration v5 for atomic admin_create_user().`
    );
  }

  return normalizeUser(upsertedRow as Record<string, unknown>, m);
}

export async function updateUserAccountStatus(
  schema: SchemaInspectionResult,
  userId: string,
  status: AccountStatus
): Promise<void> {
  const m = schema.users;
  if (!m) throw new Error('Users table not detected.');
  const supabase = getSupabaseClient();

  if (status === 'active' || status === 'blocked' || status === 'suspended') {
    const { error: rpcErr } = await supabase.rpc('admin_set_user_status', {
      p_user_id: userId,
      p_status: status,
    });
    if (!rpcErr) return;
    const msg = rpcErr.message.toLowerCase();
    const isMissingRpc =
      rpcErr.code === 'PGRST202' ||
      rpcErr.code === '42883' ||
      msg.includes('could not find the function') ||
      msg.includes('does not exist');
    if (!isMissingRpc) {
      throw new Error(rpcErr.message);
    }
  }

  const payload: Record<string, unknown> = {};
  if (m.statusCol) payload[m.statusCol] = status;
  if (m.blockedCol) payload[m.blockedCol] = status === 'blocked';
  if (m.suspendedCol) payload[m.suspendedCol] = status === 'suspended';

  if (Object.keys(payload).length === 0) {
    throw new Error(
      `Column "${m.table}.status" or "is_blocked" not found. Run the SQL migration to add account status columns.`
    );
  }

  const workingPayload = { ...payload };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from(m.table)
      .update(workingPayload)
      .eq(m.idCol, userId)
      .select(m.idCol);

    if (!error) {
      if (!data || data.length === 0) {
        throw new Error(
          `User status update was blocked by Supabase RLS (0 rows updated). Run the BLADE SQL Migration in Settings.`
        );
      }
      return;
    }

    const lower = error.message.toLowerCase();
    const removedKey = Object.keys(workingPayload).find(
      (col) =>
        lower.includes(`'${col.toLowerCase()}'`) ||
        lower.includes(`"${col.toLowerCase()}"`) ||
        (lower.includes('check constraint') && col === m.statusCol)
    );
    if (removedKey && Object.keys(workingPayload).length > 1) {
      delete workingPayload[removedKey];
      continue;
    }
    throw new Error(error.message);
  }
}

export async function updateUserVerification(
  schema: SchemaInspectionResult,
  userId: string,
  nextState: VerificationState,
  requestId?: string,
  note?: string
): Promise<void> {
  const m = schema.users;
  if (!m) throw new Error('Users table not detected.');
  const supabase = getSupabaseClient();

  const userPayload: Record<string, unknown> = {};
  if (m.verifiedCol) userPayload[m.verifiedCol] = nextState === 'verified';
  if (m.verificationStatusCol) userPayload[m.verificationStatusCol] = nextState;

  if (Object.keys(userPayload).length > 0) {
    const { data: uUpdated, error: uErr } = await supabase
      .from(m.table)
      .update(userPayload)
      .eq(m.idCol, userId)
      .select(m.idCol);
    if (uErr) throw new Error(uErr.message);
    if (!uUpdated || uUpdated.length === 0) {
      throw new Error(
        'User verification update was blocked by Supabase RLS (0 rows modified). Run the BLADE SQL Migration in Settings.'
      );
    }
  }

  if (schema.verifications) {
    const vr = schema.verifications;
    const nowIso = new Date().toISOString();
    const vrPayload: Record<string, unknown> = {
      [vr.statusCol]: nextState,
    };
    if (vr.noteCol && note !== undefined) vrPayload[vr.noteCol] = note;
    if (vr.reviewedAtCol) vrPayload[vr.reviewedAtCol] = nowIso;

    // Prevent duplicate verification records by checking existing rows for this user_id
    const { data: existingRows } = await supabase
      .from(vr.table)
      .select(vr.idCol)
      .eq(vr.userIdCol, userId);

    const existingList = (existingRows ?? []) as unknown as Record<string, unknown>[];
    if (existingList.length > 0) {
      const keepId = requestId || String(existingList[0][vr.idCol]);
      const { error: upErr } = await supabase
        .from(vr.table)
        .update(vrPayload)
        .eq(vr.idCol, keepId);
      if (upErr) throw new Error(upErr.message);

      // Remove any stale duplicates if they existed previously
      const duplicateIds = existingList
        .map((r) => String(r[vr.idCol]))
        .filter((id) => id !== keepId);
      if (duplicateIds.length > 0) {
        await supabase.from(vr.table).delete().in(vr.idCol, duplicateIds);
      }
    } else if (requestId) {
      const { error: rErr } = await supabase
        .from(vr.table)
        .update(vrPayload)
        .eq(vr.idCol, requestId);
      if (rErr) throw new Error(rErr.message);
    } else {
      const insertRow: Record<string, unknown> = {
        [vr.userIdCol]: userId,
        ...vrPayload,
      };
      const { error: insErr } = await supabase.from(vr.table).insert(insertRow);
      if (insErr) throw new Error(insErr.message);
    }
  }
}

export async function deleteUserSafely(
  schema: SchemaInspectionResult,
  userId: string
): Promise<{ mode: 'deleted' | 'soft_deleted' }> {
  const m = schema.users;
  if (!m) throw new Error('Users table not detected.');
  const supabase = getSupabaseClient();

  // Prevent deleting an active Blade administrator account
  const { data: adminCheck } = await supabase
    .from('blade_admins')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (adminCheck) {
    throw new Error('Cannot delete an active BLADE administrator account from user management.');
  }

  const prefs = getPreferences();
  if (prefs.deletionStrategy === 'soft' && m.statusCol) {
    const { error } = await supabase
      .from(m.table)
      .update({ [m.statusCol]: 'deleted' })
      .eq(m.idCol, userId);
    if (error) throw new Error(error.message);
    return { mode: 'soft_deleted' };
  }

  const { error } = await supabase.from(m.table).delete().eq(m.idCol, userId);
  if (error) throw new Error(error.message);
  return { mode: 'deleted' };
}

// ---------------------------------------------------------------------------
// VIDEOS MANAGEMENT & ADMIN VIDEO UPLOAD
// ---------------------------------------------------------------------------

export interface VideosQueryParams {
  page: number;
  pageSize: number;
  search: string;
  statusFilter: 'all' | VideoStatus;
  visibilityFilter: 'all' | VideoVisibility;
  categoryFilter: string;
  sortBy: 'created_at' | 'views' | 'likes' | 'comments';
  sortDir: 'asc' | 'desc';
}

export async function fetchVideosPage(
  schema: SchemaInspectionResult,
  params: VideosQueryParams
): Promise<{ videos: VideoRecord[]; total: number }> {
  const v = schema.videos;
  if (!v) throw new Error('No videos table detected in Supabase schema.');
  const supabase = getSupabaseClient();

  const buildVideoQuery = (useModerationFlags: boolean, skipStatusCol = false) => {
    let query = supabase.from(v.table).select('*', { count: 'exact' });
    const statusCol = skipStatusCol ? null : v.statusCol;

    if (params.statusFilter !== 'all') {
      if (params.statusFilter === 'blocked') {
        if (useModerationFlags && statusCol && v.isBlockedCol) {
          query = query.or(`${statusCol}.eq.blocked,${v.isBlockedCol}.eq.true`);
        } else if (useModerationFlags && v.isBlockedCol) {
          query = query.eq(v.isBlockedCol, true);
        } else if (statusCol) {
          query = query.eq(statusCol, 'blocked');
        }
      } else if (params.statusFilter === 'hidden') {
        if (useModerationFlags && statusCol && v.isHiddenCol) {
          query = query.or(`${statusCol}.eq.hidden,${v.isHiddenCol}.eq.true`);
        } else if (useModerationFlags && v.isHiddenCol) {
          query = query.eq(v.isHiddenCol, true);
        } else if (statusCol) {
          query = query.eq(statusCol, 'hidden');
        }
      } else if (params.statusFilter === 'published') {
        if (statusCol) {
          query = query.or(
            `${statusCol}.in.(published,active,approved,public),${statusCol}.is.null`
          );
        }
        if (useModerationFlags && v.isHiddenCol) {
          query = query.or(`${v.isHiddenCol}.is.null,${v.isHiddenCol}.eq.false`);
        }
        if (useModerationFlags && v.isBlockedCol) {
          query = query.or(`${v.isBlockedCol}.is.null,${v.isBlockedCol}.eq.false`);
        }
      } else if (statusCol) {
        query = query.eq(statusCol, params.statusFilter);
      }
    }
    if (params.visibilityFilter !== 'all' && v.visibilityCol) {
      query = query.eq(v.visibilityCol, params.visibilityFilter);
    }
    if (params.categoryFilter !== 'all') {
      if (v.categoryIdCol) {
        query = query.eq(v.categoryIdCol, params.categoryFilter);
      } else if (v.categoryNameCol) {
        query = query.eq(v.categoryNameCol, params.categoryFilter);
      }
    }
    return query;
  };

  let matchingOwnerIds: string[] = [];
  const term = params.search.trim();
  if (term && schema.users && (schema.users.usernameCol || schema.users.nameCol)) {
    const safe = term.replace(/[,()]/g, ' ');
    const u = schema.users;
    const uCols = [u.usernameCol, u.nameCol].filter(Boolean) as string[];
    const { data: matchedOwners } = await supabase
      .from(u.table)
      .select(u.idCol)
      .or(uCols.map((c) => `${c}.ilike.%${safe}%`).join(','))
      .limit(50);
    if (matchedOwners) {
      matchingOwnerIds = (matchedOwners as unknown as Record<string, unknown>[]).map((r) =>
        String(r[u.idCol])
      );
    }
  }

  const finalizeVideoQuery = (q: ReturnType<typeof buildVideoQuery>) => {
    let query = q;
    if (term) {
      const safe = term.replace(/[,()]/g, ' ');
      const searchCols = [v.captionCol, v.descriptionCol, v.categoryNameCol].filter(
        Boolean
      ) as string[];
      const orParts = searchCols.map((c) => `${c}.ilike.%${safe}%`);
      if (matchingOwnerIds.length > 0) {
        orParts.push(`${v.ownerIdCol}.in.(${matchingOwnerIds.join(',')})`);
      }
      if (orParts.length > 0) {
        query = query.or(orParts.join(','));
      }
    }

    let orderCol = v.createdAtCol || v.idCol;
    if (params.sortBy === 'views' && v.viewsCol) orderCol = v.viewsCol;
    else if (params.sortBy === 'likes' && v.likesCol) orderCol = v.likesCol;
    else if (params.sortBy === 'comments' && v.commentsCol) orderCol = v.commentsCol;

    query = query.order(orderCol, { ascending: params.sortDir === 'asc' });

    const from = (params.page - 1) * params.pageSize;
    const to = from + params.pageSize - 1;
    return query.range(from, to);
  };

  let { data, count, error } = await finalizeVideoQuery(buildVideoQuery(true, false));
  if (error) {
    const errLower = error.message.toLowerCase();
    if (error.code === '22P02' || errLower.includes('invalid input value for enum')) {
      const retryEnum = await finalizeVideoQuery(buildVideoQuery(true, true));
      data = retryEnum.data;
      count = retryEnum.count;
      error = retryEnum.error;
    } else if (
      errLower.includes('does not exist') ||
      errLower.includes('schema cache') ||
      error.code === 'PGRST204' ||
      error.code === '42703'
    ) {
      const retry = await finalizeVideoQuery(buildVideoQuery(false, false));
      data = retry.data;
      count = retry.count;
      error = retry.error;
    }
  }
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Record<string, unknown>[];
  const ownerIds = Array.from(new Set(rows.map((r) => String(r[v.ownerIdCol] ?? '')).filter(Boolean)));

  const ownerMap = new Map<string, AppUser>();
  if (schema.users && ownerIds.length > 0) {
    const u = schema.users;
    const { data: ownerRows } = await supabase.from(u.table).select('*').in(u.idCol, ownerIds);
    if (ownerRows) {
      for (const orow of ownerRows as Record<string, unknown>[]) {
        const normalized = normalizeUser(orow, u);
        ownerMap.set(normalized.id, normalized);
      }
    }
  }

  const categories = await fetchCategories(schema).catch(() => []);
  const catMap = new Map(categories.map((c) => [c.id, c]));

  const videos = rows.map((r) => normalizeVideo(r, v, ownerMap, catMap));
  return { videos, total: count ?? videos.length };
}

function isPgArrayColumnType(typeStr?: string): boolean {
  const t = (typeStr ?? '').toLowerCase().trim();
  return t === 'array' || t.includes('[]') || t.startsWith('_') || t.includes('array');
}

function formatHashtagsForColumn(
  schema: SchemaInspectionResult,
  table: string,
  col: string,
  hashtags: string[]
): string[] | string {
  const colType = schema.rawTables[table]?.columns[col]?.type;
  if (isPgArrayColumnType(colType)) {
    return hashtags;
  }
  if ((colType ?? '').toLowerCase().includes('text') || (colType ?? '').toLowerCase().includes('char')) {
    return hashtags.join(' ');
  }
  return hashtags;
}

export async function updateVideoRecord(
  schema: SchemaInspectionResult,
  videoId: string,
  updates: {
    caption?: string;
    description?: string;
    hashtags?: string[];
    categoryId?: string | null;
    categoryName?: string;
    status?: VideoStatus;
    visibility?: VideoVisibility;
  }
): Promise<void> {
  const v = schema.videos;
  if (!v) throw new Error('Videos table not detected.');
  const supabase = getSupabaseClient();

  let moderationHandledByRpc = false;

  // Fast path: server-verified SECURITY DEFINER RPC (handles status + is_hidden + is_blocked + RLS)
  if (updates.status !== undefined && updates.status !== 'deleted') {
    const { error: rpcErr } = await supabase.rpc('admin_set_video_moderation', {
      p_video_id: videoId,
      p_status: updates.status,
    });
    if (!rpcErr) {
      moderationHandledByRpc = true;
    } else {
      const msg = rpcErr.message.toLowerCase();
      const isMissingRpc =
        rpcErr.code === 'PGRST202' ||
        rpcErr.code === '42883' ||
        msg.includes('could not find the function') ||
        msg.includes('does not exist');
      if (!isMissingRpc) {
        throw new Error(rpcErr.message);
      }
    }
  }

  const payload: Record<string, unknown> = {};

  if (v.captionCol && updates.caption !== undefined) payload[v.captionCol] = updates.caption;
  if (v.descriptionCol && updates.description !== undefined)
    payload[v.descriptionCol] = updates.description;
  if (v.hashtagsCol && updates.hashtags !== undefined) {
    payload[v.hashtagsCol] = formatHashtagsForColumn(
      schema,
      v.table,
      v.hashtagsCol,
      updates.hashtags
    );
  }
  if (v.categoryIdCol && updates.categoryId !== undefined)
    payload[v.categoryIdCol] = updates.categoryId || null;
  if (v.categoryNameCol && updates.categoryName !== undefined)
    payload[v.categoryNameCol] = updates.categoryName;
  if (!moderationHandledByRpc && updates.status !== undefined) {
    const knownCols = new Set(
      Object.keys(schema.rawTables[v.table]?.columns ?? {}).map((c) => c.toLowerCase())
    );
    const isHiddenVal = updates.status === 'hidden';
    const isBlockedVal = updates.status === 'blocked';
    const isPublicVal = updates.status === 'published';

    if (v.statusCol) payload[v.statusCol] = updates.status;
    if (knownCols.has('moderation_status') && v.statusCol !== 'moderation_status') {
      payload.moderation_status = updates.status;
    }
    if (v.isHiddenCol) payload[v.isHiddenCol] = isHiddenVal;
    if (knownCols.has('hidden') && v.isHiddenCol !== 'hidden') payload.hidden = isHiddenVal;
    if (v.isBlockedCol) payload[v.isBlockedCol] = isBlockedVal;
    if (knownCols.has('blocked') && v.isBlockedCol !== 'blocked') payload.blocked = isBlockedVal;
    if (knownCols.has('is_active')) payload.is_active = isPublicVal;
    if (knownCols.has('is_visible')) payload.is_visible = isPublicVal;
    if (knownCols.has('is_published')) payload.is_published = isPublicVal;
    if (knownCols.has('is_public')) payload.is_public = isPublicVal;
  }
  if (v.visibilityCol && updates.visibility !== undefined)
    payload[v.visibilityCol] = updates.visibility;

  if (Object.keys(payload).length === 0) {
    if (moderationHandledByRpc) return;
    throw new Error('No matching video columns found to update.');
  }

  const workingPayload = { ...payload };

  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabase
      .from(v.table)
      .update(workingPayload)
      .eq(v.idCol, videoId)
      .select(v.idCol);

    if (!error) {
      if (!data || data.length === 0) {
        throw new Error(
          'Video update was blocked by Supabase RLS (0 rows modified). Run the BLADE SQL Migration in Settings to grant admin moderation permissions.'
        );
      }
      return;
    }

    const lower = error.message.toLowerCase();

    if (
      v.hashtagsCol &&
      updates.hashtags !== undefined &&
      lower.includes('malformed array literal')
    ) {
      workingPayload[v.hashtagsCol] = updates.hashtags;
      continue;
    }

    const isConstraintOrEnum =
      error.code === '22P02' ||
      error.code === '23514' ||
      lower.includes('check constraint') ||
      lower.includes('invalid input value for enum');

    if (isConstraintOrEnum) {
      const statusLikeCol = Object.keys(workingPayload).find(
        (col) => col === v.statusCol || col === 'status' || col === 'moderation_status'
      );
      if (statusLikeCol && Object.keys(workingPayload).length > 1) {
        delete workingPayload[statusLikeCol];
        continue;
      }
    }

    // Strip missing column from schema cache (e.g. is_hidden / is_blocked not migrated yet)
    const missingOrInvalidCol = Object.keys(workingPayload).find(
      (col) =>
        lower.includes(`'${col.toLowerCase()}'`) ||
        lower.includes(`"${col.toLowerCase()}"`)
    );
    if (missingOrInvalidCol && Object.keys(workingPayload).length > 1) {
      delete workingPayload[missingOrInvalidCol];
      continue;
    }

    throw new Error(error.message);
  }
}

function inferStorageLocation(
  urlOrPath: string,
  defaultBucket: string
): { bucket: string; path: string } | null {
  if (!urlOrPath) return null;
  if (!urlOrPath.startsWith('http')) {
    return { bucket: defaultBucket, path: urlOrPath.replace(/^\/+/, '') };
  }
  const match = urlOrPath.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (match) {
    return { bucket: match[1], path: decodeURIComponent(match[2]) };
  }
  return null;
}

export async function deleteVideoRecord(
  schema: SchemaInspectionResult,
  video: VideoRecord,
  strategy: DeletionStrategy
): Promise<void> {
  const v = schema.videos;
  if (!v) throw new Error('Videos table not detected.');
  const supabase = getSupabaseClient();
  const prefs = getPreferences();

  if (strategy === 'soft') {
    if (!v.statusCol) {
      throw new Error('Soft delete requires a status column on the videos table.');
    }
    const { error } = await supabase
      .from(v.table)
      .update({ [v.statusCol]: 'deleted' })
      .eq(v.idCol, video.id);
    if (error) throw new Error(error.message);
    return;
  }

  // Hard delete: remove database record first so Android feed drops it immediately
  const { error: dbErr } = await supabase.from(v.table).delete().eq(v.idCol, video.id);
  if (dbErr) throw new Error(dbErr.message);

  // Clean up real Supabase Storage files if determinable
  const vidLoc = inferStorageLocation(video.storagePath || video.videoUrl, prefs.videoBucket);
  if (vidLoc) {
    await supabase.storage.from(vidLoc.bucket).remove([vidLoc.path]).catch(() => undefined);
  }
  const thumbLoc = inferStorageLocation(
    video.thumbnailPath || video.thumbnailUrl,
    prefs.thumbnailBucket
  );
  if (thumbLoc) {
    await supabase.storage.from(thumbLoc.bucket).remove([thumbLoc.path]).catch(() => undefined);
  }
}

export interface UploadAdminVideoParams {
  file: File;
  thumbnailBlob: Blob | null;
  ownerId: string;
  caption: string;
  description: string;
  hashtags: string[];
  categoryId: string | null;
  categoryName: string;
  visibility: VideoVisibility;
  status: VideoStatus;
  durationSeconds: number | null;
  onProgress?: (stage: string, percent: number) => void;
}

export async function uploadVideoAsOwner(
  schema: SchemaInspectionResult,
  params: UploadAdminVideoParams
): Promise<VideoRecord> {
  const v = schema.videos;
  if (!v) throw new Error('Videos table not detected in Supabase schema.');
  if (!params.ownerId) throw new Error('Please select a real user as the Video Owner.');

  const supabase = getSupabaseClient();
  const prefs = getPreferences();

  const safeExt = params.file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const timestamp = Date.now();
  const videoPath = `${params.ownerId}/${timestamp}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;

  params.onProgress?.('Uploading video file to Supabase Storage…', 20);
  const { error: vidUploadErr } = await supabase.storage
    .from(prefs.videoBucket)
    .upload(videoPath, params.file, {
      contentType: params.file.type || 'video/mp4',
      upsert: false,
    });

  if (vidUploadErr) {
    throw new Error(`Video upload failed (${prefs.videoBucket}): ${vidUploadErr.message}`);
  }

  const { data: vidPublic } = supabase.storage.from(prefs.videoBucket).getPublicUrl(videoPath);
  const videoUrl = vidPublic.publicUrl;

  let thumbnailUrl = '';
  let thumbnailPath = '';

  if (params.thumbnailBlob) {
    params.onProgress?.('Uploading generated thumbnail…', 65);
    thumbnailPath = `${params.ownerId}/${timestamp}_thumb.jpg`;
    const { error: thumbErr } = await supabase.storage
      .from(prefs.thumbnailBucket)
      .upload(thumbnailPath, params.thumbnailBlob, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (!thumbErr) {
      const { data: thumbPub } = supabase.storage
        .from(prefs.thumbnailBucket)
        .getPublicUrl(thumbnailPath);
      thumbnailUrl = thumbPub.publicUrl;
    }
  }

  params.onProgress?.('Creating database video record for selected owner…', 88);

  const insertPayload: Record<string, unknown> = {
    [v.ownerIdCol]: params.ownerId,
  };

  if (v.videoUrlCol) insertPayload[v.videoUrlCol] = videoUrl;
  if (v.storagePathCol) insertPayload[v.storagePathCol] = videoPath;
  if (v.thumbnailUrlCol && thumbnailUrl) insertPayload[v.thumbnailUrlCol] = thumbnailUrl;
  if (v.thumbnailPathCol && thumbnailPath) insertPayload[v.thumbnailPathCol] = thumbnailPath;
  if (v.captionCol) insertPayload[v.captionCol] = params.caption.trim();
  if (v.descriptionCol) insertPayload[v.descriptionCol] = params.description.trim();
  if (v.hashtagsCol) {
    if (params.hashtags.length > 0) {
      insertPayload[v.hashtagsCol] = formatHashtagsForColumn(
        schema,
        v.table,
        v.hashtagsCol,
        params.hashtags
      );
    } else if (isPgArrayColumnType(schema.rawTables[v.table]?.columns[v.hashtagsCol]?.type)) {
      insertPayload[v.hashtagsCol] = [];
    }
  }
  if (v.categoryIdCol && params.categoryId) insertPayload[v.categoryIdCol] = params.categoryId;
  if (v.categoryNameCol && params.categoryName)
    insertPayload[v.categoryNameCol] = params.categoryName;
  if (v.visibilityCol) insertPayload[v.visibilityCol] = params.visibility;
  if (v.statusCol) insertPayload[v.statusCol] = params.status;
  if (v.durationCol && params.durationSeconds !== null)
    insertPayload[v.durationCol] = params.durationSeconds;

  let { data: insertedRow, error: insertErr } = await supabase
    .from(v.table)
    .insert(insertPayload)
    .select('*')
    .single();

  // Handle text vs text[] column mismatch gracefully without failing upload
  if (insertErr && v.hashtagsCol && insertErr.message.toLowerCase().includes('malformed array literal')) {
    insertPayload[v.hashtagsCol] = params.hashtags;
    const retry = await supabase.from(v.table).insert(insertPayload).select('*').single();
    insertedRow = retry.data;
    insertErr = retry.error;
  } else if (
    insertErr &&
    v.hashtagsCol &&
    Array.isArray(insertPayload[v.hashtagsCol]) &&
    (insertErr.message.toLowerCase().includes('cannot be matched') ||
      insertErr.message.toLowerCase().includes('invalid input syntax'))
  ) {
    insertPayload[v.hashtagsCol] = params.hashtags.join(' ');
    const retry = await supabase.from(v.table).insert(insertPayload).select('*').single();
    insertedRow = retry.data;
    insertErr = retry.error;
  }

  if (insertErr) {
    // Rollback uploaded storage objects so no orphaned files remain
    await supabase.storage.from(prefs.videoBucket).remove([videoPath]).catch(() => undefined);
    if (thumbnailPath) {
      await supabase.storage
        .from(prefs.thumbnailBucket)
        .remove([thumbnailPath])
        .catch(() => undefined);
    }
    throw new Error(`Database insert failed: ${insertErr.message}`);
  }

  params.onProgress?.('Completed', 100);
  return normalizeVideo(
    insertedRow as Record<string, unknown>,
    v,
    new Map(),
    new Map()
  );
}

// ---------------------------------------------------------------------------
// CATEGORIES
// ---------------------------------------------------------------------------

export async function fetchCategories(schema: SchemaInspectionResult): Promise<CategoryRecord[]> {
  const c = schema.categories;
  if (!c) return [];
  const supabase = getSupabaseClient();
  let query = supabase.from(c.table).select('*');
  if (c.sortOrderCol) query = query.order(c.sortOrderCol, { ascending: true });
  else query = query.order(c.nameCol, { ascending: true });

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const cats: CategoryRecord[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r[c.idCol] ?? ''),
    name: getStr(r, c.nameCol),
    slug: getStr(r, c.slugCol) || slugifyCategory(getStr(r, c.nameCol)),
    description: getStr(r, c.descriptionCol),
    isEnabled: c.enabledCol ? Boolean(r[c.enabledCol]) : true,
    sortOrder: getNum(r, c.sortOrderCol),
    videoCount: null,
    createdAt: c.createdAtCol ? (r[c.createdAtCol] as string | null) ?? null : null,
  }));

  if (schema.videos && cats.length > 0) {
    const v = schema.videos;
    const countField = v.categoryIdCol || v.categoryNameCol;
    if (countField) {
      const { data: vidRows } = await supabase.from(v.table).select(countField).limit(5000);
      if (vidRows) {
        const counts = new Map<string, number>();
        for (const vr of vidRows as unknown as Record<string, unknown>[]) {
          const key = String(vr[countField] ?? '');
          if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        for (const cat of cats) {
          cat.videoCount =
            counts.get(v.categoryIdCol ? cat.id : cat.name) ?? 0;
        }
      }
    }
  }

  return cats;
}

export async function createCategory(
  schema: SchemaInspectionResult,
  input: { name: string; description: string; isEnabled: boolean; sortOrder: number }
): Promise<void> {
  const c = schema.categories;
  if (!c) throw new Error('Categories table not detected.');
  const supabase = getSupabaseClient();
  const payload: Record<string, unknown> = {
    [c.nameCol]: input.name.trim(),
  };
  if (c.slugCol) payload[c.slugCol] = slugifyCategory(input.name);
  if (c.descriptionCol) payload[c.descriptionCol] = input.description.trim();
  if (c.enabledCol) payload[c.enabledCol] = input.isEnabled;
  if (c.sortOrderCol) payload[c.sortOrderCol] = input.sortOrder;

  const { error } = await supabase.from(c.table).insert(payload);
  if (error) throw new Error(error.message);
}

export async function updateCategory(
  schema: SchemaInspectionResult,
  id: string,
  input: { name?: string; description?: string; isEnabled?: boolean; sortOrder?: number }
): Promise<void> {
  const c = schema.categories;
  if (!c) throw new Error('Categories table not detected.');
  const supabase = getSupabaseClient();
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) {
    payload[c.nameCol] = input.name.trim();
    if (c.slugCol) payload[c.slugCol] = slugifyCategory(input.name);
  }
  if (c.descriptionCol && input.description !== undefined)
    payload[c.descriptionCol] = input.description.trim();
  if (c.enabledCol && input.isEnabled !== undefined) payload[c.enabledCol] = input.isEnabled;
  if (c.sortOrderCol && input.sortOrder !== undefined) payload[c.sortOrderCol] = input.sortOrder;

  const { error } = await supabase.from(c.table).update(payload).eq(c.idCol, id);
  if (error) throw new Error(error.message);
}

export async function deleteCategorySafely(
  schema: SchemaInspectionResult,
  cat: CategoryRecord
): Promise<void> {
  const c = schema.categories;
  if (!c) throw new Error('Categories table not detected.');
  const supabase = getSupabaseClient();

  if (schema.videos) {
    const v = schema.videos;
    const matchCol = v.categoryIdCol || v.categoryNameCol;
    const matchVal = v.categoryIdCol ? cat.id : cat.name;
    if (matchCol) {
      const { count } = await supabase
        .from(v.table)
        .select('*', { count: 'exact', head: true })
        .eq(matchCol, matchVal);
      if (count && count > 0) {
        throw new Error(
          `Cannot delete category "${cat.name}" because ${count} real video(s) reference it. Disable it instead or reassign those videos first.`
        );
      }
    }
  }

  const { error } = await supabase.from(c.table).delete().eq(c.idCol, cat.id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// VERIFICATIONS QUEUE
// ---------------------------------------------------------------------------

export async function fetchVerificationQueue(
  schema: SchemaInspectionResult,
  statusFilter: 'all' | VerificationState
): Promise<VerificationRequestRecord[]> {
  const supabase = getSupabaseClient();
  const byUserId = new Map<string, VerificationRequestRecord>();

  // 1. Load records from verification_requests table (if present)
  if (schema.verifications) {
    const vr = schema.verifications;
    let query = supabase.from(vr.table).select('*');
    if (vr.createdAtCol) query = query.order(vr.createdAtCol, { ascending: false });
    const { data, error } = await query.limit(500);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];

    const userIds = Array.from(
      new Set(rows.map((r) => String(r[vr.userIdCol] ?? '')).filter(Boolean))
    );
    const userMap = new Map<string, AppUser>();
    if (schema.users && userIds.length > 0) {
      const u = schema.users;
      const { data: uRows } = await supabase.from(u.table).select('*').in(u.idCol, userIds);
      if (uRows) {
        for (const ur of uRows as Record<string, unknown>[]) {
          const norm = normalizeUser(ur, u);
          userMap.set(norm.id, norm);
        }
      }
    }

    for (const r of rows) {
      const uid = String(r[vr.userIdCol] ?? '');
      if (!uid || byUserId.has(uid)) continue; // Prevent duplicate user rows
      const user = userMap.get(uid);
      const rawStatus = String(r[vr.statusCol] ?? 'pending').toLowerCase();
      let status: VerificationState =
        rawStatus === 'verified' || rawStatus === 'approved'
          ? 'verified'
          : rawStatus === 'rejected'
          ? 'rejected'
          : rawStatus === 'revoked'
          ? 'revoked'
          : 'pending';

      // Keep in sync with user's authoritative verified flag if user is verified
      if (user?.isVerified) status = 'verified';

      byUserId.set(uid, {
        id: String(r[vr.idCol] ?? ''),
        userId: uid,
        userName: user?.name || '',
        userUsername: user?.username || '',
        userEmail: user?.email || '',
        userAvatarUrl: user?.avatarUrl || '',
        followersCount: user?.followersCount ?? 0,
        videoCount: user?.videoCount ?? 0,
        status,
        note: getStr(r, vr.noteCol),
        documentUrl: getStr(r, vr.documentUrlCol),
        createdAt: vr.createdAtCol ? (r[vr.createdAtCol] as string | null) ?? null : null,
        reviewedAt: vr.reviewedAtCol ? (r[vr.reviewedAtCol] as string | null) ?? null : null,
      });
    }
  }

  // 2. Merge verified / pending / rejected / revoked users directly from users table
  // Ensures any user verified from UsersPage or DB automatically appears in Verified Users!
  if (schema.users) {
    const u = schema.users;
    let uQuery = supabase.from(u.table).select('*').limit(500);
    if (u.verifiedCol && u.verificationStatusCol) {
      uQuery = uQuery.or(
        `${u.verifiedCol}.eq.true,${u.verificationStatusCol}.in.(pending,verified,rejected,revoked)`
      );
    } else if (u.verificationStatusCol) {
      uQuery = uQuery.in(u.verificationStatusCol, ['pending', 'verified', 'rejected', 'revoked']);
    } else if (u.verifiedCol) {
      uQuery = uQuery.eq(u.verifiedCol, true);
    }
    if (u.createdAtCol) uQuery = uQuery.order(u.createdAtCol, { ascending: false });

    const { data: uData } = await uQuery;
    if (uData) {
      for (const ur of uData as Record<string, unknown>[]) {
        const user = normalizeUser(ur, u);
        if (user.verificationStatus === 'unverified') continue;
        const existing = byUserId.get(user.id);
        if (existing) {
          if (user.isVerified) existing.status = 'verified';
          continue;
        }
        byUserId.set(user.id, {
          id: user.id,
          userId: user.id,
          userName: user.name,
          userUsername: user.username,
          userEmail: user.email,
          userAvatarUrl: user.avatarUrl,
          followersCount: user.followersCount,
          videoCount: user.videoCount,
          status: user.verificationStatus,
          note: '',
          documentUrl: '',
          createdAt: user.joinedAt,
          reviewedAt: null,
        });
      }
    }
  }

  const allRecords = Array.from(byUserId.values());
  if (statusFilter === 'all') return allRecords;
  return allRecords.filter((rec) => rec.status === statusFilter);
}

// ---------------------------------------------------------------------------
// COMMENTS
// ---------------------------------------------------------------------------

export async function fetchCommentsPage(
  schema: SchemaInspectionResult,
  page: number,
  pageSize: number,
  search: string
): Promise<{ comments: CommentRecord[]; total: number }> {
  const cm = schema.comments;
  if (!cm) return { comments: [], total: 0 };
  const supabase = getSupabaseClient();

  let query = supabase.from(cm.table).select('*', { count: 'exact' });
  const term = search.trim();
  if (term) {
    query = query.ilike(cm.contentCol, `%${term}%`);
  }
  if (cm.createdAtCol) query = query.order(cm.createdAtCol, { ascending: false });
  const from = (page - 1) * pageSize;
  query = query.range(from, from + pageSize - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];

  const userIds = Array.from(new Set(rows.map((r) => String(r[cm.userIdCol] ?? '')).filter(Boolean)));
  const videoIds = Array.from(new Set(rows.map((r) => String(r[cm.videoIdCol] ?? '')).filter(Boolean)));

  const userMap = new Map<string, AppUser>();
  if (schema.users && userIds.length > 0) {
    const u = schema.users;
    const { data: uRows } = await supabase.from(u.table).select('*').in(u.idCol, userIds);
    if (uRows) {
      for (const ur of uRows as Record<string, unknown>[]) {
        const norm = normalizeUser(ur, u);
        userMap.set(norm.id, norm);
      }
    }
  }

  const videoMap = new Map<string, { caption: string; thumb: string }>();
  if (schema.videos && videoIds.length > 0) {
    const v = schema.videos;
    const { data: vRows } = await supabase
      .from(v.table)
      .select([v.idCol, v.captionCol, v.thumbnailUrlCol].filter(Boolean).join(','))
      .in(v.idCol, videoIds);
    if (vRows) {
      for (const vr of vRows as unknown as Record<string, unknown>[]) {
        videoMap.set(String(vr[v.idCol]), {
          caption: getStr(vr, v.captionCol),
          thumb: getStr(vr, v.thumbnailUrlCol),
        });
      }
    }
  }

  return {
    comments: rows.map((r) => {
      const uid = String(r[cm.userIdCol] ?? '');
      const vid = String(r[cm.videoIdCol] ?? '');
      const u = userMap.get(uid);
      const v = videoMap.get(vid);
      return {
        id: String(r[cm.idCol] ?? ''),
        videoId: vid,
        videoCaption: v?.caption || '',
        videoThumbnailUrl: v?.thumb || '',
        userId: uid,
        userName: u?.name || '',
        userUsername: u?.username || '',
        userAvatarUrl: u?.avatarUrl || '',
        content: getStr(r, cm.contentCol),
        createdAt: cm.createdAtCol ? (r[cm.createdAtCol] as string | null) ?? null : null,
      };
    }),
    total: count ?? rows.length,
  };
}

export async function deleteComment(
  schema: SchemaInspectionResult,
  commentId: string
): Promise<void> {
  const cm = schema.comments;
  if (!cm) throw new Error('Comments table not detected.');
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(cm.table).delete().eq(cm.idCol, commentId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// REPORTS
// ---------------------------------------------------------------------------

export async function fetchReportsPage(
  schema: SchemaInspectionResult,
  statusFilter: string
): Promise<ReportRecord[]> {
  const rp = schema.reports;
  if (!rp) return [];
  const supabase = getSupabaseClient();

  let query = supabase.from(rp.table).select('*');
  if (statusFilter !== 'all' && rp.statusCol) {
    query = query.eq(rp.statusCol, statusFilter);
  }
  if (rp.createdAtCol) query = query.order(rp.createdAtCol, { ascending: false });
  const { data, error } = await query.limit(200);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Record<string, unknown>[];
  const userIds = new Set<string>();
  const videoIds = new Set<string>();
  for (const r of rows) {
    if (rp.reporterIdCol && r[rp.reporterIdCol]) userIds.add(String(r[rp.reporterIdCol]));
    if (rp.reportedUserIdCol && r[rp.reportedUserIdCol])
      userIds.add(String(r[rp.reportedUserIdCol]));
    if (rp.reportedVideoIdCol && r[rp.reportedVideoIdCol])
      videoIds.add(String(r[rp.reportedVideoIdCol]));
  }

  const userMap = new Map<string, AppUser>();
  if (schema.users && userIds.size > 0) {
    const u = schema.users;
    const { data: uRows } = await supabase
      .from(u.table)
      .select('*')
      .in(u.idCol, Array.from(userIds));
    if (uRows) {
      for (const ur of uRows as Record<string, unknown>[]) {
        const norm = normalizeUser(ur, u);
        userMap.set(norm.id, norm);
      }
    }
  }

  const videoMap = new Map<string, string>();
  if (schema.videos && videoIds.size > 0) {
    const v = schema.videos;
    const { data: vRows } = await supabase
      .from(v.table)
      .select([v.idCol, v.captionCol].filter(Boolean).join(','))
      .in(v.idCol, Array.from(videoIds));
    if (vRows) {
      for (const vr of vRows as unknown as Record<string, unknown>[]) {
        videoMap.set(String(vr[v.idCol]), getStr(vr, v.captionCol));
      }
    }
  }

  return rows.map((r) => {
    const repId = rp.reporterIdCol ? ((r[rp.reporterIdCol] as string | null) ?? null) : null;
    const targetUid = rp.reportedUserIdCol
      ? ((r[rp.reportedUserIdCol] as string | null) ?? null)
      : null;
    const targetVid = rp.reportedVideoIdCol
      ? ((r[rp.reportedVideoIdCol] as string | null) ?? null)
      : null;

    const rawStatus = (rp.statusCol ? String(r[rp.statusCol] ?? 'pending') : 'pending').toLowerCase();
    const status: ReportRecord['status'] =
      rawStatus === 'reviewing' || rawStatus === 'resolved' || rawStatus === 'rejected'
        ? rawStatus
        : 'pending';

    return {
      id: String(r[rp.idCol] ?? ''),
      reporterId: repId,
      reporterUsername: repId ? userMap.get(repId)?.username || userMap.get(repId)?.name || '' : '',
      reportedUserId: targetUid,
      reportedUsername: targetUid
        ? userMap.get(targetUid)?.username || userMap.get(targetUid)?.name || ''
        : '',
      reportedVideoId: targetVid,
      reportedVideoCaption: targetVid ? videoMap.get(targetVid) || '' : '',
      reason: getStr(r, rp.reasonCol),
      details: getStr(r, rp.detailsCol),
      status,
      createdAt: rp.createdAtCol ? (r[rp.createdAtCol] as string | null) ?? null : null,
      resolvedAt: rp.resolvedAtCol ? (r[rp.resolvedAtCol] as string | null) ?? null : null,
    };
  });
}

export async function updateReportStatus(
  schema: SchemaInspectionResult,
  reportId: string,
  status: ReportRecord['status']
): Promise<void> {
  const rp = schema.reports;
  if (!rp) throw new Error('Reports table not detected.');
  const supabase = getSupabaseClient();
  const payload: Record<string, unknown> = {};
  if (rp.statusCol) payload[rp.statusCol] = status;
  if (rp.resolvedAtCol && (status === 'resolved' || status === 'rejected')) {
    payload[rp.resolvedAtCol] = new Date().toISOString();
  }
  const { error } = await supabase.from(rp.table).update(payload).eq(rp.idCol, reportId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// ADMIN MANAGEMENT
// ---------------------------------------------------------------------------

export async function fetchBladeAdmins(): Promise<AdminRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('blade_admins')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    email: String(r.email ?? ''),
    username: String(r.username ?? ''),
    role: (r.role as AdminRecord['role']) || 'admin',
    isActive: Boolean(r.is_active),
    createdAt: (r.created_at as string | null) ?? null,
    lastSignInAt: null,
  }));
}

export async function addBladeAdmin(params: {
  email: string;
  username: string;
  role: AdminRecord['role'];
}): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('add_blade_admin_by_email', {
    p_email: params.email.trim(),
    p_username: params.username.trim(),
    p_role: params.role,
  });
  if (error) throw new Error(error.message);
}

export async function toggleBladeAdminActive(
  adminId: string,
  isActive: boolean,
  currentAdminUserId: string,
  targetUserId: string
): Promise<void> {
  if (!isActive && currentAdminUserId === targetUserId) {
    throw new Error('You cannot deactivate your own active administrator session.');
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('blade_admins')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', adminId);
  if (error) throw new Error(error.message);
}
