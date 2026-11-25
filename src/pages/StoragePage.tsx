import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, HardDrive, RefreshCw, Trash2 } from 'lucide-react';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { TableSkeleton } from '../components/ui/Skeletons';
import { useToast } from '../components/ui/ToastProvider';
import {
  formatBytes,
  formatCompactNumber,
  formatDateTime,
  isSafeHttpUrl,
} from '../lib/formatters';
import {
  deleteStorageObject,
  fetchStorageStats,
  listBucketObjects,
  updateStorageQuotaGb,
} from '../services/adminApi';
import { getPreferences } from '../lib/supabaseClient';
import type { StorageObjectItem, StorageStats } from '../types/blade';

export function StoragePage() {
  const { pushToast } = useToast();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string>('');
  const [objects, setObjects] = useState<StorageObjectItem[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [toDelete, setToDelete] = useState<StorageObjectItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [customQuotaInput, setCustomQuotaInput] = useState<string>(() => {
    const q = getPreferences().storageQuotaGb;
    return q ? String(q) : '';
  });
  const [savingQuota, setSavingQuota] = useState(false);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const s = await fetchStorageStats();
      setStats(s);
      if (s.buckets.length > 0 && !selectedBucket) {
        setSelectedBucket(s.buckets[0].name);
      }
    } catch (err) {
      pushToast({
        title: 'Storage check failed',
        description: err instanceof Error ? err.message : 'Unable to inspect storage.',
        variant: 'error',
      });
    } finally {
      setLoadingStats(false);
    }
  }, [selectedBucket, pushToast]);

  const loadObjects = useCallback(
    async (bucket: string) => {
      if (!bucket) return;
      setLoadingObjects(true);
      try {
        const items = await listBucketObjects(bucket);
        setObjects(items);
      } catch (err) {
        setObjects([]);
        pushToast({
          title: `Failed to list bucket "${bucket}"`,
          description: err instanceof Error ? err.message : 'Storage permission error.',
          variant: 'error',
        });
      } finally {
        setLoadingObjects(false);
      }
    },
    [pushToast]
  );

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (selectedBucket) {
      void loadObjects(selectedBucket);
    }
  }, [selectedBucket, loadObjects]);

  const handleConfirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteStorageObject(toDelete.bucket, toDelete.path);
      pushToast({ title: 'Storage object deleted', description: toDelete.path, variant: 'success' });
      setToDelete(null);
      await Promise.all([loadStats(), loadObjects(toDelete.bucket)]);
    } catch (err) {
      pushToast({
        title: 'Storage delete failed',
        description: err instanceof Error ? err.message : 'Unable to remove file.',
        variant: 'error',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleUpdateQuota = async (quotaGb: number | null) => {
    setSavingQuota(true);
    try {
      await updateStorageQuotaGb(quotaGb);
      setCustomQuotaInput(quotaGb ? String(quotaGb) : '');
      pushToast({
        title: 'Storage quota updated',
        description: quotaGb ? `Plan quota set to ${quotaGb} GB.` : 'Reset to automatic Supabase tier detection.',
        variant: 'success',
      });
      await loadStats();
    } catch (err) {
      pushToast({
        title: 'Failed to save quota',
        description: err instanceof Error ? err.message : 'Unable to update storage quota.',
        variant: 'error',
      });
    } finally {
      setSavingQuota(false);
    }
  };

  const availableBytes =
    stats && stats.totalBytesQuota !== null && stats.totalBytesUsed !== null
      ? Math.max(0, stats.totalBytesQuota - stats.totalBytesUsed)
      : null;

  const usedPercent =
    stats &&
    stats.totalBytesQuota &&
    stats.totalBytesQuota > 0 &&
    stats.totalBytesUsed !== null
      ? Math.min(100, (stats.totalBytesUsed / stats.totalBytesQuota) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-zinc-950">STORAGE</h1>
          <p className="text-sm text-zinc-600 mt-0.5">
            Real Supabase Storage consumption and media objects across application buckets.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void loadStats();
            if (selectedBucket) void loadObjects(selectedBucket);
          }}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-white border border-zinc-300 rounded-md hover:bg-zinc-50"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh Storage
        </button>
      </div>

      {stats?.unavailableReason && (
        <div className="p-4 rounded-lg bg-zinc-50 border border-zinc-200 text-xs text-zinc-700">
          {stats.unavailableReason}
        </div>
      )}

      {/* Storage Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <div className="text-xs text-zinc-500">Storage Used</div>
          <div className="text-xl font-bold text-zinc-950 tabular-nums mt-1.5">
            {loadingStats
              ? '—'
              : stats?.available
              ? formatBytes(stats.totalBytesUsed)
              : 'Unavailable'}
          </div>
          {stats?.totalBytesQuota ? (
            <div className="mt-2">
              <div className="h-1.5 w-full bg-zinc-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    usedPercent >= 90 ? 'bg-red-600' : 'bg-zinc-950'
                  }`}
                  style={{ width: `${Math.max(2, Math.round(usedPercent))}%` }}
                />
              </div>
              <div className="text-[11px] text-zinc-500 mt-1 tabular-nums">
                {usedPercent.toFixed(1)}% of {formatBytes(stats.totalBytesQuota)}
              </div>
            </div>
          ) : null}
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <div className="text-xs text-zinc-500">Storage Available</div>
          <div className="text-xl font-bold text-zinc-950 tabular-nums mt-1.5">
            {loadingStats
              ? '—'
              : availableBytes !== null
              ? formatBytes(availableBytes)
              : 'Unavailable'}
          </div>
          <div className="text-[11px] text-zinc-400 mt-1 tabular-nums">
            {stats?.totalBytesQuota
              ? `${formatBytes(stats.totalBytesQuota)} ${
                  stats.quotaIsDefault ? 'default plan quota' : 'configured quota'
                }`
              : 'Configure plan quota below'}
          </div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <div className="text-xs text-zinc-500">Video Storage</div>
          <div className="text-xl font-bold text-zinc-950 tabular-nums mt-1.5">
            {loadingStats
              ? '—'
              : stats?.available
              ? formatBytes(stats.videoBytesUsed)
              : 'Unavailable'}
          </div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <div className="text-xs text-zinc-500">Image Storage</div>
          <div className="text-xl font-bold text-zinc-950 tabular-nums mt-1.5">
            {loadingStats
              ? '—'
              : stats?.available
              ? formatBytes(stats.imageBytesUsed)
              : 'Unavailable'}
          </div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <div className="text-xs text-zinc-500">File Count</div>
          <div className="text-xl font-bold text-zinc-950 tabular-nums mt-1.5">
            {loadingStats
              ? '—'
              : stats?.available
              ? formatCompactNumber(stats.fileCount)
              : 'Unavailable'}
          </div>
        </div>
      </div>

      {/* Supabase Plan Storage Quota Selector */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-zinc-950">Supabase Storage Quota</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            Match your Supabase project tier to calculate exact Storage Available.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { label: 'Free (1 GB)', gb: 1 },
            { label: 'Pro (100 GB)', gb: 100 },
            { label: 'Team (250 GB)', gb: 250 },
          ].map((preset) => {
            const active =
              stats?.totalBytesQuota !== null &&
              Math.round((stats?.totalBytesQuota ?? 0) / (1024 * 1024 * 1024)) === preset.gb;
            return (
              <button
                key={preset.gb}
                type="button"
                disabled={savingQuota}
                onClick={() => void handleUpdateQuota(preset.gb)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
                  active
                    ? 'bg-zinc-950 text-white border-zinc-950'
                    : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = Number(customQuotaInput);
              if (Number.isFinite(parsed) && parsed > 0) {
                void handleUpdateQuota(parsed);
              }
            }}
            className="flex items-center gap-1.5"
          >
            <input
              type="number"
              min="0.1"
              step="any"
              value={customQuotaInput}
              onChange={(e) => setCustomQuotaInput(e.target.value)}
              placeholder="Custom GB"
              className="w-24 px-2.5 py-1.5 text-xs border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
            />
            <button
              type="submit"
              disabled={savingQuota || !customQuotaInput || Number(customQuotaInput) <= 0}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-40"
            >
              Set GB
            </button>
          </form>
        </div>
      </div>

      {/* Buckets Selector */}
      {stats && stats.buckets.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <div className="text-xs font-semibold text-zinc-900 mb-3">Storage Buckets</div>
          <div className="flex flex-wrap gap-2">
            {stats.buckets.map((b) => (
              <button
                key={b.name}
                type="button"
                onClick={() => setSelectedBucket(b.name)}
                className={`px-3.5 py-2 rounded-md border text-left transition-colors ${
                  selectedBucket === b.name
                    ? 'bg-zinc-950 text-white border-zinc-950'
                    : 'bg-white text-zinc-900 border-zinc-200 hover:border-zinc-400'
                }`}
              >
                <div className="text-xs font-mono font-semibold">{b.name}</div>
                <div
                  className={`text-[11px] tabular-nums mt-0.5 ${
                    selectedBucket === b.name ? 'text-zinc-300' : 'text-zinc-500'
                  }`}
                >
                  {b.fileCount !== null ? `${b.fileCount} files` : '—'} ·{' '}
                  {b.bytesUsed !== null ? formatBytes(b.bytesUsed) : '—'} ·{' '}
                  {b.isPublic ? 'Public' : 'Private'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bucket Files */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div className="text-sm font-bold text-zinc-950">
            {selectedBucket ? `Bucket: ${selectedBucket}` : 'Storage Objects'}
          </div>
          <div className="text-xs text-zinc-500 tabular-nums">{objects.length} objects</div>
        </div>

        {loadingObjects ? (
          <TableSkeleton rows={6} cols={5} />
        ) : objects.length === 0 ? (
          <div className="py-14 px-6 text-center">
            <HardDrive className="w-8 h-8 text-zinc-300 mx-auto" />
            <p className="text-sm font-semibold text-zinc-950 mt-3">No files found in bucket</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                  <th className="py-3 px-4">Path</th>
                  <th className="py-3 px-4">MIME Type</th>
                  <th className="py-3 px-4 text-right">Size</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-sm">
                {objects.map((obj) => {
                  const safeUrl = isSafeHttpUrl(obj.publicUrl);
                  return (
                    <tr key={obj.id} className="hover:bg-zinc-50">
                      <td className="py-3 px-4 font-mono text-xs text-zinc-900 max-w-md truncate">
                        {obj.path}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-zinc-500">{obj.mimeType}</td>
                      <td className="py-3 px-4 text-right text-xs tabular-nums text-zinc-700">
                        {formatBytes(obj.sizeBytes)}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-500 whitespace-nowrap tabular-nums">
                        {formatDateTime(obj.createdAt)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          {safeUrl && (
                            <a
                              href={safeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open object"
                              className="p-1.5 text-zinc-500 hover:text-zinc-950 rounded"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => setToDelete(obj)}
                            title="Delete file from storage"
                            className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
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

      <ConfirmModal
        open={Boolean(toDelete)}
        title="Delete Storage Object"
        description={`Remove "${toDelete?.path}" from Supabase Storage bucket "${toDelete?.bucket}"? Any videos referencing this file will lose playback.`}
        confirmLabel="Delete File"
        destructive
        loading={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
