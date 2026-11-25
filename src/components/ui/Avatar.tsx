import { useState } from 'react';
import { isSafeHttpUrl } from '../../lib/formatters';

interface AvatarProps {
  src?: string | null;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Avatar({ src, name = '', size = 'md' }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const safeSrc = isSafeHttpUrl(src);

  const dims =
    size === 'sm'
      ? 'w-7 h-7 text-[11px]'
      : size === 'lg'
      ? 'w-14 h-14 text-lg'
      : 'w-9 h-9 text-xs';

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?';

  if (safeSrc && !failed) {
    return (
      <img
        src={safeSrc}
        alt={name || 'User avatar'}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${dims} rounded-md object-cover border border-zinc-200 shrink-0 bg-zinc-100`}
      />
    );
  }

  return (
    <div
      className={`${dims} rounded-md bg-zinc-950 text-white font-semibold flex items-center justify-center shrink-0 border border-zinc-800 select-none`}
      aria-label={name || 'User avatar'}
    >
      {initials}
    </div>
  );
}
