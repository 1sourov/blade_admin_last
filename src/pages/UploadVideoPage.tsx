import React, { useEffect, useState } from 'react';
import { Check, Film, Image as ImageIcon, Search, Upload, UserCheck } from 'lucide-react';
import { Avatar } from '../components/ui/Avatar';
import { useToast } from '../components/ui/ToastProvider';
import { extractVideoThumbnail, formatBytes } from '../lib/formatters';
import {
  fetchCategories,
  searchUsersMinimal,
  uploadVideoAsOwner,
} from '../services/adminApi';
import type {
  AppUser,
  CategoryRecord,
  SchemaInspectionResult,
  VideoStatus,
  VideoVisibility,
} from '../types/blade';

interface UploadVideoPageProps {
  schema: SchemaInspectionResult;
  preselectedOwner?: AppUser | null;
  onUploaded?: (ownerId: string) => void;
}

export function UploadVideoPage({
  schema,
  preselectedOwner = null,
  onUploaded,
}: UploadVideoPageProps) {
  const { pushToast } = useToast();

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [thumbBlob, setThumbBlob] = useState<Blob | null>(null);
  const [thumbPreviewUrl, setThumbPreviewUrl] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);

  const [caption, setCaption] = useState('');
  const [description, setDescription] = useState('');
  const [hashtagsText, setHashtagsText] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [visibility, setVisibility] = useState<VideoVisibility>('public');
  const [status, setStatus] = useState<VideoStatus>('published');

  const [categories, setCategories] = useState<CategoryRecord[]>([]);

  // Real Owner Selection
  const [ownerSearch, setOwnerSearch] = useState('');
  const [ownerCandidates, setOwnerCandidates] = useState<AppUser[]>([]);
  const [selectedOwner, setSelectedOwner] = useState<AppUser | null>(preselectedOwner);
  const [searchingOwners, setSearchingOwners] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [progressStage, setProgressStage] = useState('');
  const [progressPct, setProgressPct] = useState(0);

  useEffect(() => {
    if (preselectedOwner) setSelectedOwner(preselectedOwner);
  }, [preselectedOwner]);

  useEffect(() => {
    void fetchCategories(schema)
      .then((cats) => setCategories(cats.filter((c) => c.isEnabled)))
      .catch(() => setCategories([]));
  }, [schema]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchingOwners(true);
      void searchUsersMinimal(schema, ownerSearch)
        .then((users) => setOwnerCandidates(users))
        .catch(() => setOwnerCandidates([]))
        .finally(() => setSearchingOwners(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [schema, ownerSearch]);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
      if (thumbPreviewUrl) URL.revokeObjectURL(thumbPreviewUrl);
    };
  }, [videoPreviewUrl, thumbPreviewUrl]);

  const handleVideoFileSelect = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      pushToast({
        title: 'Invalid file type',
        description: 'Please select a valid video file (MP4, MOV, WebM).',
        variant: 'error',
      });
      return;
    }

    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    if (thumbPreviewUrl) URL.revokeObjectURL(thumbPreviewUrl);

    setVideoFile(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
    setThumbBlob(null);
    setThumbPreviewUrl(null);

    try {
      const extracted = await extractVideoThumbnail(file, 1.0);
      setThumbBlob(extracted.blob);
      setThumbPreviewUrl(extracted.previewUrl);
      setDurationSeconds(extracted.durationSeconds);
    } catch {
      // Non-fatal: user can upload custom thumbnail or proceed without one
    }
  };

  const handleCustomThumbnailSelect = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      pushToast({ title: 'Select an image file for the thumbnail', variant: 'error' });
      return;
    }
    if (thumbPreviewUrl) URL.revokeObjectURL(thumbPreviewUrl);
    setThumbBlob(file);
    setThumbPreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile) {
      pushToast({ title: 'Select a video file to upload', variant: 'error' });
      return;
    }
    if (!selectedOwner) {
      pushToast({
        title: 'Select Video Owner',
        description: 'Every uploaded video must belong to a real user account.',
        variant: 'error',
      });
      return;
    }

    setUploading(true);
    setProgressStage('Preparing upload…');
    setProgressPct(10);

    try {
      const hashtags = hashtagsText
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith('#') ? t : `#${t}`));

      const chosenCategory = categories.find((c) => c.id === categoryId);

      await uploadVideoAsOwner(schema, {
        file: videoFile,
        thumbnailBlob: thumbBlob,
        ownerId: selectedOwner.id,
        caption,
        description,
        hashtags,
        categoryId: chosenCategory?.id ?? null,
        categoryName: chosenCategory?.name ?? '',
        visibility,
        status,
        durationSeconds,
        onProgress: (stage, pct) => {
          setProgressStage(stage);
          setProgressPct(pct);
        },
      });

      pushToast({
        title: 'Video uploaded successfully',
        description: `Owned by ${selectedOwner.username ? `@${selectedOwner.username}` : selectedOwner.name || selectedOwner.id} and live in Supabase.`,
        variant: 'success',
      });

      const ownerId = selectedOwner.id;
      setVideoFile(null);
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
      if (thumbPreviewUrl) URL.revokeObjectURL(thumbPreviewUrl);
      setVideoPreviewUrl(null);
      setThumbBlob(null);
      setThumbPreviewUrl(null);
      setCaption('');
      setDescription('');
      setHashtagsText('');
      onUploaded?.(ownerId);
    } catch (err) {
      pushToast({
        title: 'Video upload failed',
        description: err instanceof Error ? err.message : 'Upload aborted.',
        variant: 'error',
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-zinc-950">UPLOAD VIDEO</h1>
        <p className="text-sm text-zinc-600 mt-0.5">
          Upload a real video to Supabase Storage and assign an existing Android user as its true
          database owner.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Video & Thumbnail Selection */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-zinc-200 rounded-lg p-5">
            <label className="block text-xs font-semibold text-zinc-900 mb-2">Select Video</label>
            <label className="block border border-dashed border-zinc-300 rounded-lg p-5 text-center cursor-pointer hover:border-red-600 transition-colors bg-zinc-50">
              <input
                type="file"
                accept="video/*"
                className="sr-only"
                onChange={(e) => void handleVideoFileSelect(e.target.files?.[0] ?? null)}
              />
              <Upload className="w-6 h-6 text-zinc-500 mx-auto" />
              <div className="text-sm font-semibold text-zinc-950 mt-2">
                {videoFile ? videoFile.name : 'Choose MP4, MOV, or WebM video'}
              </div>
              <div className="text-xs text-zinc-500 mt-1 tabular-nums">
                {videoFile
                  ? `${formatBytes(videoFile.size)}${durationSeconds ? ` · ${durationSeconds}s` : ''}`
                  : 'Uploaded directly to your Supabase Storage bucket'}
              </div>
            </label>

            {videoPreviewUrl && (
              <div className="mt-4 bg-black rounded-md overflow-hidden border border-zinc-800">
                <video
                  src={videoPreviewUrl}
                  controls
                  playsInline
                  className="w-full max-h-[300px] object-contain"
                />
              </div>
            )}
          </div>

          <div className="bg-white border border-zinc-200 rounded-lg p-5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold text-zinc-900">Generated Thumbnail</span>
              <label className="text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer">
                Replace Image
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => handleCustomThumbnailSelect(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            {thumbPreviewUrl ? (
              <img
                src={thumbPreviewUrl}
                alt="Video thumbnail preview"
                className="w-full h-44 object-cover rounded-md border border-zinc-200 bg-zinc-100"
              />
            ) : (
              <div className="h-32 rounded-md border border-dashed border-zinc-200 flex flex-col items-center justify-center text-xs text-zinc-400 gap-1.5">
                <ImageIcon className="w-5 h-5" />
                Auto-extracted when a video is selected
              </div>
            )}
          </div>
        </div>

        {/* Right: Metadata & Real Owner Picker */}
        <div className="lg:col-span-7 space-y-5">
          {/* Select Video Owner */}
          <div className="bg-white border border-zinc-200 rounded-lg p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <label className="text-xs font-semibold text-zinc-950">
                  Select User / Video Owner <span className="text-red-600">*</span>
                </label>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  The video will be stored under this user&apos;s real database ID, not the admin
                  account.
                </p>
              </div>
              {selectedOwner && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <UserCheck className="w-3.5 h-3.5" /> Owner Selected
                </span>
              )}
            </div>

            {selectedOwner && (
              <div className="mb-3 p-3 rounded-md bg-zinc-950 text-white flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar
                    src={selectedOwner.avatarUrl}
                    name={selectedOwner.name || selectedOwner.username}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {selectedOwner.name || 'Unnamed User'}{' '}
                      {selectedOwner.username && (
                        <span className="text-zinc-400 font-mono text-xs">
                          @{selectedOwner.username}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-zinc-400 truncate">
                      Owner ID: {selectedOwner.id}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedOwner(null)}
                  className="text-xs font-medium text-zinc-300 hover:text-white shrink-0"
                >
                  Change
                </button>
              </div>
            )}

            <div className="relative">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={ownerSearch}
                onChange={(e) => setOwnerSearch(e.target.value)}
                placeholder="Search real Android users by name, username, or email…"
                className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div className="mt-2 max-h-48 overflow-y-auto border border-zinc-200 rounded-md divide-y divide-zinc-100">
              {searchingOwners ? (
                <div className="p-3 text-xs text-zinc-500">Searching users…</div>
              ) : ownerCandidates.length === 0 ? (
                <div className="p-3 text-xs text-zinc-500">
                  No users found in <span className="font-mono">{schema.users?.table ?? 'profiles'}</span>.
                </div>
              ) : (
                ownerCandidates.map((u) => {
                  const isSelected = selectedOwner?.id === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setSelectedOwner(u)}
                      className={`w-full px-3 py-2 flex items-center justify-between gap-3 text-left transition-colors ${
                        isSelected ? 'bg-red-50' : 'hover:bg-zinc-50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar src={u.avatarUrl} name={u.name || u.username} size="sm" />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-zinc-950 truncate">
                            {u.name || 'Unnamed'}{' '}
                            {u.username && (
                              <span className="font-mono text-zinc-500">@{u.username}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-400 font-mono truncate">{u.id}</div>
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-red-600 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Video Details */}
          <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-900 mb-1">Caption</label>
              <input
                type="text"
                required
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write video caption…"
                className="w-full px-3.5 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-900 mb-1">Description</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional full description…"
                className="w-full px-3.5 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-900 mb-1">Hashtags</label>
              <input
                type="text"
                value={hashtagsText}
                onChange={(e) => setHashtagsText(e.target.value)}
                placeholder="#trending #comedy #dance"
                className="w-full px-3.5 py-2 text-sm font-mono border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-900 mb-1">Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-900 mb-1">Visibility</label>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as VideoVisibility)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  <option value="public">Public</option>
                  <option value="followers">Followers</option>
                  <option value="private">Private</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-900 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as VideoStatus)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                  <option value="hidden">Hidden</option>
                </select>
              </div>
            </div>

            {uploading && (
              <div className="pt-2">
                <div className="flex items-center justify-between text-xs text-zinc-600 mb-1.5">
                  <span>{progressStage}</span>
                  <span className="tabular-nums font-mono">{progressPct}%</span>
                </div>
                <div className="w-full h-2 bg-zinc-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-600 transition-all duration-200"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="submit"
                disabled={uploading || !videoFile || !selectedOwner}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50"
              >
                <Film className="w-4 h-4" />
                {uploading ? 'Uploading to Supabase…' : 'Upload & Assign to Owner'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
