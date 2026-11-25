import { BadgeCheck, Ban, Clock, EyeOff, FileText, Globe, Lock, ShieldAlert, Users } from 'lucide-react';
import type { AccountStatus, VerificationState, VideoStatus, VideoVisibility } from '../../types/blade';

export function AccountStatusLabel({ status }: { status: AccountStatus }) {
  if (status === 'blocked') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 whitespace-nowrap">
        <Ban className="w-3.5 h-3.5" />
        Blocked
      </span>
    );
  }
  if (status === 'suspended') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap">
        <ShieldAlert className="w-3.5 h-3.5" />
        Suspended
      </span>
    );
  }
  if (status === 'deleted') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 whitespace-nowrap">
        Deleted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
      Active
    </span>
  );
}

export function VerificationLabel({ state }: { state: VerificationState }) {
  if (state === 'verified') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-950 whitespace-nowrap">
        <BadgeCheck className="w-3.5 h-3.5 text-red-600" />
        Verified
      </span>
    );
  }
  if (state === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5" />
        Pending
      </span>
    );
  }
  if (state === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 whitespace-nowrap">
        Rejected
      </span>
    );
  }
  if (state === 'revoked') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 whitespace-nowrap">
        Revoked
      </span>
    );
  }
  return <span className="text-xs text-zinc-500 whitespace-nowrap">Unverified</span>;
}

export function VideoStatusLabel({ status }: { status: VideoStatus }) {
  switch (status) {
    case 'published':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
          Published
        </span>
      );
    case 'draft':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 whitespace-nowrap">
          <FileText className="w-3.5 h-3.5" />
          Draft
        </span>
      );
    case 'hidden':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap">
          <EyeOff className="w-3.5 h-3.5" />
          Hidden
        </span>
      );
    case 'blocked':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 whitespace-nowrap">
          <Ban className="w-3.5 h-3.5" />
          Blocked
        </span>
      );
    case 'deleted':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 whitespace-nowrap">
          Deleted
        </span>
      );
  }
}

export function VisibilityLabel({ visibility }: { visibility: VideoVisibility }) {
  if (visibility === 'private') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-zinc-600 whitespace-nowrap">
        <Lock className="w-3 h-3" />
        Private
      </span>
    );
  }
  if (visibility === 'followers') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-zinc-600 whitespace-nowrap">
        <Users className="w-3 h-3" />
        Followers
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-600 whitespace-nowrap">
      <Globe className="w-3 h-3" />
      Public
    </span>
  );
}

export function UserPresenceLabel({ isOnline }: { isOnline: boolean }) {
  if (isOnline) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
        Online
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 whitespace-nowrap">
      <span className="w-2 h-2 rounded-full bg-zinc-300" aria-hidden="true" />
      Offline
    </span>
  );
}

