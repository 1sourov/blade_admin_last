import type {
  CategoryTableMapping,
  CommentTableMapping,
  InspectedTable,
  ReportTableMapping,
  SchemaInspectionResult,
  TableColumnInfo,
  UserTableMapping,
  VerificationTableMapping,
  VideoTableMapping,
} from '../types/blade';
import { getActiveSupabaseConfig, getSupabaseClient } from './supabaseClient';

interface OpenApiDefinition {
  properties?: Record<
    string,
    {
      type?: string;
      format?: string;
      description?: string;
    }
  >;
  required?: string[];
}

interface OpenApiSpec {
  paths?: Record<string, unknown>;
  definitions?: Record<string, OpenApiDefinition>;
}

const CANDIDATE_TABLES = [
  'blade_admins',
  'profiles',
  'users',
  'user_profiles',
  'accounts',
  'creators',
  'videos',
  'posts',
  'reels',
  'shorts',
  'clips',
  'categories',
  'video_categories',
  'topics',
  'comments',
  'video_comments',
  'post_comments',
  'reports',
  'video_reports',
  'content_reports',
  'abuse_reports',
  'verification_requests',
  'verifications',
  'user_verifications',
  'creator_verifications',
  'likes',
  'video_likes',
  'post_likes',
  'followers',
  'follows',
  'user_follows',
  'subscriptions',
  'notifications',
  'user_notifications',
  'user_presence',
  'active_users',
  'user_sessions',
  'online_users',
  'presence',
  'messages',
  'chat_messages',
  'direct_messages',
  'chats',
  'conversations',
];

function findCol(cols: Record<string, TableColumnInfo>, candidates: string[]): string | null {
  const keys = Object.keys(cols);
  for (const cand of candidates) {
    const exact = keys.find((k) => k.toLowerCase() === cand.toLowerCase());
    if (exact) return exact;
  }
  return null;
}

function findTable(
  tables: Record<string, InspectedTable>,
  candidates: string[]
): InspectedTable | null {
  const names = Object.keys(tables);
  for (const cand of candidates) {
    const exact = names.find((n) => n.toLowerCase() === cand.toLowerCase());
    if (exact) return tables[exact];
  }
  return null;
}

function defaultColumnsForTable(tableName: string): Record<string, TableColumnInfo> {
  const col = (name: string, type = 'text'): TableColumnInfo => ({ name, type });
  if (['profiles', 'users', 'user_profiles', 'accounts', 'creators'].includes(tableName)) {
    return {
      id: col('id', 'uuid'),
      full_name: col('full_name'),
      username: col('username'),
      email: col('email'),
      phone: col('phone'),
      avatar_url: col('avatar_url'),
      bio: col('bio'),
      is_verified: col('is_verified', 'boolean'),
      verification_status: col('verification_status'),
      status: col('status'),
      followers_count: col('followers_count', 'integer'),
      following_count: col('following_count', 'integer'),
      videos_count: col('videos_count', 'integer'),
      total_views: col('total_views', 'integer'),
      created_at: col('created_at', 'timestamp'),
      last_active_at: col('last_active_at', 'timestamp'),
      is_online: col('is_online', 'boolean'),
      is_blocked: col('is_blocked', 'boolean'),
    };
  }
  if (['videos', 'posts', 'reels', 'shorts', 'clips'].includes(tableName)) {
    return {
      id: col('id', 'uuid'),
      user_id: col('user_id', 'uuid'),
      video_url: col('video_url'),
      storage_path: col('storage_path'),
      thumbnail_url: col('thumbnail_url'),
      thumbnail_path: col('thumbnail_path'),
      caption: col('caption'),
      description: col('description'),
      hashtags: col('hashtags', 'array'),
      category_id: col('category_id', 'uuid'),
      category: col('category'),
      status: col('status'),
      is_hidden: col('is_hidden', 'boolean'),
      is_blocked: col('is_blocked', 'boolean'),
      visibility: col('visibility'),
      views_count: col('views_count', 'integer'),
      likes_count: col('likes_count', 'integer'),
      comments_count: col('comments_count', 'integer'),
      duration_seconds: col('duration_seconds', 'integer'),
      created_at: col('created_at', 'timestamp'),
    };
  }
  if (['categories', 'video_categories', 'topics'].includes(tableName)) {
    return {
      id: col('id', 'uuid'),
      name: col('name'),
      slug: col('slug'),
      description: col('description'),
      is_enabled: col('is_enabled', 'boolean'),
      sort_order: col('sort_order', 'integer'),
      created_at: col('created_at', 'timestamp'),
    };
  }
  if (['comments', 'video_comments', 'post_comments'].includes(tableName)) {
    return {
      id: col('id', 'uuid'),
      video_id: col('video_id', 'uuid'),
      user_id: col('user_id', 'uuid'),
      content: col('content'),
      created_at: col('created_at', 'timestamp'),
    };
  }
  if (['reports', 'video_reports', 'content_reports', 'abuse_reports'].includes(tableName)) {
    return {
      id: col('id', 'uuid'),
      reporter_id: col('reporter_id', 'uuid'),
      reported_user_id: col('reported_user_id', 'uuid'),
      reported_video_id: col('reported_video_id', 'uuid'),
      reason: col('reason'),
      details: col('details'),
      status: col('status'),
      created_at: col('created_at', 'timestamp'),
      resolved_at: col('resolved_at', 'timestamp'),
    };
  }
  if (
    ['verification_requests', 'verifications', 'user_verifications', 'creator_verifications'].includes(
      tableName
    )
  ) {
    return {
      id: col('id', 'uuid'),
      user_id: col('user_id', 'uuid'),
      status: col('status'),
      note: col('note'),
      document_url: col('document_url'),
      created_at: col('created_at', 'timestamp'),
      reviewed_at: col('reviewed_at', 'timestamp'),
    };
  }
  return { id: col('id', 'uuid'), created_at: col('created_at', 'timestamp') };
}

function detectUsersMapping(tables: Record<string, InspectedTable>): UserTableMapping | null {
  const t = findTable(tables, ['profiles', 'users', 'user_profiles', 'accounts', 'creators']);
  if (!t) return null;
  const c = t.columns;
  const idCol = findCol(c, ['id', 'user_id', 'uid', 'profile_id']) ?? 'id';
  return {
    table: t.name,
    idCol,
    nameCol: findCol(c, ['full_name', 'display_name', 'name', 'nickname']),
    usernameCol: findCol(c, ['username', 'handle', 'user_name', 'screen_name']),
    emailCol: findCol(c, ['email', 'email_address']),
    phoneCol: findCol(c, ['phone', 'phone_number', 'mobile']),
    avatarCol: findCol(c, ['avatar_url', 'profile_image', 'photo_url', 'avatar', 'image_url']),
    bioCol: findCol(c, ['bio', 'about', 'description']),
    verifiedCol: findCol(c, ['is_verified', 'verified', 'blue_tick']),
    verificationStatusCol: findCol(c, ['verification_status', 'verify_status']),
    statusCol: findCol(c, ['status', 'account_status', 'state']),
    blockedCol: findCol(c, ['is_blocked', 'blocked', 'is_banned', 'banned']),
    suspendedCol: findCol(c, ['is_suspended', 'suspended']),
    followersCountCol: findCol(c, ['followers_count', 'follower_count', 'followers']),
    followingCountCol: findCol(c, ['following_count', 'followings_count', 'following']),
    videosCountCol: findCol(c, ['videos_count', 'video_count', 'posts_count']),
    viewsCountCol: findCol(c, ['total_views', 'views_count', 'view_count']),
    createdAtCol: findCol(c, ['created_at', 'joined_at', 'registered_at']),
    lastActiveCol: findCol(c, [
      'last_active_at',
      'last_seen_at',
      'last_heartbeat_at',
      'last_online_at',
      'last_activity_at',
      'last_seen',
      'last_active',
      'seen_at',
      'online_at',
      'last_login_at',
      'updated_at',
    ]),
    onlineCol: findCol(c, ['is_online', 'online', 'is_active_now', 'online_status']),
  };
}

function detectVideosMapping(tables: Record<string, InspectedTable>): VideoTableMapping | null {
  const t = findTable(tables, ['videos', 'posts', 'reels', 'shorts', 'clips']);
  if (!t) return null;
  const c = t.columns;
  return {
    table: t.name,
    idCol: findCol(c, ['id', 'video_id', 'post_id']) ?? 'id',
    ownerIdCol:
      findCol(c, ['user_id', 'owner_id', 'author_id', 'creator_id', 'profile_id', 'uploader_id']) ??
      'user_id',
    videoUrlCol: findCol(c, ['video_url', 'media_url', 'url', 'stream_url', 'file_url']),
    storagePathCol: findCol(c, ['storage_path', 'video_path', 'file_path', 'path']),
    thumbnailUrlCol: findCol(c, ['thumbnail_url', 'thumb_url', 'cover_url', 'poster_url', 'thumbnail']),
    thumbnailPathCol: findCol(c, ['thumbnail_path', 'thumb_path', 'cover_path']),
    captionCol: findCol(c, ['caption', 'title', 'text', 'headline']),
    descriptionCol: findCol(c, ['description', 'details', 'body', 'summary']),
    hashtagsCol: findCol(c, ['hashtags', 'tags']),
    categoryIdCol: findCol(c, ['category_id', 'cat_id']),
    categoryNameCol: findCol(c, ['category', 'category_name']),
    statusCol: findCol(c, ['status', 'moderation_status', 'state']),
    isHiddenCol: findCol(c, ['is_hidden', 'hidden']),
    isBlockedCol: findCol(c, ['is_blocked', 'blocked']),
    visibilityCol: findCol(c, ['visibility', 'privacy', 'access_level']),
    viewsCol: findCol(c, ['views_count', 'view_count', 'views', 'plays_count']),
    likesCol: findCol(c, ['likes_count', 'like_count', 'likes']),
    commentsCol: findCol(c, ['comments_count', 'comment_count', 'comments']),
    durationCol: findCol(c, ['duration', 'duration_seconds', 'length']),
    createdAtCol: findCol(c, ['created_at', 'uploaded_at', 'published_at']),
  };
}

function detectCategoriesMapping(
  tables: Record<string, InspectedTable>
): CategoryTableMapping | null {
  const t = findTable(tables, ['categories', 'video_categories', 'topics']);
  if (!t) return null;
  const c = t.columns;
  return {
    table: t.name,
    idCol: findCol(c, ['id', 'category_id']) ?? 'id',
    nameCol: findCol(c, ['name', 'title', 'label']) ?? 'name',
    slugCol: findCol(c, ['slug', 'key']),
    descriptionCol: findCol(c, ['description', 'summary']),
    enabledCol: findCol(c, ['is_enabled', 'enabled', 'is_active', 'active']),
    sortOrderCol: findCol(c, ['sort_order', 'display_order', 'position']),
    createdAtCol: findCol(c, ['created_at']),
  };
}

function detectCommentsMapping(tables: Record<string, InspectedTable>): CommentTableMapping | null {
  const t = findTable(tables, ['comments', 'video_comments', 'post_comments']);
  if (!t) return null;
  const c = t.columns;
  return {
    table: t.name,
    idCol: findCol(c, ['id', 'comment_id']) ?? 'id',
    videoIdCol: findCol(c, ['video_id', 'post_id', 'reel_id']) ?? 'video_id',
    userIdCol: findCol(c, ['user_id', 'author_id', 'profile_id']) ?? 'user_id',
    contentCol: findCol(c, ['content', 'text', 'body', 'comment', 'message']) ?? 'content',
    createdAtCol: findCol(c, ['created_at', 'posted_at']),
  };
}

function detectReportsMapping(tables: Record<string, InspectedTable>): ReportTableMapping | null {
  const t = findTable(tables, ['reports', 'video_reports', 'content_reports', 'abuse_reports']);
  if (!t) return null;
  const c = t.columns;
  return {
    table: t.name,
    idCol: findCol(c, ['id', 'report_id']) ?? 'id',
    reporterIdCol: findCol(c, ['reporter_id', 'user_id', 'reported_by']),
    reportedUserIdCol: findCol(c, ['reported_user_id', 'target_user_id', 'offender_id']),
    reportedVideoIdCol: findCol(c, ['reported_video_id', 'video_id', 'post_id', 'target_video_id']),
    reasonCol: findCol(c, ['reason', 'category', 'report_reason', 'type']),
    detailsCol: findCol(c, ['details', 'description', 'note', 'comment']),
    statusCol: findCol(c, ['status', 'state']),
    createdAtCol: findCol(c, ['created_at', 'reported_at']),
    resolvedAtCol: findCol(c, ['resolved_at', 'reviewed_at', 'updated_at']),
  };
}

function detectVerificationsMapping(
  tables: Record<string, InspectedTable>
): VerificationTableMapping | null {
  const t = findTable(tables, [
    'verification_requests',
    'verifications',
    'user_verifications',
    'creator_verifications',
  ]);
  if (!t) return null;
  const c = t.columns;
  return {
    table: t.name,
    idCol: findCol(c, ['id', 'request_id']) ?? 'id',
    userIdCol: findCol(c, ['user_id', 'profile_id', 'applicant_id']) ?? 'user_id',
    statusCol: findCol(c, ['status', 'state', 'verification_status']) ?? 'status',
    noteCol: findCol(c, ['note', 'reason', 'admin_note', 'remarks']),
    documentUrlCol: findCol(c, ['document_url', 'id_url', 'proof_url']),
    createdAtCol: findCol(c, ['created_at', 'requested_at']),
    reviewedAtCol: findCol(c, ['reviewed_at', 'updated_at']),
  };
}

function buildResult(
  rawTables: Record<string, InspectedTable>,
  rawRpcs: string[],
  migrationVersion?: number
): SchemaInspectionResult {
  const users = detectUsersMapping(rawTables);
  const videos = detectVideosMapping(rawTables);
  const categories = detectCategoriesMapping(rawTables);
  const comments = detectCommentsMapping(rawTables);
  const reports = detectReportsMapping(rawTables);
  const verifications = detectVerificationsMapping(rawTables);

  const likesTable = findTable(rawTables, ['likes', 'video_likes', 'post_likes'])?.name ?? null;
  const followersTable =
    findTable(rawTables, ['followers', 'follows', 'user_follows', 'subscriptions'])?.name ?? null;
  const notificationsTable =
    findTable(rawTables, ['notifications', 'user_notifications'])?.name ?? null;
  const presenceTable =
    findTable(rawTables, [
      'user_presence',
      'active_users',
      'user_sessions',
      'online_users',
      'presence',
    ])?.name ?? null;

  const hasAdminTable = Boolean(rawTables['blade_admins']);
  const hasSetupStatusRpc = rawRpcs.includes('check_admin_setup_status');
  const hasBootstrapRpc = rawRpcs.includes('bootstrap_first_admin');
  const hasStorageStatsRpc = rawRpcs.includes('get_blade_storage_stats');
  const hasActivityStatsRpc = rawRpcs.includes('get_blade_activity_stats');
  const hasVideoModerationRpc = rawRpcs.includes('admin_set_video_moderation');
  const hasUserStatusRpc = rawRpcs.includes('admin_set_user_status');
  const hasCreateUserRpc = rawRpcs.includes('admin_create_user');
  const hasWatchSessionRpc = rawRpcs.includes('start_video_watch_session');
  const hasUnblockedCheckRpc = rawRpcs.includes('is_current_user_active_unblocked');
  const hasMigrationLatest =
    rawRpcs.includes('get_blade_migration_version') && (migrationVersion ?? 0) >= 6;

  const missingCapabilities: string[] = [];
  if (!hasAdminTable || !hasSetupStatusRpc || !hasBootstrapRpc) {
    missingCapabilities.push('Admin Authorization & First-Time Setup RPCs (blade_admins)');
  }
  if (!users) {
    missingCapabilities.push('Users / Profiles table (profiles or users)');
  } else {
    if (!users.statusCol && !users.blockedCol) missingCapabilities.push(`${users.table}.status`);
    if (!users.verifiedCol && !users.verificationStatusCol)
      missingCapabilities.push(`${users.table}.is_verified`);
    if (!users.lastActiveCol || !hasActivityStatsRpc || !hasWatchSessionRpc)
      missingCapabilities.push('Live Video Watching & Heartbeat RPCs (get_blade_activity_stats, start_video_watch_session)');
    if (!users.blockedCol || !hasUserStatusRpc || !hasUnblockedCheckRpc)
      missingCapabilities.push('User Block RLS & Moderation RPC (admin_set_user_status)');
    if (!hasCreateUserRpc)
      missingCapabilities.push('Admin Create User RPC (admin_create_user)');
  }
  if (!videos) {
    missingCapabilities.push('Videos table (videos)');
  } else {
    if (!videos.statusCol) missingCapabilities.push(`${videos.table}.status`);
    if (!videos.isHiddenCol || !videos.isBlockedCol || !hasVideoModerationRpc)
      missingCapabilities.push('Video Hide/Block RLS & Moderation RPC (admin_set_video_moderation)');
    if (!videos.visibilityCol) missingCapabilities.push(`${videos.table}.visibility`);
  }
  if (!categories) {
    missingCapabilities.push('Categories table (categories)');
  }
  if (!hasStorageStatsRpc) {
    missingCapabilities.push('Storage usage stats RPC (get_blade_storage_stats)');
  }
  if (!hasMigrationLatest) {
    missingCapabilities.push(
      'App-Entry Live Presence & Auth Session Detection v6 (get_blade_migration_version)'
    );
  }

  return {
    inspectedAt: new Date().toISOString(),
    rawTables,
    rawRpcs,
    hasAdminTable,
    hasSetupStatusRpc,
    hasBootstrapRpc,
    hasStorageStatsRpc,
    users,
    videos,
    categories,
    comments,
    reports,
    verifications,
    likesTable,
    followersTable,
    notificationsTable,
    presenceTable,
    migrationVersion,
    missingCapabilities,
  };
}

async function fetchMigrationVersion(
  url: string,
  publishableKey: string,
  authToken?: string
): Promise<number | undefined> {
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_blade_migration_version`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${authToken ?? publishableKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) return undefined;
    const val = (await res.json().catch(() => null)) as unknown;
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) {
      return Number(val);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Verifies URL + Publishable Key against Supabase Auth settings endpoint
 * (never requires a secret key).
 */
async function verifyPublishableKeyConnection(
  url: string,
  publishableKey: string
): Promise<void> {
  const res = await fetch(`${url}/auth/v1/settings`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Invalid Supabase Publishable Key (${res.status}): ${body || 'Authentication rejected by Supabase.'}`
      );
    }
    throw new Error(`Supabase connection check failed (${res.status}): ${body || res.statusText}`);
  }
}

/**
 * Fallback schema inspection that works cleanly with new `sb_publishable_*` keys
 * where Supabase's API gateway blocks root `/rest/v1/` OpenAPI listing.
 */
async function inspectViaPublishableSafeProbing(
  url: string,
  publishableKey: string,
  authToken?: string
): Promise<SchemaInspectionResult> {
  const supabase = getSupabaseClient();
  const rawTables: Record<string, InspectedTable> = {};
  const rawRpcs: string[] = [];

  // 1. If authenticated as admin and inspect_blade_schema RPC is installed, use exact DB introspection
  if (authToken) {
    const [{ data: rpcSchema, error: rpcSchemaErr }, migrationVersion] = await Promise.all([
      supabase.rpc('inspect_blade_schema'),
      fetchMigrationVersion(url, publishableKey, authToken),
    ]);
    if (!rpcSchemaErr && rpcSchema && typeof rpcSchema === 'object') {
      const parsed = rpcSchema as {
        tables?: Record<string, Array<{ name: string; type: string }>>;
        rpcs?: string[];
      };
      if (parsed.tables) {
        for (const [tName, colArr] of Object.entries(parsed.tables)) {
          const cols: Record<string, TableColumnInfo> = {};
          for (const c of colArr) {
            cols[c.name] = { name: c.name, type: c.type };
          }
          rawTables[tName] = { name: tName, columns: cols };
        }
        return buildResult(rawTables, parsed.rpcs ?? [], migrationVersion);
      }
    }
  }

  // 2. Verify URL + Publishable Key first via Auth settings
  await verifyPublishableKeyConnection(url, publishableKey);

  const headers: Record<string, string> = {
    apikey: publishableKey,
    Authorization: `Bearer ${authToken ?? publishableKey}`,
  };

  // 3. Probe candidate tables in parallel using standard PostgREST GET ?limit=1
  await Promise.all(
    CANDIDATE_TABLES.map(async (tableName) => {
      try {
        const res = await fetch(`${url}/rest/v1/${tableName}?select=*&limit=1`, { headers });
        if (res.ok) {
          const rows = (await res.json().catch(() => [])) as Record<string, unknown>[];
          if (Array.isArray(rows) && rows.length > 0 && rows[0]) {
            const defaults = defaultColumnsForTable(tableName);
            const cols: Record<string, TableColumnInfo> = {};
            for (const [k, val] of Object.entries(rows[0])) {
              let inferredType: string;
              if (typeof val === 'boolean') inferredType = 'boolean';
              else if (typeof val === 'number') inferredType = 'number';
              else if (Array.isArray(val)) inferredType = 'array';
              else if (val === null && defaults[k]?.type) inferredType = defaults[k].type;
              else inferredType = 'text';
              cols[k] = {
                name: k,
                type: inferredType,
              };
            }
            rawTables[tableName] = { name: tableName, columns: cols };
          } else {
            // Table exists (200 OK with empty array)
            rawTables[tableName] = {
              name: tableName,
              columns: defaultColumnsForTable(tableName),
            };
          }
          return;
        }

        const errBody = await res.text().catch(() => '');
        // PGRST205 = table does not exist in schema cache
        if (res.status === 404 || errBody.includes('PGRST205') || errBody.includes('42P01')) {
          return;
        }
        // 401 / 403 PostgreSQL RLS permission denied (42501) means the table DOES exist!
        if (
          res.status === 401 ||
          res.status === 403 ||
          errBody.includes('42501') ||
          errBody.toLowerCase().includes('permission denied')
        ) {
          if (!errBody.toLowerCase().includes('invalid api key')) {
            rawTables[tableName] = {
              name: tableName,
              columns: defaultColumnsForTable(tableName),
            };
          }
        }
      } catch {
        // Ignore network/abort for individual probe
      }
    })
  );

  // 4. Probe Blade RPCs
  const rpcProbes: Array<{ name: string; body: Record<string, unknown> }> = [
    { name: 'check_admin_setup_status', body: {} },
    { name: 'bootstrap_first_admin', body: { p_username: '' } },
    { name: 'get_blade_storage_stats', body: {} },
    { name: 'get_blade_activity_stats', body: {} },
    { name: 'user_heartbeat', body: { p_is_online: true } },
    { name: 'start_video_watch_session', body: { p_video_id: '00000000-0000-0000-0000-000000000000' } },
    { name: 'stop_video_watch_session', body: { p_video_id: '00000000-0000-0000-0000-000000000000' } },
    { name: 'admin_create_user', body: { p_full_name: '', p_email: '', p_phone: '' } },
    { name: 'admin_set_video_moderation', body: { p_video_id: '00000000-0000-0000-0000-000000000000', p_status: 'published' } },
    { name: 'admin_set_user_status', body: { p_user_id: '00000000-0000-0000-0000-000000000000', p_status: 'active' } },
    { name: 'is_current_user_active_unblocked', body: {} },
    { name: 'is_video_publicly_visible', body: { p_row: {} } },
    { name: 'get_blade_migration_version', body: {} },
    { name: 'inspect_blade_schema', body: {} },
  ];

  let probedMigrationVersion: number | undefined;
  await Promise.all(
    rpcProbes.map(async (rpc) => {
      try {
        const res = await fetch(`${url}/rest/v1/rpc/${rpc.name}`, {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(rpc.body),
        });
        const txt = await res.text().catch(() => '');
        // PGRST202 / 42883 means function does not exist
        if (
          res.status !== 404 &&
          !txt.includes('PGRST202') &&
          !txt.includes('42883') &&
          !txt.toLowerCase().includes('could not find the function')
        ) {
          rawRpcs.push(rpc.name);
          if (rpc.name === 'get_blade_migration_version' && res.ok) {
            const num = Number(txt.trim());
            if (Number.isFinite(num)) probedMigrationVersion = num;
          }
        }
      } catch {
        // Ignore
      }
    })
  );

  return buildResult(rawTables, rawRpcs, probedMigrationVersion);
}

export async function inspectSupabaseSchema(): Promise<SchemaInspectionResult> {
  const config = getActiveSupabaseConfig();
  if (!config) {
    throw new Error('Supabase URL and Publishable Key are required.');
  }

  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: Record<string, string> = {
    apikey: config.publishableKey,
    Authorization: `Bearer ${session?.access_token ?? config.publishableKey}`,
    Accept: 'application/openapi+json',
  };

  const response = await fetch(`${config.url}/rest/v1/`, { headers });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    const lower = errText.toLowerCase();

    // Newer Supabase projects with `sb_publishable_*` keys block root `/rest/v1/` OpenAPI
    // introspection with 401 "Secret API key required". Fall back to publishable-safe probing.
    if (
      (response.status === 401 || response.status === 403) &&
      (lower.includes('secret api key') ||
        lower.includes('secret key') ||
        lower.includes('only secret'))
    ) {
      return inspectViaPublishableSafeProbing(
        config.url,
        config.publishableKey,
        session?.access_token
      );
    }

    // Even if `/rest/v1/` returns 401/403 for any other gateway restriction when using a
    // publishable key, try publishable-safe probing (which still rejects invalid keys).
    if (response.status === 401 || response.status === 403) {
      return inspectViaPublishableSafeProbing(
        config.url,
        config.publishableKey,
        session?.access_token
      );
    }

    throw new Error(
      `Failed to inspect Supabase schema (${response.status}): ${errText || response.statusText}`
    );
  }

  const spec = (await response.json()) as OpenApiSpec;
  const rawTables: Record<string, InspectedTable> = {};
  const rawRpcs: string[] = [];

  if (spec.definitions) {
    for (const [tableName, def] of Object.entries(spec.definitions)) {
      const cols: Record<string, TableColumnInfo> = {};
      const requiredSet = new Set(def.required ?? []);
      if (def.properties) {
        for (const [colName, colMeta] of Object.entries(def.properties)) {
          cols[colName] = {
            name: colName,
            type: colMeta.type ?? 'unknown',
            format: colMeta.format,
            required: requiredSet.has(colName),
          };
        }
      }
      rawTables[tableName] = { name: tableName, columns: cols };
    }
  }

  if (spec.paths) {
    for (const p of Object.keys(spec.paths)) {
      if (p.startsWith('/rpc/')) {
        rawRpcs.push(p.replace('/rpc/', ''));
      }
    }
  }

  const migrationVersion = rawRpcs.includes('get_blade_migration_version')
    ? await fetchMigrationVersion(config.url, config.publishableKey, session?.access_token)
    : undefined;

  return buildResult(rawTables, rawRpcs, migrationVersion);
}
