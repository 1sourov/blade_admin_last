import React, { useEffect, useState } from 'react';
import { Upload, UserPlus, X } from 'lucide-react';
import { Avatar } from './ui/Avatar';
import { useToast } from './ui/ToastProvider';
import { createAdminUser } from '../services/adminApi';
import type { AppUser, SchemaInspectionResult } from '../types/blade';

interface AddUserModalProps {
  open: boolean;
  schema: SchemaInspectionResult;
  onClose: () => void;
  onCreated: (user: AppUser) => void;
}

export function AddUserModal({ open, schema, onClose, onCreated }: AddUserModalProps) {
  const { pushToast } = useToast();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [bio, setBio] = useState('');
  const [accountStatus, setAccountStatus] = useState<'active' | 'blocked' | 'suspended'>('active');
  const [verificationStatus, setVerificationStatus] = useState<
    'unverified' | 'pending' | 'verified'
  >('unverified');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFullName('');
    setUsername('');
    setEmail('');
    setPhone('');
    setAvatarUrl('');
    setAvatarFile(null);
    setAvatarPreview('');
    setBio('');
    setAccountStatus('active');
    setVerificationStatus('unverified');
    setPassword('');
    setErrorMsg(null);
  }, [open]);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(avatarUrl.trim());
      return;
    }
    const objUrl = URL.createObjectURL(avatarFile);
    setAvatarPreview(objUrl);
    return () => URL.revokeObjectURL(objUrl);
  }, [avatarFile, avatarUrl]);

  if (!open) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Profile photo must be an image file (PNG, JPG, WebP).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Profile photo must be smaller than 5 MB.');
      return;
    }
    setErrorMsg(null);
    setAvatarFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!fullName.trim()) {
      setErrorMsg('Full Name is required.');
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMsg('Please enter a valid Email address.');
      return;
    }
    const phoneDigits = phone.replace(/\D/g, '');
    if (!phone.trim() || phoneDigits.length < 7) {
      setErrorMsg('Please enter a valid Phone Number (at least 7 digits).');
      return;
    }
    const cleanUsername = username.trim().replace(/^@+/, '');
    if (cleanUsername && !/^[a-z0-9._-]{2,32}$/i.test(cleanUsername)) {
      setErrorMsg('Username must be 2–32 characters (letters, numbers, ".", "_", or "-").');
      return;
    }
    if (password.trim() && password.trim().length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createAdminUser(schema, {
        fullName,
        username: cleanUsername || undefined,
        email,
        phone,
        avatarFile,
        avatarUrl,
        bio,
        accountStatus,
        verificationStatus,
        password: password.trim() || undefined,
      });
      pushToast({
        title: 'User created successfully',
        description: `${created.name || created.email} added to Supabase database.`,
        variant: 'success',
      });
      onCreated(created);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create user.';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65">
      <div className="w-full max-w-xl bg-white border border-zinc-200 rounded-lg shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 bg-zinc-950 text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <UserPlus className="w-4 h-4 text-red-500" />
            <div>
              <h3 className="text-base font-bold">Add New User</h3>
              <p className="text-[11px] text-zinc-400">
                Creates a real Supabase Auth &amp;{' '}
                <span className="font-mono">{schema.users?.table ?? 'profiles'}</span> account
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1 text-zinc-400 hover:text-white rounded transition-colors"
            aria-label="Close Add User modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {errorMsg && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs font-medium text-red-700">
              {errorMsg}
            </div>
          )}

          {/* Profile Photo */}
          <div className="flex items-center gap-4 pb-3 border-b border-zinc-200">
            <Avatar src={avatarPreview} name={fullName || email || 'U'} size="lg" />
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-zinc-900 bg-zinc-100 hover:bg-zinc-200 rounded-md cursor-pointer transition-colors">
                  <Upload className="w-3.5 h-3.5" />
                  {avatarFile ? 'Change Photo' : 'Upload Photo'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                {avatarFile && (
                  <button
                    type="button"
                    onClick={() => setAvatarFile(null)}
                    className="text-xs text-zinc-500 hover:text-red-600"
                  >
                    Remove file
                  </button>
                )}
              </div>
              <input
                type="url"
                value={avatarUrl}
                onChange={(e) => {
                  setAvatarFile(null);
                  setAvatarUrl(e.target.value);
                }}
                placeholder="Or paste profile photo URL (https://...)"
                className="w-full px-3 py-1.5 text-xs border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-900 mb-1">
                Full Name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Aarav Sharma"
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-900 mb-1">
                Username <span className="text-zinc-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. aarav_blade"
                className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-900 mb-1">
                Email <span className="text-red-600">*</span>
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-900 mb-1">
                Phone Number <span className="text-red-600">*</span>
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-900 mb-1">User Status</label>
              <select
                value={accountStatus}
                onChange={(e) => setAccountStatus(e.target.value as typeof accountStatus)}
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-900 mb-1">
                Verification Status
              </label>
              <select
                value={verificationStatus}
                onChange={(e) =>
                  setVerificationStatus(e.target.value as typeof verificationStatus)
                }
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
              >
                <option value="unverified">Unverified</option>
                <option value="pending">Pending</option>
                <option value="verified">Verified</option>
              </select>
            </div>
          </div>

          {schema.users?.bioCol && (
            <div>
              <label className="block text-xs font-semibold text-zinc-900 mb-1">
                Bio <span className="text-zinc-400 font-normal">(optional)</span>
              </label>
              <textarea
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Creator bio…"
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-zinc-900 mb-1">
              Initial Password <span className="text-zinc-400 font-normal">(optional)</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to auto-generate a secure password"
              className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-200">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-md hover:bg-zinc-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              {submitting ? 'Creating User…' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
