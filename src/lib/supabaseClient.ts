import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AdminPanelPreferences, SupabaseConnectionConfig } from '../types/blade';

const STORAGE_CONFIG_KEY = 'blade_admin_supabase_config';
const STORAGE_PREFS_KEY = 'blade_admin_preferences';

let cachedClient: SupabaseClient | null = null;
let cachedKeySignature = '';

export const DEFAULT_PREFERENCES: AdminPanelPreferences = {
  videoBucket: 'videos',
  thumbnailBucket: 'thumbnails',
  avatarBucket: 'avatars',
  deletionStrategy: 'hard',
  storageQuotaGb: null,
};

export function getEnvSupabaseConfig(): SupabaseConnectionConfig {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
  const publishableKey =
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? '';
  return { url, publishableKey };
}

export function getSavedSupabaseConfig(): SupabaseConnectionConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SupabaseConnectionConfig>;
    if (typeof parsed.url === 'string' && typeof parsed.publishableKey === 'string') {
      const url = parsed.url.trim().replace(/\/+$/, '');
      const publishableKey = parsed.publishableKey.trim();
      if (url && publishableKey) {
        return { url, publishableKey };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function getActiveSupabaseConfig(): SupabaseConnectionConfig | null {
  const env = getEnvSupabaseConfig();
  if (env.url && env.publishableKey) {
    return {
      url: env.url.replace(/\/+$/, ''),
      publishableKey: env.publishableKey,
    };
  }
  return getSavedSupabaseConfig();
}

export function saveSupabaseConfig(config: SupabaseConnectionConfig): void {
  const normalized: SupabaseConnectionConfig = {
    url: config.url.trim().replace(/\/+$/, ''),
    publishableKey: config.publishableKey.trim(),
  };
  localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(normalized));
  cachedClient = null;
  cachedKeySignature = '';
}

export function clearSavedSupabaseConfig(): void {
  localStorage.removeItem(STORAGE_CONFIG_KEY);
  cachedClient = null;
  cachedKeySignature = '';
}

export function validateSupabaseInputs(url: string, publishableKey: string): string | null {
  const trimmedUrl = url.trim();
  const trimmedKey = publishableKey.trim();

  if (!trimmedUrl) return 'Supabase Project URL is required.';
  try {
    const parsed = new URL(trimmedUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'Supabase Project URL must start with https:// or http://.';
    }
  } catch {
    return 'Enter a valid Supabase Project URL (e.g. https://xxxx.supabase.co).';
  }

  if (!trimmedKey) return 'Supabase Publishable Key is required.';

  // Explicitly reject service_role keys if accidentally pasted by user
  if (trimmedKey.startsWith('sb_secret_')) {
    return 'Secret keys (sb_secret_*) are forbidden in the browser. Use only your Supabase Publishable Key.';
  }

  if (trimmedKey.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(trimmedKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role === 'service_role') {
        return 'service_role keys must NEVER be entered in frontend code. Use only the Publishable / anon key.';
      }
    } catch {
      // Ignore non-JSON JWT payloads
    }
  }

  return null;
}

export function getSupabaseClient(): SupabaseClient {
  const config = getActiveSupabaseConfig();
  if (!config) {
    throw new Error('Supabase connection is not configured.');
  }

  const signature = `${config.url}::${config.publishableKey}`;
  if (cachedClient && cachedKeySignature === signature) {
    return cachedClient;
  }

  cachedClient = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
  cachedKeySignature = signature;
  return cachedClient;
}

export function getPreferences(): AdminPanelPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_PREFS_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<AdminPanelPreferences>;
    const parsedQuota =
      typeof parsed.storageQuotaGb === 'number' &&
      Number.isFinite(parsed.storageQuotaGb) &&
      parsed.storageQuotaGb > 0
        ? parsed.storageQuotaGb
        : null;
    return {
      videoBucket: parsed.videoBucket?.trim() || DEFAULT_PREFERENCES.videoBucket,
      thumbnailBucket: parsed.thumbnailBucket?.trim() || DEFAULT_PREFERENCES.thumbnailBucket,
      avatarBucket: parsed.avatarBucket?.trim() || DEFAULT_PREFERENCES.avatarBucket,
      deletionStrategy: parsed.deletionStrategy === 'soft' ? 'soft' : 'hard',
      storageQuotaGb: parsedQuota,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: AdminPanelPreferences): void {
  localStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify(prefs));
}
