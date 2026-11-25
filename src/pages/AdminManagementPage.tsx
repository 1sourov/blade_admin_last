import React, { useCallback, useEffect, useState } from 'react';
import { Shield, UserPlus } from 'lucide-react';
import { TableSkeleton } from '../components/ui/Skeletons';
import { useToast } from '../components/ui/ToastProvider';
import { formatDateTime } from '../lib/formatters';
import {
  addBladeAdmin,
  fetchBladeAdmins,
  toggleBladeAdminActive,
} from '../services/adminApi';
import type { AdminRecord } from '../types/blade';

interface AdminManagementPageProps {
  currentAdmin: AdminRecord;
}

export function AdminManagementPage({ currentAdmin }: AdminManagementPageProps) {
  const { pushToast } = useToast();
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<AdminRecord['role']>('admin');
  const [submitting, setSubmitting] = useState(false);

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchBladeAdmins();
      setAdmins(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load administrators.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAdmins();
  }, [loadAdmins]);

  const handleGrantAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      await addBladeAdmin({ email, username, role });
      pushToast({
        title: 'Administrator granted',
        description: `${email} added to blade_admins.`,
        variant: 'success',
      });
      setEmail('');
      setUsername('');
      await loadAdmins();
    } catch (err) {
      pushToast({
        title: 'Unable to add administrator',
        description: err instanceof Error ? err.message : 'Operation denied.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (target: AdminRecord) => {
    try {
      await toggleBladeAdminActive(
        target.id,
        !target.isActive,
        currentAdmin.userId,
        target.userId
      );
      pushToast({
        title: !target.isActive ? 'Administrator activated' : 'Administrator deactivated',
        variant: 'success',
      });
      await loadAdmins();
    } catch (err) {
      pushToast({
        title: 'Status change failed',
        description: err instanceof Error ? err.message : 'Operation denied.',
        variant: 'error',
      });
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-zinc-950">ADMIN MANAGEMENT</h1>
        <p className="text-sm text-zinc-600 mt-0.5">
          Manage authorized BLADE administrators stored in <span className="font-mono">public.blade_admins</span>.
        </p>
      </div>

      {/* Add Admin Form */}
      <form
        onSubmit={handleGrantAdmin}
        className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4"
      >
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-950">
          <UserPlus className="w-4 h-4 text-red-600" />
          Authorize Existing Supabase Auth User as Admin
        </div>
        <p className="text-xs text-zinc-500">
          The target user must already exist in Supabase Authentication (auth.users). Normal Android
          users are never granted admin access automatically.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="User email address"
            className="sm:col-span-2 px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Admin username (optional)"
            className="px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AdminRecord['role'])}
            className="px-3 py-2 text-sm border border-zinc-300 rounded-md bg-white"
          >
            <option value="admin">Admin</option>
            <option value="moderator">Moderator</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold text-white bg-zinc-950 hover:bg-zinc-800 rounded-md disabled:opacity-50"
          >
            {submitting ? 'Authorizing…' : 'Authorize Admin'}
          </button>
        </div>
      </form>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        {loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                  <th className="py-3 px-4">Username</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Added</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-sm">
                {admins.map((a) => {
                  const isSelf = a.userId === currentAdmin.userId;
                  return (
                    <tr key={a.id} className="hover:bg-zinc-50">
                      <td className="py-3 px-4 font-semibold text-zinc-950">
                        <span className="inline-flex items-center gap-1.5">
                          <Shield className="w-3.5 h-3.5 text-red-600" />
                          {a.username}
                          {isSelf && <span className="text-xs text-zinc-400">(You)</span>}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-700">{a.email}</td>
                      <td className="py-3 px-4 font-mono text-xs text-zinc-700">{a.role}</td>
                      <td className="py-3 px-4 text-xs font-semibold">
                        {a.isActive ? (
                          <span className="text-emerald-700">Active</span>
                        ) : (
                          <span className="text-red-600">Inactive</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-500 tabular-nums">
                        {formatDateTime(a.createdAt)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          disabled={isSelf}
                          onClick={() => void handleToggle(a)}
                          className="px-3 py-1.5 text-xs font-semibold border border-zinc-300 rounded hover:bg-zinc-100 disabled:opacity-40"
                        >
                          {a.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
