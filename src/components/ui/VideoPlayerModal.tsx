import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Eye, Heart, MessageSquare, User, X } from 'lucide-react';
import { formatCompactNumber, formatDateTime, isSafeHttpUrl } from '../../lib/formatters';
import { sendVideoWatchHeartbeat } from '../../services/adminApi';
import type { VideoRecord } from '../../types/blade';
import { VideoStatusLabel, VisibilityLabel } from './StatusText';

interface VideoPlayerModalProps {
  video: VideoRecord | null;
  onClose: () => void;
  onOpenOwner?: (ownerId: string) => void;
}

export function VideoPlayerModal({ video, onClose, onOpenOwner }: VideoPlayerModalProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const activeVideoRef = useRef<VideoRecord | null>(null);

  useEffect(() => {
    activeVideoRef.current = video;
    setIsPlaying(false);
  }, [video]);

  useEffect(() => {
    if (!video || !isPlaying) return;

    const vid = video.id;
    const title = video.caption || 'Untitled video';

    void sendVideoWatchHeartbeat({
      videoId: vid,
      videoTitle: title,
      isOnline: true,
      status: 'watching',
    }).catch(() => undefined);

    const interval = setInterval(() => {
      void sendVideoWatchHeartbeat({
        videoId: vid,
        videoTitle: title,
        isOnline: true,
        status: 'watching',
      }).catch(() => undefined);
    }, 20_000);

    const handleUnload = () => {
      void sendVideoWatchHeartbeat({
        videoId: vid,
        isOnline: false,
        status: 'offline',
      }).catch(() => undefined);
    };
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
      void sendVideoWatchHeartbeat({
        videoId: vid,
        isOnline: false,
        status: 'offline',
      }).catch(() => undefined);
    };
  }, [video, isPlaying]);

  if (!video) return null;
  const safeVideoUrl = isSafeHttpUrl(video.videoUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
      <div className="w-full max-w-4xl bg-white border border-zinc-200 rounded-lg overflow-hidden shadow-2xl grid grid-cols-1 md:grid-cols-2">
        <div className="bg-black flex items-center justify-center min-h-[360px] max-h-[80vh]">
          {safeVideoUrl ? (
            <video
              src={safeVideoUrl}
              poster={isSafeHttpUrl(video.thumbnailUrl) ?? undefined}
              controls
              autoPlay
              playsInline
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              className="w-full h-full max-h-[80vh] object-contain"
            />
          ) : (
            <div className="text-zinc-400 text-sm p-6 text-center">
              Video stream URL is unavailable or invalid.
            </div>
          )}
        </div>

        <div className="p-6 flex flex-col justify-between max-h-[80vh] overflow-y-auto">
          <div>
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-zinc-200">
              <div>
                <h3 className="text-base font-bold text-zinc-950">Video Details</h3>
                <p className="text-xs text-zinc-500 font-mono mt-0.5">{video.id}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 transition-colors"
                aria-label="Close video preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 text-xs text-zinc-600">
                  <VideoStatusLabel status={video.status} />
                  <span aria-hidden="true">·</span>
                  <VisibilityLabel visibility={video.visibility} />
                  {video.categoryName && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{video.categoryName}</span>
                    </>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-zinc-500">Caption</div>
                <p className="text-sm font-medium text-zinc-950 mt-1">
                  {video.caption || 'No caption'}
                </p>
              </div>

              {video.description && (
                <div>
                  <div className="text-xs font-medium text-zinc-500">Description</div>
                  <p className="text-sm text-zinc-700 mt-1 whitespace-pre-wrap">
                    {video.description}
                  </p>
                </div>
              )}

              {video.hashtags.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-zinc-500">Hashtags</div>
                  <p className="text-xs font-mono text-zinc-700 mt-1">
                    {video.hashtags.join(' ')}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 py-3 border-y border-zinc-200">
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <Eye className="w-3.5 h-3.5" /> Views
                  </div>
                  <div className="text-base font-bold text-zinc-950 tabular-nums mt-0.5">
                    {formatCompactNumber(video.viewsCount)}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <Heart className="w-3.5 h-3.5" /> Likes
                  </div>
                  <div className="text-base font-bold text-zinc-950 tabular-nums mt-0.5">
                    {formatCompactNumber(video.likesCount)}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <MessageSquare className="w-3.5 h-3.5" /> Comments
                  </div>
                  <div className="text-base font-bold text-zinc-950 tabular-nums mt-0.5">
                    {formatCompactNumber(video.commentsCount)}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-zinc-500">Owner</div>
                <div className="flex items-center justify-between gap-3 mt-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span className="text-sm font-semibold text-zinc-950 truncate">
                      {video.ownerUsername ? `@${video.ownerUsername}` : video.ownerName || video.ownerId}
                    </span>
                  </div>
                  {onOpenOwner && video.ownerId && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenOwner(video.ownerId);
                      }}
                      className="text-xs font-semibold text-red-600 hover:text-red-700 whitespace-nowrap"
                    >
                      Open profile
                    </button>
                  )}
                </div>
              </div>

              <div className="text-xs text-zinc-500">
                Uploaded {formatDateTime(video.createdAt)}
              </div>
            </div>
          </div>

          {safeVideoUrl && (
            <div className="pt-4 mt-4 border-t border-zinc-200 flex justify-end">
              <a
                href={safeVideoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-950"
              >
                Open media URL <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
