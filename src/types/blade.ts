export type NavSection =
  | 'dashboard'
  | 'users'
  | 'user-details'
  | 'videos'
  | 'upload-video'
  | 'verification'
  | 'reports'
  | 'comments'
  | 'categories'
  | 'storage'
  | 'analytics'
  | 'admins'
  | 'settings';

export type DeletionStrategy = 'soft' | 'hard';

export interface SupabaseConnectionConfig {
  url: string;
  publishableKey: string;
}

export interface AdminPanelPreferences {
  videoBucket: string;
  thumbnailBucket: string;
  avatarBucket: string;
  deletionStrategy: DeletionStrategy;
  storageQuotaGb: number | null;
}

export interface TableColumnInfo {
  name: string;
  type: string;
  format?: string;
  required?: boolean;
}

export interface InspectedTable {
  name: string;
  columns: Record<string, TableColumnInfo>;
}

export interface UserTableMapping {
  table: string;
  idCol: string;
  nameCol: string | null;
  usernameCol: string | null;
  emailCol: string | null;
  phoneCol: string | null;
  avatarCol: string | null;
  bioCol: string | null;
  verifiedCol: string | null;
  verificationStatusCol: string | null;
  statusCol: string | null;
  blockedCol: string | null;
  suspendedCol: string | null;
  followersCountCol: string | null;
  followingCountCol: string | null;
  videosCountCol: string | null;
  viewsCountCol: string | null;
  createdAtCol: string | null;
  lastActiveCol: string | null;
  onlineCol: string | null;
}

export interface VideoTableMapping {
  table: string;
  idCol: string;
  ownerIdCol: string;
  videoUrlCol: string | null;
  storagePathCol: string | null;
  thumbnailUrlCol: string | null;
  thumbnailPathCol: string | null;
  captionCol: string | null;
  descriptionCol: string | null;
  hashtagsCol: string | null;
  categoryIdCol: string | null;
  categoryNameCol: string | null;
  statusCol: string | null;
  isHiddenCol: string | null;
  isBlockedCol: string | null;
  visibilityCol: string | null;
  viewsCol: string | null;
  likesCol: string | null;
  commentsCol: string | null;
  durationCol: string | null;
  createdAtCol: string | null;
}

export interface CategoryTableMapping {
  table: string;
  idCol: string;
  nameCol: string;
  slugCol: string | null;
  descriptionCol: string | null;
  enabledCol: string | null;
  sortOrderCol: string | null;
  createdAtCol: string | null;
}

export interface CommentTableMapping {
  table: string;
  idCol: string;
  videoIdCol: string;
  userIdCol: string;
  contentCol: string;
  createdAtCol: string | null;
}

export interface ReportTableMapping {
  table: string;
  idCol: string;
  reporterIdCol: string | null;
  reportedUserIdCol: string | null;
  reportedVideoIdCol: string | null;
  reasonCol: string | null;
  detailsCol: string | null;
  statusCol: string | null;
  createdAtCol: string | null;
  resolvedAtCol: string | null;
}

export interface VerificationTableMapping {
  table: string;
  idCol: string;
  userIdCol: string;
  statusCol: string;
  noteCol: string | null;
  documentUrlCol: string | null;
  createdAtCol: string | null;
  reviewedAtCol: string | null;
}

export interface SchemaInspectionResult {
  inspectedAt: string;
  rawTables: Record<string, InspectedTable>;
  rawRpcs: string[];
  hasAdminTable: boolean;
  hasSetupStatusRpc: boolean;
  hasBootstrapRpc: boolean;
  hasStorageStatsRpc: boolean;
  users: UserTableMapping | null;
  videos: VideoTableMapping | null;
  categories: CategoryTableMapping | null;
  comments: CommentTableMapping | null;
  reports: ReportTableMapping | null;
  verifications: VerificationTableMapping | null;
  likesTable: string | null;
  followersTable: string | null;
  notificationsTable: string | null;
  presenceTable: string | null;
  migrationVersion?: number;
  missingCapabilities: string[];
}

export type AccountStatus = 'active' | 'blocked' | 'suspended' | 'deleted';
export type VerificationState = 'unverified' | 'pending' | 'verified' | 'rejected' | 'revoked';
export type VideoStatus = 'draft' | 'published' | 'hidden' | 'blocked' | 'deleted';
export type VideoVisibility = 'public' | 'followers' | 'private';

export interface AppUser {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  avatarUrl: string;
  bio: string;
  isVerified: boolean;
  verificationStatus: VerificationState;
  accountStatus: AccountStatus;
  followersCount: number;
  followingCount: number;
  videoCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  joinedAt: string | null;
  lastActiveAt: string | null;
  isOnline: boolean;
  raw: Record<string, unknown>;
}

export interface VideoRecord {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerUsername: string;
  ownerAvatarUrl: string;
  ownerVerified: boolean;
  videoUrl: string;
  storagePath: string;
  thumbnailUrl: string;
  thumbnailPath: string;
  caption: string;
  description: string;
  hashtags: string[];
  categoryId: string | null;
  categoryName: string;
  status: VideoStatus;
  visibility: VideoVisibility;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  durationSeconds: number | null;
  createdAt: string | null;
  raw: Record<string, unknown>;
}

export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
  isEnabled: boolean;
  sortOrder: number;
  videoCount: number | null;
  createdAt: string | null;
}

export interface CommentRecord {
  id: string;
  videoId: string;
  videoCaption: string;
  videoThumbnailUrl: string;
  userId: string;
  userName: string;
  userUsername: string;
  userAvatarUrl: string;
  content: string;
  createdAt: string | null;
}

export interface ReportRecord {
  id: string;
  reporterId: string | null;
  reporterUsername: string;
  reportedUserId: string | null;
  reportedUsername: string;
  reportedVideoId: string | null;
  reportedVideoCaption: string;
  reason: string;
  details: string;
  status: 'pending' | 'reviewing' | 'resolved' | 'rejected';
  createdAt: string | null;
  resolvedAt: string | null;
}

export interface VerificationRequestRecord {
  id: string;
  userId: string;
  userName: string;
  userUsername: string;
  userEmail: string;
  userAvatarUrl: string;
  followersCount: number;
  videoCount: number;
  status: VerificationState;
  note: string;
  documentUrl: string;
  createdAt: string | null;
  reviewedAt: string | null;
}

export interface AdminRecord {
  id: string;
  userId: string;
  email: string;
  username: string;
  role: 'super_admin' | 'admin' | 'moderator';
  isActive: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
}

export interface StorageBucketSummary {
  name: string;
  isPublic: boolean;
  fileCount: number | null;
  bytesUsed: number | null;
}

export interface StorageObjectItem {
  id: string;
  bucket: string;
  name: string;
  path: string;
  sizeBytes: number | null;
  mimeType: string;
  createdAt: string | null;
  updatedAt: string | null;
  publicUrl: string | null;
}

export interface StorageStats {
  available: boolean;
  totalBytesUsed: number | null;
  totalBytesQuota: number | null;
  quotaIsDefault?: boolean;
  videoBytesUsed: number | null;
  imageBytesUsed: number | null;
  otherBytesUsed: number | null;
  fileCount: number | null;
  buckets: StorageBucketSummary[];
  unavailableReason?: string;
}

export interface ActiveUserSession {
  userId: string;
  userName: string;
  username: string;
  avatarUrl: string;
  currentVideoId: string | null;
  currentVideoTitle: string | null;
  sessionStartedAt: string | null;
  lastActiveAt: string | null;
  status: 'watching' | 'online' | 'idle' | 'offline';
  device: string;
  platform: string;
}

export interface DashboardMetrics {
  totalUsers: number | null;
  liveActiveUsers: number | null;
  liveUserIds?: string[];
  liveSessions?: ActiveUserSession[];
  activeUsersToday: number | null;
  activeUsers7d: number | null;
  offlineUsers: number | null;
  newUsersToday: number | null;
  verifiedUsers: number | null;
  blockedUsers: number | null;
  totalVideos: number | null;
  videosUploadedToday: number | null;
  totalViews: number | null;
  totalLikes: number | null;
  totalComments: number | null;
  totalFollowers: number | null;
  pendingVerifications: number | null;
  storage: StorageStats;
}

export interface TimeSeriesPoint {
  date: string;
  label: string;
  users: number;
  videos: number;
  views: number;
  engagement: number;
  activeUsers: number;
}
