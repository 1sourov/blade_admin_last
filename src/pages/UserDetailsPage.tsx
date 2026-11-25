import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Eye,
  EyeOff,
  Film,
  Heart,
  MessageSquare,
  Play,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { Avatar } from '../components/ui/Avatar';
import {
  AccountStatusLabel,
  UserPresenceLabel,
  VerificationLabel,
  VideoStatusLabel,
  VisibilityLabel,
} from '../components/ui/StatusText';
import { useToast } from '../components/ui/ToastProvider';
import { VideoPlayerModal } from '../components/ui/VideoPlayerModal';
import {
  formatCompactNumber,
  formatDate,
  formatDateTime,
  isSafeHttpUrl,
} from '../lib/formatters';
import { getSupabaseClient } from '../lib/supabaseClient';
import {
  fetchLiveUserIds,
  fetchUserDetails,
  isUserHeartbeatOnline,
  subscribeOnlinePresence,
  updateUserAccountStatus,
  updateUserVerification,
  updateVideoRecord,
} from '../services/adminApi';
import type { AppUser, SchemaInspectionResult, VideoRecord, VideoStatus } from '../types/blade';

interface UserDetailsPageProps {
  schema: SchemaInspectionResult;
  userId: string;
  onBack: () => void;
  onUploadForUser: (user: AppUser) => void;
}

export function UserDetailsPage({
  schema,
  userId,
  onBack,
  onUploadForUser,
}: UserDetailsPageProps) {
  const { pushToast } = useToast();
  const [user, setUser] = useState<AppUser | null>(null);
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<VideoRecord | null>(null);
  const [presenceOnline, setPresenceOnline] = useState(false);
  const [dbLiveOnline, setDbLiveOnline] = useState(false);
  const [, setClockTick] = useState(0);

  const loadDetails = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [res, liveIds] = await Promise.all([
          fetchUserDetails(schema, userId),
          fetchLiveUserIds(schema).catch((): string[] => []),
        ]);
        setUser(res.user);
        setVideos(res.videos);
        const rawUid = typeof res.user.raw.user_id === 'string' ? res.user.raw.user_id : null;
        setDbLiveOnline(liveIds.includes(userId) || (rawUid ? liveIds.includes(rawUid) : false));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load user details.');
      } finally {
        setLoading(false);
      }
    },
    [schema, userId]
  );

  useEffect(() => {
    void loadDetails(false);
  }, [loadDetails]);

  useEffect(() => {
    const dataTimer = setInterval(() => {
      void loadDetails(true);
    }, 15_000);
    const clockTimer = setInterval(() => {
      setClockTick((t) => t + 1);
    }, 15_000);
    return () => {
      clearInterval(dataTimer);
      clearInterval(clockTimer);
    };
  }, [loadDetails]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    const channel = supabase.channel(`blade-user-detail-${userId}`);
    if (schema.users) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: schema.users.table },
        () => void loadDetails(true)
      );
    }
    if (schema.videos) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: schema.videos.table },
        () => void loadDetails(true)
      );
    }
    if (schema.presenceTable) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: schema.presenceTable },
        () => void loadDetails(true)
      );
    }
    channel.subscribe();

    const unsubPresence = subscribeOnlinePresence((ids) => {
      setPresenceOnline(ids.includes(userId));
    });

    return () => {
      void supabase.removeChannel(channel);
      unsubPresence();
    };
  }, [schema, userId, loadDetails]);

  const handleVideoStatus = async (video: VideoRecord, status: VideoStatus) => {
    try {
      await updateVideoRecord(schema, video.id, { status });
      setVideos((prev) =>
        prev.map((item) => (item.id === video.id ? { ...item, status } : item))
      );
      pushToast({
        title:
          status === 'hidden'
            ? 'Video hidden from public feed'
            : status === 'blocked'
            ? 'Video blocked'
            : 'Video restored to published',
        variant: 'success',
      });
      await loadDetails(true);
    } catch (err) {
      pushToast({
        title: 'Status update failed',
        description: err instanceof Error ? err.message : 'Failed to update video.',
        variant: 'error',
      });
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-950"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Users
        </button>
        <div className="h-44 bg-zinc-100 rounded-lg animate-pulse" />
        <div className="h-64 bg-zinc-100 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-950"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Users
        </button>
        <div className="p-5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error || 'User not found.'}
        </div>
      </div>
    );
  }

  const onlineCol = schema.users?.onlineCol ?? null;
  const rawOnline = onlineCol ? (user.raw[onlineCol] as boolean | null | undefined) : undefined;
  const isOnlineNow =
    presenceOnline || dbLiveOnline || isUserHeartbeatOnline(user.lastActiveAt, rawOnline);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-950"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Users
        </button>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onUploadForUser(user)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors whitespace-nowrap"
          >
            Upload Video as User
          </button>

          <button
            type="button"
            onClick={async () => {
              try {
                await updateUserVerification(
                  schema,
                  user.id,
                  user.isVerified ? 'revoked' : 'verified'
                );
                pushToast({
                  title: user.isVerified ? 'Verification revoked' : 'User verified',
                  variant: 'success',
                });
                await loadDetails(true);
              } catch (err) {
                pushToast({
                  title: 'Verification update failed',
                  description: err instanceof Error ? err.message : 'Operation failed.',
                  variant: 'error',
                });
              }
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-zinc-300 bg-white hover:bg-zinc-50 rounded-md transition-colors whitespace-nowrap"
          >
            <BadgeCheck className="w-3.5 h-3.5 text-red-600" />
            {user.isVerified ? 'Revoke Verification' : 'Verify User'}
          </button>

          {user.accountStatus === 'blocked' || user.accountStatus === 'suspended' ? (
            <button
              type="button"
              onClick={async () => {
                try {
                  await updateUserAccountStatus(schema, user.id, 'active');
                  pushToast({
                    title:
                      user.accountStatus === 'blocked' ? 'User unblocked' : 'User account restored',
                    variant: 'success',
                  });
                  await loadDetails(true);
                } catch (err) {
                  pushToast({
                    title: 'Restore failed',
                    description: err instanceof Error ? err.message : 'Operation failed.',
                    variant: 'error',
                  });
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {user.accountStatus === 'blocked' ? 'Unblock User' : 'Restore Account'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await updateUserAccountStatus(schema, user.id, 'suspended');
                    pushToast({ title: 'User suspended', variant: 'success' });
                    await loadDetails(true);
                  } catch (err) {
                    pushToast({
                      title: 'Suspend failed',
                      description: err instanceof Error ? err.message : 'Operation failed.',
                      variant: 'error',
                    });
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-md transition-colors whitespace-nowrap"
              >
                <ShieldAlert className="w-3.5 h-3.5" /> Suspend
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await updateUserAccountStatus(schema, user.id, 'blocked');
                    pushToast({ title: 'User blocked', variant: 'success' });
                    await loadDetails(true);
                  } catch (err) {
                    pushToast({
                      title: 'Block failed',
                      description: err instanceof Error ? err.message : 'Operation failed.',
                      variant: 'error',
                    });
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-zinc-950 hover:bg-zinc-800 rounded-md transition-colors whitespace-nowrap"
              >
                <Ban className="w-3.5 h-3.5" /> Block User
              </button>
            </>
          )}
        </div>
      </div>

      {/* Profile Header Card */}
      <div className="bg-white border border-zinc-200 rounded-lg p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <Avatar src={user.avatarUrl} name={user.name || user.username} size="lg" />
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-display text-2xl font-bold text-zinc-950">
                  {user.name || 'Unnamed User'}
                </h1>
                <UserPresenceLabel isOnline={isOnlineNow} />
                <VerificationLabel state={user.verificationStatus} />
                <AccountStatusLabel status={user.accountStatus} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 mt-1">
                <span className="font-mono text-zinc-700">
                  {user.username ? `@${user.username}` : 'No username'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{user.email || 'No email'}</span>
                <span aria-hidden="true">·</span>
                <span>{user.phone || 'No phone'}</span>
              </div>
              <div className="text-[11px] font-mono text-zinc-500 mt-1 select-all">
                ID: {user.id}
              </div>
              {user.bio && <p className="text-sm text-zinc-700 mt-3 max-w-2xl">{user.bio}</p>}
            </div>
          </div>

          <div className="text-xs text-zinc-500 space-y-1 shrink-0">
            <div>
              Registered: <span className="text-zinc-900 font-medium">{formatDate(user.joinedAt)}</span>
            </div>
            <div>
              Last Activity:{' '}
              <span className="text-zinc-900 font-medium">{formatDateTime(user.lastActiveAt)}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mt-6 pt-6 border-t border-zinc-200">
          <div>
            <div className="text-xs text-zinc-500">Followers</div>
            <div className="text-xl font-bold text-zinc-950 tabular-nums mt-0.5">
              {formatCompactNumber(user.followersCount)}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Following</div>
            <div className="text-xl font-bold text-zinc-950 tabular-nums mt-0.5">
              {formatCompactNumber(user.followingCount)}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Total Videos</div>
            <div className="text-xl font-bold text-zinc-950 tabular-nums mt-0.5">
              {formatCompactNumber(videos.length)}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Total Views</div>
            <div className="text-xl font-bold text-zinc-950 tabular-nums mt-0.5">
              {formatCompactNumber(user.totalViews)}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Total Likes</div>
            <div className="text-xl font-bold text-zinc-950 tabular-nums mt-0.5">
              {formatCompactNumber(user.totalLikes)}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Total Comments</div>
            <div className="text-xl font-bold text-zinc-950 tabular-nums mt-0.5">
              {formatCompactNumber(user.totalComments)}
            </div>
          </div>
        </div>
      </div>

      {/* USER'S VIDEOS */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-bold text-zinc-950">USER&apos;S VIDEOS</h2>
            <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
              {videos.length} videos owned by {user.username ? `@${user.username}` : user.id} ·
              Moderation uses non-destructive Hide &amp; Block controls.
            </p>
          </div>
        </div>

        {videos.length === 0 ? (
          <div className="py-14 px-6 text-center">
            <Film className="w-8 h-8 text-zinc-300 mx-auto" />
            <p className="text-sm font-semibold text-zinc-950 mt-3">No videos uploaded yet</p>
            <p className="text-xs text-zinc-500 mt-1">
              Videos uploaded by this user in the Android app or assigned via Upload Video will
              appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                  <th className="py-3 px-4">Video</th>
                  <th className="py-3 px-4">Caption</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Visibility</th>
                  <th className="py-3 px-4 text-right">Views</th>
                  <th className="py-3 px-4 text-right">Likes</th>
                  <th className="py-3 px-4 text-right">Comments</th>
                  <th className="py-3 px-4">Uploaded</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-sm">
                {videos.map((v) => {
                  const thumb = isSafeHttpUrl(v.thumbnailUrl);
                  return (
                    <tr key={v.id} className="hover:bg-zinc-50">
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => setPreviewVideo(v)}
                          className="w-12 h-16 rounded bg-zinc-950 overflow-hidden relative flex items-center justify-center border border-zinc-200 group"
                        >
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={v.caption || 'Video thumbnail'}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Film className="w-4 h-4 text-zinc-500" />
                          )}
                          <span className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Play className="w-4 h-4 text-white fill-white" />
                          </span>
                        </button>
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <div className="font-medium text-zinc-950 truncate">
                          {v.caption || 'Untitled video'}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-400 truncate">{v.id}</div>
                      </td>
                      <td className="py-3 px-4">
                        <VideoStatusLabel status={v.status} />
                      </td>
                      <td className="py-3 px-4">
                        <VisibilityLabel visibility={v.visibility} />
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Eye className="w-3 h-3 text-zinc-400" />
                          {formatCompactNumber(v.viewsCount)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Heart className="w-3 h-3 text-zinc-400" />
                          {formatCompactNumber(v.likesCount)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-xs">
                        <span className="inline-flex items-center gap-1">
                          <MessageSquare className="w-3 h-3 text-zinc-400" />
                          {formatCompactNumber(v.commentsCount)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-600 whitespace-nowrap tabular-nums">
                        {formatDate(v.createdAt)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewVideo(v)}
                            className="px-2 py-1 text-xs font-medium text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 rounded whitespace-nowrap"
                          >
                            Watch
                          </button>

                          {v.status === 'hidden' ? (
                            <button
                              type="button"
                              onClick={() => void handleVideoStatus(v, 'published')}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded whitespace-nowrap"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Unhide
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleVideoStatus(v, 'hidden')}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 rounded whitespace-nowrap"
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                              Hide
                            </button>
                          )}

                          {v.status === 'blocked' ? (
                            <button
                              type="button"
                              onClick={() => void handleVideoStatus(v, 'published')}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded whitespace-nowrap"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Unblock
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleVideoStatus(v, 'blocked')}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded whitespace-nowrap"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              Block
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

      <VideoPlayerModal video={previewVideo} onClose={() => setPreviewVideo(null)} />
    </div>
  );
}
