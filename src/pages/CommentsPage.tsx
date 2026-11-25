import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, MessageSquare, Search, Trash2 } from 'lucide-react';
import { Avatar } from '../components/ui/Avatar';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { TableSkeleton } from '../components/ui/Skeletons';
import { useToast } from '../components/ui/ToastProvider';
import { formatDateTime } from '../lib/formatters';
import { getSupabaseClient } from '../lib/supabaseClient';
import { deleteComment, fetchCommentsPage } from '../services/adminApi';
import type { CommentRecord, SchemaInspectionResult } from '../types/blade';

interface CommentsPageProps {
  schema: SchemaInspectionResult;
  onSelectUser: (userId: string) => void;
}

const PAGE_SIZE = 25;

export function CommentsPage({ schema, onSelectUser }: CommentsPageProps) {
  const { pushToast } = useToast();
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CommentRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadComments = useCallback(
    async (silent = false) => {
      if (!schema.comments) {
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetchCommentsPage(schema, page, PAGE_SIZE, debouncedSearch);
        setComments(res.comments);
        setTotal(res.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load comments.');
      } finally {
        setLoading(false);
      }
    },
    [schema, page, debouncedSearch]
  );

  useEffect(() => {
    void loadComments(false);
  }, [loadComments]);

  useEffect(() => {
    if (!schema.comments) return;
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('blade-comments-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: schema.comments.table },
        () => void loadComments(true)
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [schema.comments, loadComments]);

  const handleConfirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteComment(schema, toDelete.id);
      pushToast({ title: 'Comment deleted', variant: 'success' });
      setToDelete(null);
      await loadComments(true);
    } catch (err) {
      pushToast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Failed to remove comment.',
        variant: 'error',
      });
    } finally {
      setDeleting(false);
    }
  };

  if (!schema.comments) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-bold text-zinc-950">COMMENTS</h1>
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <MessageSquare className="w-8 h-8 text-zinc-300 mx-auto" />
          <p className="text-sm font-semibold text-zinc-950 mt-3">
            No comments table detected in Supabase
          </p>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-zinc-950">COMMENTS</h1>
        <p className="text-sm text-zinc-600 mt-0.5 tabular-nums">
          {total} comments in <span className="font-mono">{schema.comments.table}</span>
        </p>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-4">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search comment text…"
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
          <TableSkeleton rows={7} cols={5} />
        ) : comments.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <MessageSquare className="w-8 h-8 text-zinc-300 mx-auto" />
            <p className="text-sm font-semibold text-zinc-950 mt-3">No comments found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                  <th className="py-3 px-4">Author</th>
                  <th className="py-3 px-4">Comment</th>
                  <th className="py-3 px-4">Related Video</th>
                  <th className="py-3 px-4">Posted</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-sm">
                {comments.map((c) => (
                  <tr key={c.id} className="hover:bg-zinc-50">
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => c.userId && onSelectUser(c.userId)}
                        className="flex items-center gap-2.5 text-left group"
                      >
                        <Avatar
                          src={c.userAvatarUrl}
                          name={c.userName || c.userUsername || c.userId}
                          size="sm"
                        />
                        <span className="text-xs font-semibold text-zinc-900 group-hover:text-red-600">
                          {c.userUsername
                            ? `@${c.userUsername}`
                            : c.userName || c.userId.slice(0, 8)}
                        </span>
                      </button>
                    </td>
                    <td className="py-3 px-4 text-sm text-zinc-900 max-w-md break-words">
                      {c.content}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-600 max-w-[200px] truncate">
                      {c.videoCaption || c.videoId}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-500 whitespace-nowrap tabular-nums">
                      {formatDateTime(c.createdAt)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setToDelete(c)}
                        title="Delete comment"
                        className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 bg-zinc-50 text-xs text-zinc-600">
          <div className="tabular-nums">
            Page {page} of {totalPages} · {total} comments
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

      <ConfirmModal
        open={Boolean(toDelete)}
        title="Delete Comment"
        description="Permanently delete this comment from Supabase? The Android app will stop displaying it."
        confirmLabel="Delete Comment"
        destructive
        loading={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
