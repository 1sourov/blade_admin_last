-- ============================================================================
-- BLADE ADMIN PANEL — Canonical Non-Destructive Supabase Migration
-- Safe to run on an existing Android short-video Supabase database.
-- Inspects/reuses existing tables and uses ADD COLUMN IF NOT EXISTS.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.blade_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  username text NOT NULL,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'moderator')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.blade_admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_blade_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.blade_admins
    WHERE user_id = auth.uid()
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.check_admin_setup_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'has_admin', EXISTS (SELECT 1 FROM public.blade_admins WHERE is_active = true)
  );
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(p_username text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_clean_username text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication session required to create first admin.';
  END IF;

  PERFORM pg_advisory_xact_lock(928374651);

  IF EXISTS (SELECT 1 FROM public.blade_admins) THEN
    RAISE EXCEPTION 'Admin account already exists. Normal users cannot self-promote.';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Authenticated user record not found.';
  END IF;

  v_clean_username := COALESCE(NULLIF(trim(p_username), ''), split_part(v_email, '@', 1));

  INSERT INTO public.blade_admins (user_id, email, username, role, is_active)
  VALUES (v_uid, v_email, v_clean_username, 'super_admin', true);

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_uid,
    'email', v_email,
    'username', v_clean_username,
    'role', 'super_admin'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_admin_login_email(p_identifier text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email
  FROM public.blade_admins
  WHERE is_active = true
    AND (lower(email) = lower(trim(p_identifier)) OR lower(username) = lower(trim(p_identifier)))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.add_blade_admin_by_email(
  p_email text,
  p_username text DEFAULT NULL,
  p_role text DEFAULT 'admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_target_uid uuid;
  v_clean_role text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.blade_admins
    WHERE user_id = auth.uid() AND is_active = true AND role IN ('super_admin', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only active admins can add administrators.';
  END IF;

  v_clean_role := CASE WHEN p_role IN ('super_admin', 'admin', 'moderator') THEN p_role ELSE 'admin' END;

  SELECT id INTO v_target_uid FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  IF v_target_uid IS NULL THEN
    RAISE EXCEPTION 'No Supabase Auth user found with email %', p_email;
  END IF;

  INSERT INTO public.blade_admins (user_id, email, username, role, is_active)
  VALUES (
    v_target_uid,
    lower(trim(p_email)),
    COALESCE(NULLIF(trim(p_username), ''), split_part(lower(trim(p_email)), '@', 1)),
    v_clean_role,
    true
  )
  ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role,
        is_active = true,
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'user_id', v_target_uid, 'email', lower(trim(p_email)));
END;
$$;

CREATE OR REPLACE FUNCTION public.inspect_blade_schema()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, information_schema, pg_catalog
AS $$
DECLARE
  v_tables jsonb;
  v_rpcs jsonb;
BEGIN
  IF NOT public.is_blade_admin() THEN
    RAISE EXCEPTION 'Admin privileges required.';
  END IF;

  SELECT COALESCE(jsonb_object_agg(t.table_name, t.cols), '{}'::jsonb)
  INTO v_tables
  FROM (
    SELECT
      c.table_name,
      jsonb_agg(jsonb_build_object('name', c.column_name, 'type', c.data_type) ORDER BY c.ordinal_position) AS cols
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND tb.table_type = 'BASE TABLE'
    GROUP BY c.table_name
  ) t;

  SELECT COALESCE(jsonb_agg(p.proname), '[]'::jsonb)
  INTO v_rpcs
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public';

  RETURN jsonb_build_object('tables', v_tables, 'rpcs', v_rpcs);
END;
$$;

DROP POLICY IF EXISTS "blade_admins_read_own_or_admin" ON public.blade_admins;
CREATE POLICY "blade_admins_read_own_or_admin"
  ON public.blade_admins FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_blade_admin());

DROP POLICY IF EXISTS "blade_admins_manage_by_admin" ON public.blade_admins;
CREATE POLICY "blade_admins_manage_by_admin"
  ON public.blade_admins FOR ALL TO authenticated
  USING (public.is_blade_admin())
  WITH CHECK (public.is_blade_admin());

CREATE TABLE IF NOT EXISTS public.blade_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.blade_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blade_settings_admin_all" ON public.blade_settings;
CREATE POLICY "blade_settings_admin_all"
  ON public.blade_settings FOR ALL TO authenticated
  USING (public.is_blade_admin())
  WITH CHECK (public.is_blade_admin());

CREATE OR REPLACE FUNCTION public.admin_set_storage_quota(p_quota_bytes bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_blade_admin() THEN
    RAISE EXCEPTION 'Admin privileges required.';
  END IF;

  IF p_quota_bytes IS NULL OR p_quota_bytes <= 0 THEN
    DELETE FROM public.blade_settings WHERE key = 'storage_quota_bytes';
    RETURN jsonb_build_object('ok', true, 'quota_bytes', NULL);
  END IF;

  INSERT INTO public.blade_settings (key, value, updated_at)
  VALUES ('storage_quota_bytes', to_jsonb(p_quota_bytes), now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'quota_bytes', p_quota_bytes);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_blade_storage_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_total_bytes bigint := 0;
  v_file_count bigint := 0;
  v_video_bytes bigint := 0;
  v_image_bytes bigint := 0;
  v_buckets jsonb := '[]'::jsonb;
  v_configured_quota bigint := NULL;
  v_effective_quota bigint := 1073741824;
  v_quota_is_default boolean := true;
BEGIN
  IF NOT public.is_blade_admin() THEN
    RAISE EXCEPTION 'Admin privileges required.';
  END IF;

  SELECT
    COALESCE(SUM((o.metadata->>'size')::bigint), 0),
    COUNT(o.id),
    COALESCE(SUM(CASE WHEN COALESCE(o.metadata->>'mimetype', '') LIKE 'video/%' OR o.bucket_id ILIKE '%video%' THEN (o.metadata->>'size')::bigint ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN COALESCE(o.metadata->>'mimetype', '') LIKE 'image/%' OR o.bucket_id ILIKE '%thumb%' OR o.bucket_id ILIKE '%avatar%' THEN (o.metadata->>'size')::bigint ELSE 0 END), 0)
  INTO v_total_bytes, v_file_count, v_video_bytes, v_image_bytes
  FROM storage.objects o;

  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'name', b.id,
      'is_public', b.public,
      'file_count', COALESCE(agg.cnt, 0),
      'bytes_used', COALESCE(agg.sz, 0)
    ))
    FROM storage.buckets b
    LEFT JOIN (
      SELECT bucket_id, COUNT(*) AS cnt, COALESCE(SUM((metadata->>'size')::bigint), 0) AS sz
      FROM storage.objects
      GROUP BY bucket_id
    ) agg ON agg.bucket_id = b.id
  ), '[]'::jsonb)
  INTO v_buckets;

  BEGIN
    SELECT NULLIF((value #>> '{}')::bigint, 0)
    INTO v_configured_quota
    FROM public.blade_settings
    WHERE key = 'storage_quota_bytes'
    LIMIT 1;
  EXCEPTION WHEN others THEN
    v_configured_quota := NULL;
  END;

  IF v_configured_quota IS NOT NULL AND v_configured_quota > 0 THEN
    v_effective_quota := v_configured_quota;
    v_quota_is_default := false;
  ELSIF v_total_bytes > 1073741824 THEN
    v_effective_quota := 107374182400;
    v_quota_is_default := true;
  ELSE
    v_effective_quota := 1073741824;
    v_quota_is_default := true;
  END IF;

  RETURN jsonb_build_object(
    'total_bytes', v_total_bytes,
    'quota_bytes', v_effective_quota,
    'available_bytes', GREATEST(0::bigint, v_effective_quota - v_total_bytes),
    'quota_is_default', v_quota_is_default,
    'file_count', v_file_count,
    'video_bytes', v_video_bytes,
    'image_bytes', v_image_bytes,
    'buckets', v_buckets
  );
END;
$$;

CREATE TABLE IF NOT EXISTS public.user_presence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  current_video_id text,
  current_video_title text,
  status text NOT NULL DEFAULT 'online',
  is_online boolean NOT NULL DEFAULT true,
  device text,
  platform text,
  session_started_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS current_video_id text;
ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS current_video_title text;
ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'online';
ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT true;
ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS device text;
ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS session_started_at timestamptz DEFAULT now();
ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS last_active_at timestamptz DEFAULT now();
ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.user_presence ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.user_presence ALTER COLUMN id SET DEFAULT gen_random_uuid();
  EXCEPTION WHEN others THEN
    NULL;
  END;
  BEGIN
    UPDATE public.user_presence SET user_id = id WHERE user_id IS NULL;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

DELETE FROM public.user_presence a
USING public.user_presence b
WHERE a.user_id IS NOT NULL
  AND a.user_id = b.user_id
  AND (
    COALESCE(a.last_active_at, a.updated_at, a.created_at, '-infinity'::timestamptz)
      < COALESCE(b.last_active_at, b.updated_at, b.created_at, '-infinity'::timestamptz)
    OR (
      COALESCE(a.last_active_at, a.updated_at, a.created_at, '-infinity'::timestamptz)
        = COALESCE(b.last_active_at, b.updated_at, b.created_at, '-infinity'::timestamptz)
      AND a.ctid < b.ctid
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_blade_user_presence_unique_user
  ON public.user_presence(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_blade_user_presence_live
  ON public.user_presence(is_online, last_active_at DESC);

CREATE OR REPLACE FUNCTION public.get_blade_migration_version()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 6;
$$;

CREATE OR REPLACE FUNCTION public.blade_safe_ts(p_val text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_val IS NULL OR trim(p_val) = '' THEN
    RETURN NULL;
  END IF;
  RETURN p_val::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.blade_extract_latest_ts(p_row jsonb)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(GREATEST(
    COALESCE(public.blade_safe_ts(p_row->>'last_active_at'), '-infinity'::timestamptz),
    COALESCE(public.blade_safe_ts(p_row->>'last_seen_at'), '-infinity'::timestamptz),
    COALESCE(public.blade_safe_ts(p_row->>'last_heartbeat_at'), '-infinity'::timestamptz),
    COALESCE(public.blade_safe_ts(p_row->>'last_online_at'), '-infinity'::timestamptz),
    COALESCE(public.blade_safe_ts(p_row->>'last_activity_at'), '-infinity'::timestamptz),
    COALESCE(public.blade_safe_ts(p_row->>'last_seen'), '-infinity'::timestamptz),
    COALESCE(public.blade_safe_ts(p_row->>'last_active'), '-infinity'::timestamptz),
    COALESCE(public.blade_safe_ts(p_row->>'seen_at'), '-infinity'::timestamptz),
    COALESCE(public.blade_safe_ts(p_row->>'online_at'), '-infinity'::timestamptz)
  ), '-infinity'::timestamptz);
$$;

DROP FUNCTION IF EXISTS public.blade_get_presence_rows();
CREATE OR REPLACE FUNCTION public.blade_get_presence_rows()
RETURNS TABLE(
  uid text,
  ts timestamptz,
  is_online boolean,
  current_video_id text,
  current_video_title text,
  session_started_at timestamptz,
  status text,
  device text,
  platform text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
  pt_candidates text[] := ARRAY['user_presence', 'active_users', 'user_sessions', 'online_users', 'presence'];
BEGIN
  FOREACH t IN ARRAY pt_candidates
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      RETURN QUERY EXECUTE format($q$
        SELECT
          COALESCE(
            NULLIF(to_jsonb(p)->>'user_id', ''),
            NULLIF(to_jsonb(p)->>'profile_id', ''),
            NULLIF(to_jsonb(p)->>'uid', ''),
            NULLIF(to_jsonb(p)->>'id', '')
          ) AS uid,
          COALESCE(
            public.blade_extract_latest_ts(to_jsonb(p)),
            public.blade_safe_ts(to_jsonb(p)->>'updated_at'),
            public.blade_safe_ts(to_jsonb(p)->>'created_at')
          ) AS ts,
          lower(COALESCE(to_jsonb(p)->>'is_online', to_jsonb(p)->>'online', 'true')) IN ('true', 't', '1', 'yes') AS is_online,
          COALESCE(
            NULLIF(to_jsonb(p)->>'current_video_id', ''),
            NULLIF(to_jsonb(p)->>'video_id', ''),
            NULLIF(to_jsonb(p)->>'watching_video_id', '')
          ) AS current_video_id,
          COALESCE(
            NULLIF(to_jsonb(p)->>'current_video_title', ''),
            NULLIF(to_jsonb(p)->>'video_title', '')
          ) AS current_video_title,
          COALESCE(
            public.blade_safe_ts(to_jsonb(p)->>'session_started_at'),
            public.blade_safe_ts(to_jsonb(p)->>'started_at'),
            public.blade_safe_ts(to_jsonb(p)->>'created_at')
          ) AS session_started_at,
          COALESCE(
            NULLIF(to_jsonb(p)->>'status', ''),
            CASE
              WHEN COALESCE(NULLIF(to_jsonb(p)->>'current_video_id', ''), NULLIF(to_jsonb(p)->>'video_id', '')) IS NOT NULL
              THEN 'watching'
              ELSE 'online'
            END
          ) AS status,
          COALESCE(
            NULLIF(to_jsonb(p)->>'device', ''),
            NULLIF(to_jsonb(p)->>'device_name', ''),
            NULLIF(to_jsonb(p)->>'device_model', '')
          ) AS device,
          COALESCE(
            NULLIF(to_jsonb(p)->>'platform', ''),
            NULLIF(to_jsonb(p)->>'os', '')
          ) AS platform
        FROM public.%I p
      $q$, t);
    END IF;
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.user_heartbeat(boolean);
CREATE OR REPLACE FUNCTION public.user_heartbeat(
  p_is_online boolean DEFAULT true,
  p_video_id text DEFAULT NULL,
  p_video_title text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_device text DEFAULT NULL,
  p_platform text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_online boolean := COALESCE(p_is_online, true);
  v_vid text := NULLIF(trim(COALESCE(p_video_id, '')), '');
  v_vtitle text := NULLIF(trim(COALESCE(p_video_title, '')), '');
  v_device text := NULLIF(trim(COALESCE(p_device, '')), '');
  v_platform text := NULLIF(trim(COALESCE(p_platform, '')), '');
  v_status text;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required for heartbeat.';
  END IF;

  IF v_online AND v_vid IS NOT NULL AND v_vtitle IS NULL THEN
    BEGIN
      SELECT NULLIF(trim(COALESCE(to_jsonb(v)->>'caption', to_jsonb(v)->>'title', '')), '')
      INTO v_vtitle
      FROM public.videos v
      WHERE v.id::text = v_vid
      LIMIT 1;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  v_status := CASE
    WHEN NOT v_online THEN 'offline'
    WHEN NULLIF(trim(COALESCE(p_status, '')), '') IS NOT NULL THEN lower(trim(p_status))
    WHEN v_vid IS NOT NULL THEN 'watching'
    ELSE 'online'
  END;

  IF v_online THEN
    UPDATE public.profiles u
    SET last_active_at = v_now,
        is_online = true
    WHERE u.id::text = v_uid::text
       OR COALESCE(to_jsonb(u)->>'user_id', '') = v_uid::text;

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.profiles (id, last_active_at, is_online)
        VALUES (v_uid, v_now, true)
        ON CONFLICT (id) DO UPDATE
          SET last_active_at = v_now,
              is_online = true;
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;

    UPDATE public.user_presence p
    SET
      user_id = COALESCE(p.user_id, v_uid),
      is_online = true,
      status = v_status,
      current_video_id = COALESCE(v_vid, CASE WHEN v_status = 'watching' THEN p.current_video_id ELSE NULL END),
      current_video_title = COALESCE(v_vtitle, CASE WHEN v_vid IS NULL AND v_status <> 'watching' THEN NULL ELSE p.current_video_title END),
      device = COALESCE(v_device, p.device),
      platform = COALESCE(v_platform, p.platform),
      session_started_at = CASE
        WHEN p.is_online = true
             AND p.ended_at IS NULL
             AND COALESCE(p.last_active_at, p.updated_at, p.created_at, '-infinity'::timestamptz) >= v_now - interval '2 minutes'
        THEN COALESCE(p.session_started_at, v_now)
        ELSE v_now
      END,
      last_active_at = v_now,
      ended_at = NULL,
      updated_at = v_now
    WHERE p.user_id = v_uid OR p.id::text = v_uid::text;

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.user_presence (
          user_id, current_video_id, current_video_title, status, is_online,
          device, platform, session_started_at, last_active_at, ended_at, updated_at
        )
        VALUES (
          v_uid, v_vid, v_vtitle, v_status, true,
          v_device, v_platform, v_now, v_now, NULL, v_now
        );
      EXCEPTION WHEN unique_violation THEN
        UPDATE public.user_presence
        SET
          is_online = true,
          status = v_status,
          current_video_id = COALESCE(v_vid, current_video_id),
          current_video_title = COALESCE(v_vtitle, current_video_title),
          device = COALESCE(v_device, device),
          platform = COALESCE(v_platform, platform),
          last_active_at = v_now,
          ended_at = NULL,
          updated_at = v_now
        WHERE user_id = v_uid;
      WHEN others THEN
        INSERT INTO public.user_presence (
          id, user_id, current_video_id, current_video_title, status, is_online,
          device, platform, session_started_at, last_active_at, ended_at, updated_at
        )
        VALUES (
          v_uid, v_uid, v_vid, v_vtitle, v_status, true,
          v_device, v_platform, v_now, v_now, NULL, v_now
        )
        ON CONFLICT (id) DO UPDATE SET
          user_id = v_uid,
          is_online = true,
          status = EXCLUDED.status,
          current_video_id = COALESCE(EXCLUDED.current_video_id, public.user_presence.current_video_id),
          current_video_title = COALESCE(EXCLUDED.current_video_title, public.user_presence.current_video_title),
          device = COALESCE(EXCLUDED.device, public.user_presence.device),
          platform = COALESCE(EXCLUDED.platform, public.user_presence.platform),
          last_active_at = v_now,
          ended_at = NULL,
          updated_at = v_now;
      END;
    END IF;
  ELSE
    UPDATE public.profiles u
    SET is_online = false
    WHERE u.id::text = v_uid::text
       OR COALESCE(to_jsonb(u)->>'user_id', '') = v_uid::text;

    UPDATE public.user_presence p
    SET
      is_online = false,
      status = 'offline',
      current_video_id = NULL,
      current_video_title = NULL,
      ended_at = v_now,
      updated_at = v_now
    WHERE p.user_id = v_uid OR p.id::text = v_uid::text;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_uid,
    'is_online', v_online,
    'status', v_status,
    'current_video_id', v_vid,
    'ts', v_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_video_watch_session(
  p_video_id text,
  p_video_title text DEFAULT NULL,
  p_device text DEFAULT NULL,
  p_platform text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_heartbeat(true, p_video_id, p_video_title, 'watching', p_device, p_platform);
$$;

CREATE OR REPLACE FUNCTION public.stop_video_watch_session(
  p_video_id text DEFAULT NULL,
  p_keep_online boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(p_keep_online, false) THEN
    RETURN public.user_heartbeat(true, NULL, NULL, 'online', NULL, NULL);
  END IF;
  RETURN public.user_heartbeat(false, p_video_id, NULL, 'offline', NULL, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.blade_get_auth_session_activity()
RETURNS TABLE(uid text, ts timestamptz, user_agent text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.user_id::text AS uid,
    NULLIF(GREATEST(
      COALESCE(public.blade_safe_ts(to_jsonb(s)->>'refreshed_at'), '-infinity'::timestamptz),
      COALESCE(s.updated_at, '-infinity'::timestamptz),
      COALESCE(s.created_at, '-infinity'::timestamptz)
    ), '-infinity'::timestamptz) AS ts,
    COALESCE(NULLIF(to_jsonb(s)->>'user_agent', ''), '') AS user_agent
  FROM auth.sessions s
  WHERE s.user_id IS NOT NULL
    AND (
      public.blade_safe_ts(to_jsonb(s)->>'not_after') IS NULL
      OR public.blade_safe_ts(to_jsonb(s)->>'not_after') > now()
    );
EXCEPTION WHEN others THEN
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.blade_touch_user_on_auth_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    UPDATE public.profiles u
    SET last_active_at = v_now,
        is_online = true
    WHERE u.id::text = NEW.user_id::text
       OR COALESCE(to_jsonb(u)->>'user_id', '') = NEW.user_id::text;

    INSERT INTO public.user_presence (
      user_id, status, is_online, session_started_at, last_active_at, ended_at, updated_at
    )
    VALUES (
      NEW.user_id, 'online', true, v_now, v_now, NULL, v_now
    )
    ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE SET
      is_online = true,
      status = COALESCE(NULLIF(public.user_presence.status, 'offline'), 'online'),
      session_started_at = CASE
        WHEN public.user_presence.is_online = true
             AND public.user_presence.ended_at IS NULL
             AND COALESCE(public.user_presence.last_active_at, public.user_presence.updated_at, '-infinity'::timestamptz) >= v_now - interval '2 minutes'
        THEN COALESCE(public.user_presence.session_started_at, v_now)
        ELSE v_now
      END,
      last_active_at = v_now,
      ended_at = NULL,
      updated_at = v_now;
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_blade_touch_user_on_auth_session ON auth.sessions;
  CREATE TRIGGER trg_blade_touch_user_on_auth_session
    AFTER INSERT OR UPDATE ON auth.sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.blade_touch_user_on_auth_session();
EXCEPTION WHEN insufficient_privilege OR others THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION public.get_blade_activity_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_total bigint;
  v_live bigint;
  v_today bigint;
  v_week bigint;
  v_new_today bigint;
  v_live_ids jsonb;
  v_live_sessions jsonb;
BEGIN
  IF NOT public.is_blade_admin() THEN
    RAISE EXCEPTION 'Admin privileges required.';
  END IF;

  UPDATE public.user_presence p
  SET
    is_online = false,
    status = 'offline',
    current_video_id = NULL,
    current_video_title = NULL,
    ended_at = COALESCE(p.ended_at, p.last_active_at, p.updated_at, now()),
    updated_at = now()
  WHERE p.is_online = true
    AND COALESCE(
      public.blade_extract_latest_ts(to_jsonb(p)),
      p.last_active_at,
      p.updated_at,
      p.created_at
    ) < now() - interval '2 minutes';

  WITH presence_agg AS (
    SELECT
      uid,
      MAX(ts) AS pres_ts,
      BOOL_OR(is_online AND ts >= now() - interval '2 minutes') AS pres_live
    FROM public.blade_get_presence_rows()
    WHERE uid IS NOT NULL
    GROUP BY uid
  ),
  auth_sess_agg AS (
    SELECT uid, MAX(ts) AS auth_sess_ts
    FROM public.blade_get_auth_session_activity()
    WHERE uid IS NOT NULL
    GROUP BY uid
  ),
  eff AS (
    SELECT
      u.id::text AS id_text,
      NULLIF(GREATEST(
        COALESCE(public.blade_extract_latest_ts(to_jsonb(u)), '-infinity'::timestamptz),
        COALESCE(pa.pres_ts, '-infinity'::timestamptz),
        COALESCE(asa.auth_sess_ts, '-infinity'::timestamptz),
        COALESCE(au.last_sign_in_at, '-infinity'::timestamptz)
      ), '-infinity'::timestamptz) AS eff_ts,
      COALESCE(pa.pres_live, false) AS pres_live
    FROM public.profiles u
    LEFT JOIN presence_agg pa
      ON pa.uid = u.id::text OR pa.uid = COALESCE(NULLIF(to_jsonb(u)->>'user_id', ''), '')
    LEFT JOIN auth_sess_agg asa
      ON asa.uid = u.id::text OR asa.uid = COALESCE(NULLIF(to_jsonb(u)->>'user_id', ''), '')
    LEFT JOIN auth.users au
      ON au.id::text = u.id::text OR au.id::text = COALESCE(NULLIF(to_jsonb(u)->>'user_id', ''), '')
  )
  UPDATE public.profiles u
  SET is_online = false
  FROM eff
  WHERE u.id::text = eff.id_text
    AND u.is_online = true
    AND NOT eff.pres_live
    AND (eff.eff_ts IS NULL OR eff.eff_ts < now() - interval '2 minutes');

  WITH presence_latest AS (
    SELECT DISTINCT ON (uid)
      uid,
      ts AS pres_ts,
      (is_online AND ts >= now() - interval '2 minutes') AS pres_live,
      current_video_id,
      current_video_title,
      session_started_at,
      status AS pres_status,
      device,
      platform
    FROM public.blade_get_presence_rows()
    WHERE uid IS NOT NULL
    ORDER BY uid, ts DESC NULLS LAST
  ),
  presence_agg AS (
    SELECT
      uid,
      MAX(ts) AS pres_ts,
      BOOL_OR(is_online AND ts >= now() - interval '2 minutes') AS pres_live
    FROM public.blade_get_presence_rows()
    WHERE uid IS NOT NULL
    GROUP BY uid
  ),
  auth_sess_agg AS (
    SELECT
      uid,
      MAX(ts) AS auth_sess_ts,
      MAX(user_agent) AS user_agent
    FROM public.blade_get_auth_session_activity()
    WHERE uid IS NOT NULL
    GROUP BY uid
  ),
  user_eval AS (
    SELECT
      u.id::text AS id_text,
      true AS in_users_table,
      COALESCE(
        NULLIF(to_jsonb(u)->>'full_name', ''),
        NULLIF(to_jsonb(u)->>'display_name', ''),
        NULLIF(to_jsonb(u)->>'name', ''),
        NULLIF(to_jsonb(u)->>'username', ''),
        au.email,
        u.id::text
      ) AS user_name,
      COALESCE(NULLIF(to_jsonb(u)->>'username', ''), NULLIF(to_jsonb(u)->>'handle', ''), '') AS username,
      COALESCE(
        NULLIF(to_jsonb(u)->>'avatar_url', ''),
        NULLIF(to_jsonb(u)->>'profile_image', ''),
        NULLIF(to_jsonb(u)->>'photo_url', ''),
        ''
      ) AS avatar_url,
      u.created_at,
      public.blade_extract_latest_ts(to_jsonb(u)) AS user_ts,
      NULLIF(GREATEST(
        COALESCE(au.last_sign_in_at, '-infinity'::timestamptz),
        COALESCE(asa.auth_sess_ts, '-infinity'::timestamptz)
      ), '-infinity'::timestamptz) AS auth_ts,
      pa.pres_ts,
      COALESCE(pa.pres_live, false) AS pres_live,
      u.is_online,
      pl.current_video_id,
      COALESCE(
        pl.current_video_title,
        NULLIF(to_jsonb(vid)->>'caption', ''),
        NULLIF(to_jsonb(vid)->>'title', '')
      ) AS current_video_title,
      COALESCE(pl.session_started_at, pa.pres_ts, asa.auth_sess_ts, public.blade_extract_latest_ts(to_jsonb(u))) AS session_started_at,
      pl.pres_status,
      COALESCE(pl.device, '') AS device,
      COALESCE(pl.platform, '') AS platform,
      NULLIF(GREATEST(
        COALESCE(public.blade_extract_latest_ts(to_jsonb(u)), '-infinity'::timestamptz),
        COALESCE(pa.pres_ts, '-infinity'::timestamptz),
        COALESCE(asa.auth_sess_ts, '-infinity'::timestamptz),
        COALESCE(au.last_sign_in_at, '-infinity'::timestamptz)
      ), '-infinity'::timestamptz) AS eff_ts
    FROM public.profiles u
    LEFT JOIN presence_agg pa
      ON pa.uid = u.id::text OR pa.uid = COALESCE(NULLIF(to_jsonb(u)->>'user_id', ''), '')
    LEFT JOIN presence_latest pl
      ON pl.uid = u.id::text OR pl.uid = COALESCE(NULLIF(to_jsonb(u)->>'user_id', ''), '')
    LEFT JOIN auth_sess_agg asa
      ON asa.uid = u.id::text OR asa.uid = COALESCE(NULLIF(to_jsonb(u)->>'user_id', ''), '')
    LEFT JOIN public.videos vid
      ON pl.current_video_id IS NOT NULL AND vid.id::text = pl.current_video_id
    LEFT JOIN auth.users au
      ON au.id::text = u.id::text OR au.id::text = COALESCE(NULLIF(to_jsonb(u)->>'user_id', ''), '')
  ),
  orphan_live_eval AS (
    SELECT
      au.id::text AS id_text,
      false AS in_users_table,
      COALESCE(
        NULLIF(au.raw_user_meta_data->>'full_name', ''),
        NULLIF(au.raw_user_meta_data->>'name', ''),
        NULLIF(au.raw_user_meta_data->>'username', ''),
        au.email,
        au.id::text
      ) AS user_name,
      COALESCE(NULLIF(au.raw_user_meta_data->>'username', ''), '') AS username,
      COALESCE(NULLIF(au.raw_user_meta_data->>'avatar_url', ''), '') AS avatar_url,
      au.created_at,
      NULL::timestamptz AS user_ts,
      NULLIF(GREATEST(
        COALESCE(au.last_sign_in_at, '-infinity'::timestamptz),
        COALESCE(asa.auth_sess_ts, '-infinity'::timestamptz)
      ), '-infinity'::timestamptz) AS auth_ts,
      pa.pres_ts,
      COALESCE(pa.pres_live, false) AS pres_live,
      true AS is_online,
      pl.current_video_id,
      COALESCE(
        pl.current_video_title,
        NULLIF(to_jsonb(vid)->>'caption', ''),
        NULLIF(to_jsonb(vid)->>'title', '')
      ) AS current_video_title,
      COALESCE(pl.session_started_at, pa.pres_ts, asa.auth_sess_ts) AS session_started_at,
      pl.pres_status,
      COALESCE(pl.device, '') AS device,
      COALESCE(pl.platform, '') AS platform,
      NULLIF(GREATEST(
        COALESCE(pa.pres_ts, '-infinity'::timestamptz),
        COALESCE(asa.auth_sess_ts, '-infinity'::timestamptz),
        COALESCE(au.last_sign_in_at, '-infinity'::timestamptz)
      ), '-infinity'::timestamptz) AS eff_ts
    FROM auth.users au
    LEFT JOIN presence_agg pa ON pa.uid = au.id::text
    LEFT JOIN presence_latest pl ON pl.uid = au.id::text
    LEFT JOIN auth_sess_agg asa ON asa.uid = au.id::text
    LEFT JOIN public.videos vid
      ON pl.current_video_id IS NOT NULL AND vid.id::text = pl.current_video_id
    WHERE NOT EXISTS (SELECT 1 FROM user_eval ue WHERE ue.id_text = au.id::text)
      AND (
        COALESCE(pa.pres_live, false)
        OR COALESCE(asa.auth_sess_ts, '-infinity'::timestamptz) >= now() - interval '2 minutes'
      )
  ),
  combined_eval AS (
    SELECT * FROM user_eval
    UNION ALL
    SELECT * FROM orphan_live_eval
  ),
  live_calc AS (
    SELECT
      *,
      (
        pres_live
        OR (
          eff_ts >= now() - interval '2 minutes'
          AND (
            COALESCE(is_online, true) = true
            OR (auth_ts IS NOT NULL AND auth_ts >= now() - interval '2 minutes' AND (user_ts IS NULL OR auth_ts > user_ts) AND (pres_ts IS NULL OR auth_ts > pres_ts))
          )
        )
      ) AS is_live_now
    FROM combined_eval
  )
  SELECT
    COUNT(*) FILTER (WHERE in_users_table),
    COUNT(*) FILTER (WHERE is_live_now),
    COALESCE(jsonb_agg(id_text) FILTER (WHERE is_live_now), '[]'::jsonb),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'user_id', id_text,
          'user_name', user_name,
          'username', username,
          'avatar_url', avatar_url,
          'current_video_id', current_video_id,
          'current_video_title', current_video_title,
          'session_started_at', session_started_at,
          'last_active_at', eff_ts,
          'status', CASE
            WHEN current_video_id IS NOT NULL OR lower(COALESCE(pres_status, '')) = 'watching' THEN 'watching'
            ELSE 'online'
          END,
          'device', device,
          'platform', platform
        )
        ORDER BY eff_ts DESC NULLS LAST
      ) FILTER (WHERE is_live_now),
      '[]'::jsonb
    ),
    COUNT(*) FILTER (WHERE eff_ts >= date_trunc('day', now())),
    COUNT(*) FILTER (WHERE eff_ts >= now() - interval '7 days'),
    COUNT(*) FILTER (WHERE in_users_table AND created_at >= date_trunc('day', now()))
  INTO v_total, v_live, v_live_ids, v_live_sessions, v_today, v_week, v_new_today
  FROM live_calc;

  RETURN jsonb_build_object(
    'total_users', COALESCE(v_total, 0),
    'live_active_users', COALESCE(v_live, 0),
    'live_user_ids', COALESCE(v_live_ids, '[]'::jsonb),
    'live_sessions', COALESCE(v_live_sessions, '[]'::jsonb),
    'active_users_today', COALESCE(v_today, 0),
    'active_users_7d', COALESCE(v_week, 0),
    'offline_users', GREATEST(0, COALESCE(v_total, 0) - COALESCE(v_live, 0)),
    'new_users_today', COALESCE(v_new_today, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.blade_protect_user_moderation_cols()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_blade_admin() THEN
    IF (v_new->>'status') IS DISTINCT FROM (v_old->>'status')
       OR (v_new->>'account_status') IS DISTINCT FROM (v_old->>'account_status')
       OR (v_new->>'is_blocked') IS DISTINCT FROM (v_old->>'is_blocked')
       OR (v_new->>'blocked') IS DISTINCT FROM (v_old->>'blocked')
       OR (v_new->>'is_banned') IS DISTINCT FROM (v_old->>'is_banned')
       OR (v_new->>'banned') IS DISTINCT FROM (v_old->>'banned')
       OR (v_new->>'is_suspended') IS DISTINCT FROM (v_old->>'is_suspended')
       OR (v_new->>'is_verified') IS DISTINCT FROM (v_old->>'is_verified')
       OR (v_new->>'verification_status') IS DISTINCT FROM (v_old->>'verification_status') THEN
      RAISE EXCEPTION 'Only administrators can modify account block or verification status.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blade_protect_user_moderation_cols ON public.profiles;
CREATE TRIGGER trg_blade_protect_user_moderation_cols
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.blade_protect_user_moderation_cols();

CREATE OR REPLACE FUNCTION public.is_video_publicly_visible(p_row jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_row IS NULL THEN
    RETURN false;
  END IF;

  IF lower(COALESCE(p_row->>'is_blocked', 'false')) IN ('true', 't', '1', 'yes')
     OR lower(COALESCE(p_row->>'blocked', 'false')) IN ('true', 't', '1', 'yes')
     OR lower(COALESCE(p_row->>'is_hidden', 'false')) IN ('true', 't', '1', 'yes')
     OR lower(COALESCE(p_row->>'hidden', 'false')) IN ('true', 't', '1', 'yes')
     OR lower(COALESCE(p_row->>'is_deleted', 'false')) IN ('true', 't', '1', 'yes')
     OR lower(COALESCE(p_row->>'deleted', 'false')) IN ('true', 't', '1', 'yes') THEN
    RETURN false;
  END IF;

  IF (p_row ? 'is_active' AND lower(COALESCE(p_row->>'is_active', 'true')) IN ('false', 'f', '0', 'no'))
     OR (p_row ? 'is_visible' AND lower(COALESCE(p_row->>'is_visible', 'true')) IN ('false', 'f', '0', 'no'))
     OR (p_row ? 'is_published' AND lower(COALESCE(p_row->>'is_published', 'true')) IN ('false', 'f', '0', 'no'))
     OR (p_row ? 'is_public' AND lower(COALESCE(p_row->>'is_public', 'true')) IN ('false', 'f', '0', 'no')) THEN
    RETURN false;
  END IF;

  IF lower(COALESCE(NULLIF(p_row->>'status', ''), NULLIF(p_row->>'moderation_status', ''), 'published'))
       IN ('blocked', 'hidden', 'deleted', 'removed', 'banned', 'rejected', 'disabled', 'suspended') THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_set_video_moderation(uuid, text);
DROP FUNCTION IF EXISTS public.admin_set_video_moderation(text, text);
CREATE OR REPLACE FUNCTION public.admin_set_video_moderation(
  p_video_id text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, information_schema
AS $$
DECLARE
  v_clean text := lower(trim(COALESCE(p_status, 'published')));
  v_is_hidden boolean := (v_clean = 'hidden');
  v_is_blocked boolean := (v_clean = 'blocked');
  v_is_public boolean := (v_clean IN ('published', 'active'));
  v_cols text[];
  v_sets text[] := ARRAY[]::text[];
  v_flag_sets text[] := ARRAY[]::text[];
  v_updated text;
BEGIN
  IF NOT public.is_blade_admin() THEN
    RAISE EXCEPTION 'Admin privileges required.';
  END IF;

  IF v_clean NOT IN ('published', 'active', 'hidden', 'blocked', 'draft') THEN
    RAISE EXCEPTION 'Invalid video status: %', p_status;
  END IF;

  SELECT array_agg(column_name::text)
  INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'videos';

  IF 'status' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('status = %L', v_clean)); END IF;
  IF 'moderation_status' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('moderation_status = %L', v_clean)); END IF;

  IF 'is_hidden' = ANY(v_cols) THEN v_flag_sets := array_append(v_flag_sets, format('is_hidden = %L', v_is_hidden)); END IF;
  IF 'hidden' = ANY(v_cols) THEN v_flag_sets := array_append(v_flag_sets, format('hidden = %L', v_is_hidden)); END IF;
  IF 'is_blocked' = ANY(v_cols) THEN v_flag_sets := array_append(v_flag_sets, format('is_blocked = %L', v_is_blocked)); END IF;
  IF 'blocked' = ANY(v_cols) THEN v_flag_sets := array_append(v_flag_sets, format('blocked = %L', v_is_blocked)); END IF;
  IF 'is_active' = ANY(v_cols) THEN v_flag_sets := array_append(v_flag_sets, format('is_active = %L', v_is_public)); END IF;
  IF 'is_visible' = ANY(v_cols) THEN v_flag_sets := array_append(v_flag_sets, format('is_visible = %L', v_is_public)); END IF;
  IF 'is_published' = ANY(v_cols) THEN v_flag_sets := array_append(v_flag_sets, format('is_published = %L', v_is_public)); END IF;
  IF 'is_public' = ANY(v_cols) THEN v_flag_sets := array_append(v_flag_sets, format('is_public = %L', v_is_public)); END IF;
  IF 'updated_at' = ANY(v_cols) THEN v_flag_sets := array_append(v_flag_sets, 'updated_at = now()'); END IF;

  v_sets := v_sets || v_flag_sets;

  IF array_length(v_sets, 1) IS NULL THEN
    RAISE EXCEPTION 'No moderation columns found on public.videos.';
  END IF;

  BEGIN
    EXECUTE format(
      'UPDATE public.videos SET %s WHERE id::text = trim($1) RETURNING id::text',
      array_to_string(v_sets, ', ')
    )
    INTO v_updated
    USING p_video_id;
  EXCEPTION WHEN check_violation OR invalid_text_representation OR datatype_mismatch THEN
    IF array_length(v_flag_sets, 1) IS NULL THEN
      RAISE;
    END IF;
    EXECUTE format(
      'UPDATE public.videos SET %s WHERE id::text = trim($1) RETURNING id::text',
      array_to_string(v_flag_sets, ', ')
    )
    INTO v_updated
    USING p_video_id;
  END;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'Video % not found.', p_video_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_updated,
    'status', v_clean,
    'is_hidden', v_is_hidden,
    'is_blocked', v_is_blocked,
    'is_public', v_is_public
  );
END;
$$;

DROP FUNCTION IF EXISTS public.admin_set_user_status(uuid, text);
CREATE OR REPLACE FUNCTION public.admin_set_user_status(
  p_user_id text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, information_schema
AS $$
DECLARE
  v_clean text := lower(trim(COALESCE(p_status, 'active')));
  v_is_blocked boolean := (v_clean = 'blocked');
  v_is_suspended boolean := (v_clean = 'suspended');
  v_is_active boolean := (v_clean = 'active');
  v_cols text[];
  v_sets text[] := ARRAY[]::text[];
  v_updated text;
BEGIN
  IF NOT public.is_blade_admin() THEN
    RAISE EXCEPTION 'Admin privileges required.';
  END IF;

  IF v_clean NOT IN ('active', 'blocked', 'suspended') THEN
    RAISE EXCEPTION 'Invalid user account status: %', p_status;
  END IF;

  SELECT array_agg(column_name::text)
  INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles';

  IF 'status' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('status = %L', v_clean)); END IF;
  IF 'account_status' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('account_status = %L', v_clean)); END IF;
  IF 'is_blocked' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('is_blocked = %L', v_is_blocked)); END IF;
  IF 'blocked' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('blocked = %L', v_is_blocked)); END IF;
  IF 'is_banned' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('is_banned = %L', v_is_blocked)); END IF;
  IF 'banned' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('banned = %L', v_is_blocked)); END IF;
  IF 'is_suspended' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('is_suspended = %L', v_is_suspended)); END IF;
  IF 'suspended' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('suspended = %L', v_is_suspended)); END IF;
  IF 'is_active' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('is_active = %L', v_is_active)); END IF;
  IF 'blocked_at' = ANY(v_cols) THEN
    IF v_is_blocked THEN
      v_sets := array_append(v_sets, 'blocked_at = now()');
    ELSE
      v_sets := array_append(v_sets, 'blocked_at = NULL');
    END IF;
  END IF;

  BEGIN
    EXECUTE format(
      'UPDATE public.profiles SET %s WHERE id::text = trim($1) RETURNING id::text',
      array_to_string(v_sets, ', ')
    )
    INTO v_updated
    USING p_user_id;
  EXCEPTION WHEN check_violation THEN
    v_sets := ARRAY[]::text[];
    IF 'is_blocked' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('is_blocked = %L', v_is_blocked)); END IF;
    IF 'blocked' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('blocked = %L', v_is_blocked)); END IF;
    IF 'is_banned' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('is_banned = %L', v_is_blocked)); END IF;
    IF 'banned' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('banned = %L', v_is_blocked)); END IF;
    IF 'is_suspended' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('is_suspended = %L', v_is_suspended)); END IF;
    IF 'is_active' = ANY(v_cols) THEN v_sets := array_append(v_sets, format('is_active = %L', v_is_active)); END IF;
    EXECUTE format(
      'UPDATE public.profiles SET %s WHERE id::text = trim($1) RETURNING id::text',
      array_to_string(v_sets, ', ')
    )
    INTO v_updated
    USING p_user_id;
  END;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'User % not found.', p_user_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_updated, 'status', v_clean, 'is_blocked', v_is_blocked);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_current_user_active_unblocked()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_uid text := auth.uid()::text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN true;
  END IF;

  SELECT to_jsonb(u)
  INTO v_row
  FROM public.profiles u
  WHERE u.id::text = v_uid
     OR COALESCE(to_jsonb(u)->>'user_id', '') = v_uid
  LIMIT 1;

  IF v_row IS NULL THEN
    RETURN true;
  END IF;

  IF COALESCE((v_row->>'is_blocked')::boolean, false) = true
     OR COALESCE((v_row->>'blocked')::boolean, false) = true
     OR COALESCE((v_row->>'is_banned')::boolean, false) = true
     OR COALESCE((v_row->>'banned')::boolean, false) = true
     OR COALESCE((v_row->>'is_suspended')::boolean, false) = true
     OR COALESCE((v_row->>'suspended')::boolean, false) = true THEN
    RETURN false;
  END IF;

  IF v_row ? 'is_active' AND COALESCE((v_row->>'is_active')::boolean, true) = false THEN
    RETURN false;
  END IF;

  IF lower(COALESCE(v_row->>'status', v_row->>'account_status', 'active')) IN ('blocked', 'banned', 'suspended', 'deleted') THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_full_name text,
  p_email text,
  p_phone text,
  p_username text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_bio text DEFAULT NULL,
  p_status text DEFAULT 'active',
  p_verification_status text DEFAULT 'unverified',
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, information_schema
AS $$
DECLARE
  v_name text := trim(COALESCE(p_full_name, ''));
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_phone text := trim(COALESCE(p_phone, ''));
  v_username text := NULLIF(regexp_replace(lower(trim(COALESCE(p_username, ''))), '^@+', ''), '');
  v_avatar text := NULLIF(trim(COALESCE(p_avatar_url, '')), '');
  v_bio text := NULLIF(trim(COALESCE(p_bio, '')), '');
  v_status text := lower(trim(COALESCE(p_status, 'active')));
  v_verify text := lower(trim(COALESCE(p_verification_status, 'unverified')));
  v_password text := COALESCE(NULLIF(trim(COALESCE(p_password, '')), ''), encode(gen_random_bytes(16), 'hex'));
  v_new_uid uuid := gen_random_uuid();
  v_is_blocked boolean;
  v_is_suspended boolean;
  v_is_active boolean;
  v_is_verified boolean;
  v_cols text[];
  v_ins_cols text[] := ARRAY[]::text[];
  v_ins_vals text[] := ARRAY[]::text[];
  v_upd_sets text[] := ARRAY[]::text[];
  v_dup_exists boolean := false;
  v_norm_phone text := regexp_replace(v_phone, '[^0-9+]', '', 'g');
BEGIN
  IF NOT public.is_blade_admin() THEN
    RAISE EXCEPTION 'Admin privileges required.';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Full name is required.';
  END IF;
  IF v_email = '' OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'Please enter a valid email address.';
  END IF;
  IF length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 7 THEN
    RAISE EXCEPTION 'Please enter a valid phone number.';
  END IF;
  IF v_status NOT IN ('active', 'blocked', 'suspended') THEN
    v_status := 'active';
  END IF;
  IF v_verify NOT IN ('unverified', 'pending', 'verified') THEN
    v_verify := 'unverified';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users au WHERE lower(au.email) = v_email) THEN
    RAISE EXCEPTION 'A user with email "%" already exists.', v_email;
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users au
    WHERE NULLIF(au.phone, '') IS NOT NULL
      AND regexp_replace(au.phone, '[^0-9+]', '', 'g') = v_norm_phone
  ) THEN
    RAISE EXCEPTION 'A user with phone number "%" already exists.', v_phone;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles u
    WHERE lower(COALESCE(to_jsonb(u)->>'email', to_jsonb(u)->>'email_address', '')) = v_email
  ) INTO v_dup_exists;
  IF v_dup_exists THEN
    RAISE EXCEPTION 'A user profile with email "%" already exists.', v_email;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles u
    WHERE regexp_replace(COALESCE(to_jsonb(u)->>'phone', to_jsonb(u)->>'phone_number', to_jsonb(u)->>'mobile', ''), '[^0-9+]', '', 'g') = v_norm_phone
  ) INTO v_dup_exists;
  IF v_dup_exists THEN
    RAISE EXCEPTION 'A user profile with phone number "%" already exists.', v_phone;
  END IF;

  IF v_username IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.profiles u
      WHERE lower(COALESCE(to_jsonb(u)->>'username', to_jsonb(u)->>'handle', to_jsonb(u)->>'user_name', '')) = v_username
    ) INTO v_dup_exists;
    IF v_dup_exists THEN
      RAISE EXCEPTION 'Username "@%" is already taken.', v_username;
    END IF;
  END IF;

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    phone,
    phone_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,
    v_new_uid,
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_password, gen_salt('bf')),
    now(),
    NULLIF(v_phone, ''),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'full_name', v_name,
      'name', v_name,
      'username', COALESCE(v_username, split_part(v_email, '@', 1)),
      'phone', v_phone,
      'avatar_url', COALESCE(v_avatar, '')
    ),
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  BEGIN
    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_new_uid,
      jsonb_build_object('sub', v_new_uid::text, 'email', v_email),
      'email',
      v_new_uid::text,
      now(),
      now(),
      now()
    );
  EXCEPTION WHEN others THEN
    NULL;
  END;

  v_is_blocked := (v_status = 'blocked');
  v_is_suspended := (v_status = 'suspended');
  v_is_active := (v_status = 'active');
  v_is_verified := (v_verify = 'verified');

  SELECT array_agg(column_name::text)
  INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles';

  v_ins_cols := array_append(v_ins_cols, 'id');
  v_ins_vals := array_append(v_ins_vals, format('%L::uuid', v_new_uid));

  IF 'full_name' = ANY(v_cols) THEN
    v_ins_cols := array_append(v_ins_cols, 'full_name');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_name));
    v_upd_sets := array_append(v_upd_sets, format('full_name = %L', v_name));
  ELSIF 'display_name' = ANY(v_cols) THEN
    v_ins_cols := array_append(v_ins_cols, 'display_name');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_name));
    v_upd_sets := array_append(v_upd_sets, format('display_name = %L', v_name));
  ELSIF 'name' = ANY(v_cols) THEN
    v_ins_cols := array_append(v_ins_cols, 'name');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_name));
    v_upd_sets := array_append(v_upd_sets, format('name = %L', v_name));
  END IF;

  IF 'username' = ANY(v_cols) AND v_username IS NOT NULL THEN
    v_ins_cols := array_append(v_ins_cols, 'username');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_username));
    v_upd_sets := array_append(v_upd_sets, format('username = %L', v_username));
  END IF;

  IF 'email' = ANY(v_cols) THEN
    v_ins_cols := array_append(v_ins_cols, 'email');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_email));
    v_upd_sets := array_append(v_upd_sets, format('email = %L', v_email));
  END IF;

  IF 'phone' = ANY(v_cols) THEN
    v_ins_cols := array_append(v_ins_cols, 'phone');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_phone));
    v_upd_sets := array_append(v_upd_sets, format('phone = %L', v_phone));
  END IF;

  IF v_avatar IS NOT NULL AND 'avatar_url' = ANY(v_cols) THEN
    v_ins_cols := array_append(v_ins_cols, 'avatar_url');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_avatar));
    v_upd_sets := array_append(v_upd_sets, format('avatar_url = %L', v_avatar));
  END IF;

  IF v_bio IS NOT NULL AND 'bio' = ANY(v_cols) THEN
    v_ins_cols := array_append(v_ins_cols, 'bio');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_bio));
    v_upd_sets := array_append(v_upd_sets, format('bio = %L', v_bio));
  END IF;

  IF 'status' = ANY(v_cols) THEN
    v_ins_cols := array_append(v_ins_cols, 'status');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_status));
    v_upd_sets := array_append(v_upd_sets, format('status = %L', v_status));
  END IF;
  IF 'is_blocked' = ANY(v_cols) THEN
    v_ins_cols := array_append(v_ins_cols, 'is_blocked');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_is_blocked));
    v_upd_sets := array_append(v_upd_sets, format('is_blocked = %L', v_is_blocked));
  END IF;
  IF 'is_suspended' = ANY(v_cols) THEN
    v_ins_cols := array_append(v_ins_cols, 'is_suspended');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_is_suspended));
    v_upd_sets := array_append(v_upd_sets, format('is_suspended = %L', v_is_suspended));
  END IF;
  IF 'is_active' = ANY(v_cols) THEN
    v_ins_cols := array_append(v_ins_cols, 'is_active');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_is_active));
    v_upd_sets := array_append(v_upd_sets, format('is_active = %L', v_is_active));
  END IF;
  IF 'is_verified' = ANY(v_cols) THEN
    v_ins_cols := array_append(v_ins_cols, 'is_verified');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_is_verified));
    v_upd_sets := array_append(v_upd_sets, format('is_verified = %L', v_is_verified));
  END IF;
  IF 'verification_status' = ANY(v_cols) THEN
    v_ins_cols := array_append(v_ins_cols, 'verification_status');
    v_ins_vals := array_append(v_ins_vals, format('%L', v_verify));
    v_upd_sets := array_append(v_upd_sets, format('verification_status = %L', v_verify));
  END IF;

  EXECUTE format(
    'INSERT INTO public.profiles (%s) VALUES (%s) ON CONFLICT (id) DO UPDATE SET %s',
    array_to_string(v_ins_cols, ', '),
    array_to_string(v_ins_vals, ', '),
    array_to_string(v_upd_sets, ', ')
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_new_uid,
    'full_name', v_name,
    'username', v_username,
    'email', v_email,
    'phone', v_phone,
    'avatar_url', v_avatar,
    'status', v_status,
    'verification_status', v_verify
  );
END;
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blade_admin_full_user_presence" ON public.user_presence;
CREATE POLICY "blade_admin_full_user_presence"
  ON public.user_presence FOR ALL TO authenticated
  USING (public.is_blade_admin())
  WITH CHECK (public.is_blade_admin());

DROP POLICY IF EXISTS "blade_user_own_user_presence" ON public.user_presence;
CREATE POLICY "blade_user_own_user_presence"
  ON public.user_presence FOR ALL TO authenticated
  USING (auth.uid() = user_id OR auth.uid()::text = id::text)
  WITH CHECK (auth.uid() = user_id OR auth.uid()::text = id::text);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd IN ('SELECT', 'ALL') AND permissive = 'PERMISSIVE'
  ) THEN
    EXECUTE 'CREATE POLICY "blade_public_read_profiles" ON public.profiles FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'videos' AND cmd IN ('SELECT', 'ALL') AND permissive = 'PERMISSIVE'
  ) THEN
    EXECUTE 'CREATE POLICY "blade_public_read_videos" ON public.videos FOR SELECT TO anon, authenticated USING (true)';
  END IF;
END $$;

DROP POLICY IF EXISTS "blade_admin_full_profiles" ON public.profiles;
CREATE POLICY "blade_admin_full_profiles"
  ON public.profiles FOR ALL TO authenticated
  USING (public.is_blade_admin())
  WITH CHECK (public.is_blade_admin());

DROP POLICY IF EXISTS "blade_restrict_blocked_user_profile_update" ON public.profiles;
CREATE POLICY "blade_restrict_blocked_user_profile_update"
  ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_blade_admin() OR public.is_current_user_active_unblocked())
  WITH CHECK (public.is_blade_admin() OR public.is_current_user_active_unblocked());

DROP POLICY IF EXISTS "blade_admin_full_videos" ON public.videos;
CREATE POLICY "blade_admin_full_videos"
  ON public.videos FOR ALL TO authenticated
  USING (public.is_blade_admin())
  WITH CHECK (public.is_blade_admin());

DROP POLICY IF EXISTS "blade_restrict_blocked_hidden_videos" ON public.videos;
CREATE POLICY "blade_restrict_blocked_hidden_videos"
  ON public.videos AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (
    public.is_blade_admin()
    OR public.is_video_publicly_visible(to_jsonb(videos))
  );

DROP POLICY IF EXISTS "blade_restrict_blocked_user_video_write" ON public.videos;
CREATE POLICY "blade_restrict_blocked_user_video_write"
  ON public.videos AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_blade_admin() OR public.is_current_user_active_unblocked());

DROP POLICY IF EXISTS "blade_restrict_blocked_user_video_update" ON public.videos;
CREATE POLICY "blade_restrict_blocked_user_video_update"
  ON public.videos AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_blade_admin() OR public.is_current_user_active_unblocked())
  WITH CHECK (public.is_blade_admin() OR public.is_current_user_active_unblocked());

DROP POLICY IF EXISTS "blade_restrict_blocked_user_video_delete" ON public.videos;
CREATE POLICY "blade_restrict_blocked_user_video_delete"
  ON public.videos AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_blade_admin() OR public.is_current_user_active_unblocked());

DO $$
DECLARE
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT v.view_name
    FROM information_schema.view_table_usage v
    WHERE v.view_schema = 'public'
      AND v.table_schema = 'public'
      AND v.table_name IN ('videos', 'profiles')
  LOOP
    BEGIN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v_rec.view_name);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END LOOP;
END $$;

ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER TABLE public.videos REPLICA IDENTITY FULL;
ALTER TABLE public.user_presence REPLICA IDENTITY FULL;

DO $$
DECLARE
  t text;
  rt_tables text[] := ARRAY['profiles', 'videos', 'blade_admins', 'user_presence', 'active_users', 'user_sessions', 'online_users', 'presence'];
BEGIN
  FOREACH t IN ARRAY rt_tables
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      BEGIN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      EXCEPTION WHEN duplicate_object OR feature_not_supported OR object_not_in_prerequisite_state THEN
        NULL;
      END;
    END IF;
  END LOOP;
END $$;

COMMIT;
