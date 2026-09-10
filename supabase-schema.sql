-- ==============================================================================
-- SUPABASE POSTGRESQL SCHEMA FOR SALARY, ATTENDANCE, SCHEDULE & LATE TRACKING
-- Run this in your Supabase SQL Editor (Dashboard -> SQL Editor -> New Query -> Run)
-- ==============================================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 100.00,
  scheduled_start_time TEXT NOT NULL DEFAULT '07:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. SCHEDULES TABLE
CREATE TABLE IF NOT EXISTS public.schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day_of_week TEXT NOT NULL,
  scheduled_start TEXT NOT NULL DEFAULT '07:00',
  scheduled_end TEXT NOT NULL DEFAULT '17:00',
  is_rest_day BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_day UNIQUE (user_id, day_of_week)
);

-- 3. ATTENDANCE TABLE
CREATE TABLE IF NOT EXISTS public.attendance (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  scheduled_start TEXT NOT NULL DEFAULT '07:00',
  scheduled_end TEXT NOT NULL DEFAULT '17:00',
  time_in TEXT NOT NULL,
  time_out TEXT,
  break_hours NUMERIC(4, 2) NOT NULL DEFAULT 1.0,
  total_hours NUMERIC(5, 2) NOT NULL DEFAULT 0.0,
  regular_hours NUMERIC(5, 2) NOT NULL DEFAULT 0.0,
  overtime_hours NUMERIC(5, 2) NOT NULL DEFAULT 0.0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  attendance_status TEXT NOT NULL DEFAULT 'ON_TIME',
  hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 100.00,
  salary NUMERIC(10, 2) NOT NULL DEFAULT 0.0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_workdate UNIQUE (user_id, work_date)
);

-- 4. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON public.attendance (user_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_week ON public.attendance (user_id, work_date) WHERE time_out IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schedules_user_day ON public.schedules (user_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_audit_user_created ON public.audit_logs (user_id, created_at DESC);

-- 6. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow server backend (Service Role or Authenticated API) full access:
DROP POLICY IF EXISTS "Service role full access users" ON public.users;
CREATE POLICY "Service role full access users" ON public.users FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role full access schedules" ON public.schedules;
CREATE POLICY "Service role full access schedules" ON public.schedules FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role full access attendance" ON public.attendance;
CREATE POLICY "Service role full access attendance" ON public.attendance FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role full access audit_logs" ON public.audit_logs;
CREATE POLICY "Service role full access audit_logs" ON public.audit_logs FOR ALL USING (true);
