import React, { useCallback, useEffect, useState } from 'react';
import { Edit3, FolderKanban, Plus, Power, Trash2, X } from 'lucide-react';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { TableSkeleton } from '../components/ui/Skeletons';
import { useToast } from '../components/ui/ToastProvider';
import { formatCompactNumber, formatDate } from '../lib/formatters';
import { getSupabaseClient } from '../lib/supabaseClient';
import {
  createCategory,
  deleteCategorySafely,
  fetchCategories,
  updateCategory,
} from '../services/adminApi';
import type { CategoryRecord, SchemaInspectionResult } from '../types/blade';

interface CategoriesPageProps {
  schema: SchemaInspectionResult;
}

export function CategoriesPage({ schema }: CategoriesPageProps) {
  const { pushToast } = useToast();
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRecord | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [isEnabled, setIsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const [toDelete, setToDelete] = useState<CategoryRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadCategories = useCallback(
    async (silent = false) => {
      if (!schema.categories) {
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetchCategories(schema);
        setCategories(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load categories.');
      } finally {
        setLoading(false);
      }
    },
    [schema]
  );

  useEffect(() => {
    void loadCategories(false);
  }, [loadCategories]);

  useEffect(() => {
    if (!schema.categories) return;
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('blade-categories-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: schema.categories.table },
        () => void loadCategories(true)
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [schema.categories, loadCategories]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setSortOrder(categories.length);
    setIsEnabled(true);
    setModalOpen(true);
  };

  const openEdit = (cat: CategoryRecord) => {
    setEditing(cat);
    setName(cat.name);
    setDescription(cat.description);
    setSortOrder(cat.sortOrder);
    setIsEnabled(cat.isEnabled);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await updateCategory(schema, editing.id, {
          name,
          description,
          sortOrder,
          isEnabled,
        });
        pushToast({ title: 'Category updated', variant: 'success' });
      } else {
        await createCategory(schema, {
          name,
          description,
          sortOrder,
          isEnabled,
        });
        pushToast({ title: 'Category created', variant: 'success' });
      }
      setModalOpen(false);
      await loadCategories(true);
    } catch (err) {
      pushToast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Database rejected operation.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (cat: CategoryRecord) => {
    try {
      await updateCategory(schema, cat.id, { isEnabled: !cat.isEnabled });
      pushToast({
        title: !cat.isEnabled ? 'Category enabled' : 'Category disabled',
        description: cat.name,
        variant: 'success',
      });
      await loadCategories(true);
    } catch (err) {
      pushToast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Unable to toggle category.',
        variant: 'error',
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteCategorySafely(schema, toDelete);
      pushToast({ title: 'Category deleted', variant: 'success' });
      setToDelete(null);
      await loadCategories(true);
    } catch (err) {
      pushToast({
        title: 'Cannot delete category',
        description: err instanceof Error ? err.message : 'Operation denied.',
        variant: 'error',
      });
    } finally {
      setDeleting(false);
    }
  };

  if (!schema.categories) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-bold text-zinc-950">CATEGORIES</h1>
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <FolderKanban className="w-8 h-8 text-zinc-300 mx-auto" />
          <p className="text-sm font-semibold text-zinc-950 mt-3">
            No categories table detected in Supabase
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-zinc-950">CATEGORIES</h1>
          <p className="text-sm text-zinc-600 mt-0.5">
            Shared content categories for BLADE ADMIN PANEL and your Android application.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors whitespace-nowrap"
        >
          <Plus className="w-4 h-4" /> Create Category
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : categories.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <FolderKanban className="w-8 h-8 text-zinc-300 mx-auto" />
            <p className="text-sm font-semibold text-zinc-950 mt-3">No categories yet</p>
            <p className="text-xs text-zinc-500 mt-1">
              Create your first category to organize Android short-video feeds.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                  <th className="py-3 px-4">Order</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Slug</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Videos</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-sm">
                {categories.map((cat) => (
                  <tr key={cat.id} className="hover:bg-zinc-50">
                    <td className="py-3 px-4 font-mono text-xs text-zinc-500 tabular-nums">
                      {cat.sortOrder}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-zinc-950">{cat.name}</div>
                      {cat.description && (
                        <div className="text-xs text-zinc-500 truncate max-w-xs">
                          {cat.description}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-600">{cat.slug || '—'}</td>
                    <td className="py-3 px-4 text-xs font-semibold">
                      {cat.isEnabled ? (
                        <span className="text-emerald-700">Enabled</span>
                      ) : (
                        <span className="text-zinc-400">Disabled</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-xs font-medium">
                      {cat.videoCount !== null ? formatCompactNumber(cat.videoCount) : '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-500 whitespace-nowrap tabular-nums">
                      {formatDate(cat.createdAt)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(cat)}
                          title="Edit category"
                          className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 rounded"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleEnabled(cat)}
                          title={cat.isEnabled ? 'Disable category' : 'Enable category'}
                          className={`p-1.5 rounded ${
                            cat.isEnabled
                              ? 'text-emerald-700 hover:bg-emerald-50'
                              : 'text-zinc-400 hover:bg-zinc-100'
                          }`}
                        >
                          <Power className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setToDelete(cat)}
                          title="Delete category"
                          className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md bg-white border border-zinc-200 rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <h3 className="text-base font-bold text-zinc-950">
                {editing ? 'Edit Category' : 'Create Category'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-zinc-400 hover:text-zinc-950"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-900 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Comedy, Music, Sports"
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              {schema.categories.descriptionCol && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-900 mb-1">
                    Description
                  </label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 items-center">
                {schema.categories.sortOrderCol && (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-900 mb-1">
                      Sort Order
                    </label>
                    <input
                      type="number"
                      value={sortOrder}
                      onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md"
                    />
                  </div>
                )}
                {schema.categories.enabledCol && (
                  <label className="flex items-center gap-2 text-xs font-semibold text-zinc-900 mt-5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) => setIsEnabled(e.target.checked)}
                      className="accent-red-600"
                    />
                    Enabled in Android App
                  </label>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-semibold text-white bg-zinc-950 hover:bg-zinc-800 rounded-md disabled:opacity-50"
                >
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(toDelete)}
        title="Delete Category"
        description={`Delete category "${toDelete?.name}"? Deletion is blocked automatically if existing videos reference this category.`}
        confirmLabel="Delete Category"
        destructive
        loading={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
