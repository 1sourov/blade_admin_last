import { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, Database, EyeOff, Flag, ShieldAlert, XCircle } from 'lucide-react';
import { SqlSetupModal } from '../components/SqlSetupModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { TableSkeleton } from '../components/ui/Skeletons';
import { useToast } from '../components/ui/ToastProvider';
import { formatDateTime } from '../lib/formatters';
import { inspectSupabaseSchema } from '../lib/schemaInspector';
import { getSupabaseClient } from '../lib/supabaseClient';
import {
  fetchReportsPage,
  updateReportStatus,
  updateUserAccountStatus,
  updateVideoRecord,
} from '../services/adminApi';
import type { ReportRecord, SchemaInspectionResult } from '../types/blade';

interface ReportsPageProps {
  schema: SchemaInspectionResult;
  onSelectUser: (userId: string) => void;
  onSchemaUpdated?: (next: SchemaInspectionResult) => void;
}

export function ReportsPage({ schema, onSelectUser, onSchemaUpdated }: ReportsPageProps) {
  const { pushToast } = useToast();
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'hide-video' | 'block-video' | 'block-user';
    report: ReportRecord;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);

  const needsModerationSql =
    !schema.rawRpcs.includes('admin_set_video_moderation') ||
    !schema.rawRpcs.includes('admin_set_user_status') ||
    !schema.rawRpcs.includes('is_video_publicly_visible') ||
    !schema.rawRpcs.includes('get_blade_migration_version') ||
    (schema.migrationVersion ?? 0) < 6;

  const loadReports = useCallback(
    async (silent = false) => {
      if (!schema.reports) {
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetchReportsPage(schema, statusFilter);
        setReports(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load reports.');
      } finally {
        setLoading(false);
      }
    },
    [schema, statusFilter]
  );

  useEffect(() => {
    void loadReports(false);
  }, [loadReports]);

  useEffect(() => {
    if (!schema.reports) return;
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('blade-reports-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: schema.reports.table },
        () => void loadReports(true)
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [schema.reports, loadReports]);

  const handleStatus = async (report: ReportRecord, status: ReportRecord['status']) => {
    try {
      await updateReportStatus(schema, report.id, status);
      pushToast({ title: `Report marked ${status}`, variant: 'success' });
      await loadReports(true);
    } catch (err) {
      pushToast({
        title: 'Report update failed',
        description: err instanceof Error ? err.message : 'Failed to update report.',
        variant: 'error',
      });
    }
  };

  const handleExecuteConfirm = async () => {
    if (!confirmAction) return;
    setBusy(true);
    try {
      const { type, report } = confirmAction;
      if (type === 'hide-video' && report.reportedVideoId && schema.videos) {
        await updateVideoRecord(schema, report.reportedVideoId, { status: 'hidden' });
        await updateReportStatus(schema, report.id, 'resolved');
        pushToast({
          title: 'Reported video hidden & report resolved',
          variant: 'success',
        });
      } else if (type === 'block-video' && report.reportedVideoId && schema.videos) {
        await updateVideoRecord(schema, report.reportedVideoId, { status: 'blocked' });
        await updateReportStatus(schema, report.id, 'resolved');
        pushToast({
          title: 'Reported video blocked & report resolved',
          variant: 'success',
        });
      } else if (type === 'block-user' && report.reportedUserId) {
        await updateUserAccountStatus(schema, report.reportedUserId, 'blocked');
        await updateReportStatus(schema, report.id, 'resolved');
        pushToast({ title: 'Reported user blocked & report resolved', variant: 'success' });
      }
      setConfirmAction(null);
      await loadReports(true);
    } catch (err) {
      pushToast({
        title: 'Moderation action failed',
        description: err instanceof Error ? err.message : 'Operation denied.',
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  if (!schema.reports) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-bold text-zinc-950">REPORTS</h1>
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <Flag className="w-8 h-8 text-zinc-300 mx-auto" />
          <p className="text-sm font-semibold text-zinc-950 mt-3">
            No reports table detected in Supabase
          </p>
          <p className="text-xs text-zinc-500 mt-1 max-w-md mx-auto">
            Your existing Android database does not currently expose a reports table. If you enable
            reporting via Settings → SQL Migration, real user reports will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-zinc-950">REPORTS</h1>
          <p className="text-sm text-zinc-600 mt-0.5">
            Moderate flagged content and user reports from{' '}
            <span className="font-mono">{schema.reports.table}</span> using Hide &amp; Block controls.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg">
          {(['pending', 'reviewing', 'resolved', 'rejected', 'all'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md capitalize transition-colors ${
                statusFilter === tab
                  ? 'bg-white text-zinc-950 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-950'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {needsModerationSql && (
        <div className="bg-zinc-950 text-white rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 border border-zinc-800">
          <div className="text-xs space-y-1">
            <div className="font-semibold text-sm">
              Enable Full Android Content &amp; User Blocking Enforcement
            </div>
            <p className="text-zinc-300">
              Run the updated SQL migration so Hide Video, Block Video, and Block User actions from
              Reports immediately sync with the Android output app.
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
          <TableSkeleton rows={6} cols={6} />
        ) : reports.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <Flag className="w-8 h-8 text-zinc-300 mx-auto" />
            <p className="text-sm font-semibold text-zinc-950 mt-3">
              No {statusFilter === 'all' ? '' : statusFilter} reports
            </p>
            <p className="text-xs text-zinc-500 mt-1">No matching reports exist in Supabase.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                  <th className="py-3 px-4">Reporter</th>
                  <th className="py-3 px-4">Reported User</th>
                  <th className="py-3 px-4">Reported Video</th>
                  <th className="py-3 px-4">Reason</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-sm">
                {reports.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-50">
                    <td className="py-3 px-4 text-xs">
                      {r.reporterId ? (
                        <button
                          type="button"
                          onClick={() => onSelectUser(r.reporterId!)}
                          className="font-mono text-zinc-800 hover:text-red-600"
                        >
                          {r.reporterUsername ? `@${r.reporterUsername}` : r.reporterId.slice(0, 8)}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {r.reportedUserId ? (
                        <button
                          type="button"
                          onClick={() => onSelectUser(r.reportedUserId!)}
                          className="font-mono font-semibold text-zinc-950 hover:text-red-600"
                        >
                          {r.reportedUsername
                            ? `@${r.reportedUsername}`
                            : r.reportedUserId.slice(0, 8)}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-700 max-w-[200px] truncate">
                      {r.reportedVideoCaption || r.reportedVideoId || '—'}
                    </td>
                    <td className="py-3 px-4 max-w-xs">
                      <div className="text-xs font-semibold text-zinc-950">{r.reason || '—'}</div>
                      {r.details && (
                        <div className="text-[11px] text-zinc-500 truncate">{r.details}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-600 whitespace-nowrap tabular-nums">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold capitalize text-zinc-900">
                      {r.status}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        {r.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => void handleStatus(r, 'reviewing')}
                            title="Mark reviewing"
                            className="p-1.5 text-amber-700 hover:bg-amber-50 rounded"
                          >
                            <ShieldAlert className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleStatus(r, 'resolved')}
                          title="Resolve report"
                          className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleStatus(r, 'rejected')}
                          title="Reject report"
                          className="p-1.5 text-zinc-500 hover:bg-zinc-100 rounded"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                        {r.reportedVideoId && (
                          <>
                            <button
                              type="button"
                              onClick={() => setConfirmAction({ type: 'hide-video', report: r })}
                              title="Hide reported video"
                              className="p-1.5 text-amber-700 hover:bg-amber-50 rounded"
                            >
                              <EyeOff className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmAction({ type: 'block-video', report: r })}
                              title="Block reported video"
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {r.reportedUserId && (
                          <button
                            type="button"
                            onClick={() => setConfirmAction({ type: 'block-user', report: r })}
                            title="Block reported user"
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 rounded whitespace-nowrap"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Block User
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={Boolean(confirmAction)}
        title={
          confirmAction?.type === 'hide-video'
            ? 'Hide Reported Video'
            : confirmAction?.type === 'block-video'
            ? 'Block Reported Video'
            : 'Block Reported User'
        }
        description={
          confirmAction?.type === 'hide-video'
            ? 'Hide this flagged video from the Android public feed (keeping media stored) and mark the report resolved?'
            : confirmAction?.type === 'block-video'
            ? 'Block this flagged video so normal Android users cannot view or play it, and mark the report resolved?'
            : 'Block the reported user account and mark this report resolved?'
        }
        confirmLabel={
          confirmAction?.type === 'hide-video'
            ? 'Hide Video'
            : confirmAction?.type === 'block-video'
            ? 'Block Video'
            : 'Block User'
        }
        destructive={confirmAction?.type !== 'hide-video'}
        loading={busy}
        onConfirm={() => void handleExecuteConfirm()}
        onCancel={() => setConfirmAction(null)}
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
