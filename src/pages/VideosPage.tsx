import React, { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Database,
  Edit3,
  Eye,
  EyeOff,
  Film,
  Play,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { SqlSetupModal } from '../components/SqlSetupModal';
import { Avatar } from '../components/ui/Avatar';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { TableSkeleton } from '../components/ui/Skeletons';
import { VideoStatusLabel, VisibilityLabel } from '../components/ui/StatusText';
import { useToast } from '../components/ui/ToastProvider';
import { VideoPlayerModal } from '../components/ui/VideoPlayerModal';
import { formatCompactNumber, formatDate, isSafeHttpUrl } from '../lib/formatters';
import { inspectSupabaseSchema } from '../lib/schemaInspector';
import { getSupabaseClient } from '../lib/supabaseClient';
import { fetchCategories, fetchVideosPage, updateVideoRecord } from '../services/adminApi';
import type {
  CategoryRecord,
  SchemaInspectionResult,
  VideoRecord,
  VideoStatus,
  VideoVisibility,
} from '../types/blade';

interface VideosPageProps {
  schema: SchemaInspectionResult;
  onSelectUser: (userId: string) => void;
  onNavigateUpload: () => void;
  onSchemaUpdated?: (next: SchemaInspectionResult) => void;
}

const PAGE_SIZE = 20;

export function VideosPage({
  schema,
  onSelectUser,
  onNavigateUpload,
  onSchemaUpdated,
}: VideosPageProps) {
  const { pushToast } = useToast();
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | VideoStatus>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | VideoVisibility>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'created_at' | 'views' | 'likes' | 'comments'>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyVideoId, setBusyVideoId] = useState<string | null>(null);

  const [previewVideo, setPreviewVideo] = useState<VideoRecord | null>(null);
  const [editingVideo, setEditingVideo] = useState<VideoRecord | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [editStatus, setEditStatus] = useState<VideoStatus>('published');
  const [editVisibility, setEditVisibility] = useState<VideoVisibility>('public');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [confirmModeration, setConfirmModeration] = useState<{
    video: VideoRecord;
    targetStatus: 'hidden' | 'blocked' | 'published';
  } | null>(null);
  const [moderationBusy, setModerationBusy] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);

  const needsVideoModerationSql =
    !schema.rawRpcs.includes('admin_set_video_moderation') ||
    !schema.rawRpcs.includes('is_video_publicly_visible') ||
    !schema.rawRpcs.includes('get_blade_migration_version') ||
    (schema.migrationVersion ?? 0) < 6 ||
    !schema.videos?.isHiddenCol ||
    !schema.videos?.isBlockedCol;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    void fetchCategories(schema)
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [schema]);

  const loadVideos = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetchVideosPage(schema, {
          page,
          pageSize: PAGE_SIZE,
          search: debouncedSearch,
          statusFilter,
          visibilityFilter,
          categoryFilter,
          sortBy,
          sortDir,
        });
        setVideos(res.videos);
        setTotal(res.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load videos.');
      } finally {
        setLoading(false);
      }
    },
    [
      schema,
      page,
      debouncedSearch,
      statusFilter,
      visibilityFilter,
      categoryFilter,
      sortBy,
      sortDir,
    ]
  );

  useEffect(() => {
    void loadVideos(false);
  }, [loadVideos]);

  useEffect(() => {
    if (!schema.videos) return;
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('blade-videos-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: schema.videos.table },
        () => void loadVideos(true)
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [schema.videos, loadVideos]);

  const handleQuickStatus = async (video: VideoRecord, nextStatus: VideoStatus) => {
    setBusyVideoId(video.id);
    try {
      await updateVideoRecord(schema, video.id, { status: nextStatus });
      setVideos((prev) =>
        statusFilter !== 'all' && statusFilter !== nextStatus
          ? prev.filter((item) => item.id !== video.id)
          : prev.map((item) => (item.id === video.id ? { ...item, status: nextStatus } : item))
      );
      pushToast({
        title:
          nextStatus === 'hidden'
            ? 'Video hidden from public feed'
            : nextStatus === 'blocked'
            ? 'Video blocked'
            : 'Video published & visible',
        description: video.caption || video.id,
        variant: 'success',
      });
      await loadVideos(true);
    } catch (err) {
      pushToast({
        title: 'Status update failed',
        description: err instanceof Error ? err.message : 'Operation denied.',
        variant: 'error',
      });
    } finally {
      setBusyVideoId(null);
    }
  };

  const handleExecuteConfirmedModeration = async () => {
    if (!confirmModeration) return;
    setModerationBusy(true);
    try {
      await handleQuickStatus(confirmModeration.video, confirmModeration.targetStatus);
      setConfirmModeration(null);
    } finally {
      setModerationBusy(false);
    }
  };

  const openEdit = (video: VideoRecord) => {
    setEditingVideo(video);
    setEditCaption(video.caption);
    setEditDescription(video.description);
    setEditHashtags(video.hashtags.join(' '));
    setEditStatus(video.status);
    setEditVisibility(video.visibility);
    setEditCategoryId(video.categoryId ?? '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVideo) return;
    setSavingEdit(true);
    try {
      const cat = categories.find((c) => c.id === editCategoryId);
      const hashtags = editHashtags
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean);

      await updateVideoRecord(schema, editingVideo.id, {
        caption: editCaption,
        description: editDescription,
        hashtags,
        status: editStatus,
        visibility: editVisibility,
        categoryId: cat?.id ?? null,
        categoryName: cat?.name ?? '',
      });

      pushToast({ title: 'Video updated', variant: 'success' });
      setEditingVideo(null);
      await loadVideos(true);
    } catch (err) {
      pushToast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Unable to save video changes.',
        variant: 'error',
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-zinc-950">ALL VIDEOS</h1>
          <p className="text-sm text-zinc-600 mt-0.5 tabular-nums">
            {total} videos in <span className="font-mono">{schema.videos?.table ?? 'videos'}</span> ·
            Use Hide &amp; Block controls to moderate without deleting media.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg">
            {(['all', 'published', 'hidden', 'blocked'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setStatusFilter(tab);
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md capitalize transition-colors whitespace-nowrap ${
                  statusFilter === tab
                    ? 'bg-white text-zinc-950 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-950'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onNavigateUpload}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors whitespace-nowrap"
          >
            Upload Video
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[230px]">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by caption, owner username, or category…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>

        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as typeof statusFilter);
            setPage(1);
          }}
          className="px-3 py-2 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
        >
          <option value="all">All Statuses</option>
          <option value="published">Published</option>
          <option value="hidden">Hidden</option>
          <option value="blocked">Blocked</option>
          <option value="draft">Draft</option>
        </select>

        <select
          aria-label="Filter by visibility"
          value={visibilityFilter}
          onChange={(e) => {
            setVisibilityFilter(e.target.value as typeof visibilityFilter);
            setPage(1);
          }}
          className="px-3 py-2 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
        >
          <option value="all">All Visibility</option>
          <option value="public">Public</option>
          <option value="followers">Followers</option>
          <option value="private">Private</option>
        </select>

        {categories.length > 0 && (
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={schema.videos?.categoryIdCol ? c.id : c.name}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        <select
          aria-label="Sort videos"
          value={`${sortBy}:${sortDir}`}
          onChange={(e) => {
            const [col, dir] = e.target.value.split(':');
            setSortBy(col as typeof sortBy);
            setSortDir(dir as 'asc' | 'desc');
            setPage(1);
          }}
          className="px-3 py-2 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
        >
          <option value="created_at:desc">Newest Uploads</option>
          <option value="created_at:asc">Oldest Uploads</option>
          <option value="views:desc">Most Viewed</option>
          <option value="likes:desc">Most Liked</option>
          <option value="comments:desc">Most Commented</option>
        </select>
      </div>

      {needsVideoModerationSql && (
        <div className="bg-zinc-950 text-white rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 border border-zinc-800">
          <div className="text-xs space-y-1">
            <div className="font-semibold text-sm">
              Enable Full Android Video Hide &amp; Block Enforcement
            </div>
            <p className="text-zinc-300">
              Run the updated SQL migration to install{' '}
              <span className="font-mono">admin_set_video_moderation()</span>,{' '}
              <span className="font-mono">is_hidden</span>/<span className="font-mono">is_blocked</span>{' '}
              sync, and restrictive feed/view RLS so hidden &amp; blocked videos disappear immediately
              for normal Android users (note: test your Android app using a non-admin account).
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

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        {loading ? (
          <TableSkeleton rows={8} cols={8} />
        ) : videos.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <Film className="w-8 h-8 text-zinc-300 mx-auto" />
            <p className="text-sm font-semibold text-zinc-950 mt-3">No videos found</p>
            <p className="text-xs text-zinc-500 mt-1">
              {debouncedSearch || statusFilter !== 'all' || visibilityFilter !== 'all'
                ? 'Try clearing your search or filters.'
                : 'Upload a video or wait for Android creators to publish content.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                  <th className="py-3 px-4">Thumbnail / Video</th>
                  <th className="py-3 px-4">Caption</th>
                  <th className="py-3 px-4">Owner</th>
                  <th className="py-3 px-4 text-right">Views</th>
                  <th className="py-3 px-4 text-right">Likes</th>
                  <th className="py-3 px-4 text-right">Comments</th>
                  <th className="py-3 px-4">Upload Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Visibility</th>
                  <th className="py-3 px-4 text-right">Moderation &amp; Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-sm">
                {videos.map((v) => {
                  const thumb = isSafeHttpUrl(v.thumbnailUrl);
                  const busy = busyVideoId === v.id;
                  return (
                    <tr key={v.id} className="hover:bg-zinc-50 transition-colors">
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => setPreviewVideo(v)}
                          className="w-12 h-16 rounded bg-zinc-950 overflow-hidden relative flex items-center justify-center border border-zinc-200 group"
                          title="Play video"
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
                          <span className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Play className="w-4 h-4 text-white fill-white" />
                          </span>
                        </button>
                      </td>
                      <td className="py-3 px-4 max-w-[240px]">
                        <div className="font-semibold text-zinc-950 truncate">
                          {v.caption || 'Untitled'}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                          {v.categoryName || 'Uncategorized'}
                          {v.hashtags.length > 0 && ` · ${v.hashtags.slice(0, 3).join(' ')}`}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => v.ownerId && onSelectUser(v.ownerId)}
                          className="flex items-center gap-2 text-left group"
                        >
                          <Avatar
                            src={v.ownerAvatarUrl}
                            name={v.ownerName || v.ownerUsername || v.ownerId}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-zinc-900 group-hover:text-red-600 truncate max-w-[130px]">
                              {v.ownerUsername
                                ? `@${v.ownerUsername}`
                                : v.ownerName || v.ownerId.slice(0, 8)}
                            </div>
                          </div>
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-xs text-zinc-900">
                        {formatCompactNumber(v.viewsCount)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-xs text-zinc-700">
                        {formatCompactNumber(v.likesCount)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-xs text-zinc-700">
                        {formatCompactNumber(v.commentsCount)}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-600 whitespace-nowrap tabular-nums">
                        {formatDate(v.createdAt)}
                      </td>
                      <td className="py-3 px-4">
                        <VideoStatusLabel status={v.status} />
                      </td>
                      <td className="py-3 px-4">
                        <VisibilityLabel visibility={v.visibility} />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewVideo(v)}
                            title="Watch video"
                            className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 rounded"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(v)}
                            title="Edit video"
                            className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 rounded"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          {v.status === 'hidden' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleQuickStatus(v, 'published')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 rounded transition-colors whitespace-nowrap shrink-0"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Unhide
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setConfirmModeration({ video: v, targetStatus: 'hidden' })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-800 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded transition-colors whitespace-nowrap shrink-0"
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                              Hide
                            </button>
                          )}

                          {v.status === 'blocked' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleQuickStatus(v, 'published')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 rounded transition-colors whitespace-nowrap shrink-0"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Unblock
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setConfirmModeration({ video: v, targetStatus: 'blocked' })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded transition-colors whitespace-nowrap shrink-0"
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

        <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 bg-zinc-50 text-xs text-zinc-600">
          <div className="tabular-nums">
            Page {page} of {totalPages} · {total} videos
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-zinc-300 rounded hover:bg-zinc-100 disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-zinc-300 rounded hover:bg-zinc-100 disabled:opacity-40"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Edit Video Modal */}
      {editingVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-lg bg-white border border-zinc-200 rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <h3 className="text-base font-bold text-zinc-950">Edit Video</h3>
              <button
                type="button"
                onClick={() => setEditingVideo(null)}
                className="p-1 text-zinc-400 hover:text-zinc-950"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-900 mb-1">Caption</label>
                <input
                  type="text"
                  value={editCaption}
                  onChange={(e) => setEditCaption(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-900 mb-1">Description</label>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-900 mb-1">Hashtags</label>
                <input
                  type="text"
                  value={editHashtags}
                  onChange={(e) => setEditHashtags(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">Category</label>
                  <select
                    value={editCategoryId}
                    onChange={(e) => setEditCategoryId(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm border border-zinc-300 rounded-md bg-white"
                  >
                    <option value="">None</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as VideoStatus)}
                    className="w-full px-2.5 py-2 text-sm border border-zinc-300 rounded-md bg-white"
                  >
                    <option value="published">Published</option>
                    <option value="hidden">Hidden</option>
                    <option value="blocked">Blocked</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">
                    Visibility
                  </label>
                  <select
                    value={editVisibility}
                    onChange={(e) => setEditVisibility(e.target.value as VideoVisibility)}
                    className="w-full px-2.5 py-2 text-sm border border-zinc-300 rounded-md bg-white"
                  >
                    <option value="public">Public</option>
                    <option value="followers">Followers</option>
                    <option value="private">Private</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingVideo(null)}
                  className="px-4 py-2 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-md"
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

      <VideoPlayerModal
        video={previewVideo}
        onClose={() => setPreviewVideo(null)}
        onOpenOwner={onSelectUser}
      />

      <ConfirmModal
        open={Boolean(confirmModeration)}
        title={confirmModeration?.targetStatus === 'blocked' ? 'Block Video' : 'Hide Video'}
        description={
          confirmModeration?.targetStatus === 'blocked'
            ? `Block "${confirmModeration.video.caption || confirmModeration.video.id}"? It will remain in storage and the database, but normal Android users will no longer be able to view or play it.`
            : `Hide "${confirmModeration?.video.caption || confirmModeration?.video.id}" from the Android public feed? The video stays preserved in the database and storage and can be unhidden anytime.`
        }
        confirmLabel={confirmModeration?.targetStatus === 'blocked' ? 'Block Video' : 'Hide Video'}
        destructive={confirmModeration?.targetStatus === 'blocked'}
        loading={moderationBusy}
        onConfirm={() => void handleExecuteConfirmedModeration()}
        onCancel={() => setConfirmModeration(null)}
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
