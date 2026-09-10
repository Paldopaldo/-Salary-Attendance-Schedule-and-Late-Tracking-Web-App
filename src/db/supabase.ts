import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database as SqlJsDatabase } from 'sql.js';
import dotenv from 'dotenv';

dotenv.config({ override: true });

let supabaseClient: SupabaseClient | null = null;
let lastSyncTimestamp = 0;
const SYNC_CACHE_MS = 10000; // 10 seconds throttle
let circuitBreakerUntil = 0;
const CIRCUIT_BREAKER_DURATION_MS = 60000; // 1 minute backoff on network/DNS failure

export function isNetworkCircuitOpen(): boolean {
  return Date.now() < circuitBreakerUntil;
}

export function tripCircuitBreaker(reason?: string) {
  circuitBreakerUntil = Date.now() + CIRCUIT_BREAKER_DURATION_MS;
}

export function resetCircuitBreaker() {
  circuitBreakerUntil = 0;
}

export function isNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = `${err.message || ''} ${err.details || ''} ${err.code || ''}`;
  return (
    msg.includes('fetch failed') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('aborted')
  );
}

/**
 * Checks if Supabase credentials are configured in the environment
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  return Boolean(url && key && url.trim() !== '' && key.trim() !== '');
}

/**
 * Lazy-initializes and returns the Supabase client
 */
export function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error(
        'Supabase environment variables are missing. Please define SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY).'
      );
    }

    supabaseClient = createClient(url.trim(), key.trim(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: (input, init) => {
          // Provide 4-second timeout so requests never hang if network/DNS drops
          const signal = init?.signal || AbortSignal.timeout(4000);
          return fetch(input, { ...init, signal });
        },
      },
    });
  }

  return supabaseClient;
}

/**
 * Checks connectivity to Supabase
 */
export async function checkSupabaseHealth(): Promise<{
  connected: boolean;
  configured: boolean;
  tablesMissing?: boolean;
  message: string;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return {
      connected: false,
      configured: false,
      message: 'Supabase is not configured yet. System is currently running on local SQLite storage.',
    };
  }

  // Reset circuit breaker so user can explicitly test connection
  resetCircuitBreaker();

  try {
    const client = getSupabase();
    const { error } = await client.from('users').select('id').limit(1);

    if (error) {
      if (isNetworkError(error)) {
        tripCircuitBreaker(error.message);
        return {
          connected: false,
          configured: true,
          message: 'Supabase host is unreachable (DNS or network lookup failed). Local SQLite storage is active.',
          error: error.message,
        };
      }
      if (error.code === '42P01' || error.code === 'PGRST205' || error.message?.includes('schema cache')) {
        return {
          connected: true,
          configured: true,
          tablesMissing: true,
          message: 'Connected to Supabase project, but tables need to be created. Please run supabase-schema.sql in your Supabase SQL Editor.',
          error: error.message,
        };
      }
      return {
        connected: false,
        configured: true,
        message: 'Failed to query Supabase.',
        error: error.message,
      };
    }

    return {
      connected: true,
      configured: true,
      message: 'Active & Saving directly to Supabase PostgreSQL database.',
    };
  } catch (err: any) {
    if (isNetworkError(err)) {
      tripCircuitBreaker(err.message);
      return {
        connected: false,
        configured: true,
        message: 'Supabase host is unreachable (DNS or network lookup failed). Local SQLite storage is active.',
        error: err.message,
      };
    }
    return {
      connected: false,
      configured: true,
      message: 'Supabase connection failed.',
      error: err.message,
    };
  }
}

/**
 * Direct mutation: Save/update a user in Supabase
 */
export async function saveUserToSupabase(user: {
  id: string;
  email: string;
  passwordHash?: string;
  fullName: string;
  phone?: string | null;
  profilePicture?: string | null;
  accountStatus?: string;
  hourlyRate?: number;
  scheduledStartTime?: string;
  createdAt?: string;
  updatedAt?: string;
}): Promise<void> {
  if (!isSupabaseConfigured() || isNetworkCircuitOpen()) return;
  try {
    const supabase = getSupabase();
    const row: any = {
      id: user.id,
      email: user.email.trim().toLowerCase(),
      full_name: user.fullName,
      updated_at: new Date().toISOString(),
    };
    if (user.passwordHash) row.password_hash = user.passwordHash;
    if (user.phone !== undefined) row.phone = user.phone;
    if (user.profilePicture !== undefined) row.profile_picture = user.profilePicture;
    if (user.accountStatus) row.account_status = user.accountStatus;
    if (user.hourlyRate) row.hourly_rate = user.hourlyRate;
    if (user.scheduledStartTime) row.scheduled_start_time = user.scheduledStartTime;
    if (user.createdAt) row.created_at = user.createdAt;

    const { error } = await supabase.from('users').upsert([row], { onConflict: 'id' });
    if (error) {
      if (isNetworkError(error)) {
        tripCircuitBreaker(error.message);
      } else {
        console.warn('[Supabase] Failed to save user:', error.message);
      }
    }
  } catch (err: any) {
    if (isNetworkError(err)) {
      tripCircuitBreaker(err.message);
    } else {
      console.warn('[Supabase] saveUserToSupabase error:', err?.message || err);
    }
  }
}

/**
 * Direct mutation: Save/update a schedule in Supabase
 */
export async function saveScheduleToSupabase(schedule: {
  id: string;
  userId: string;
  dayOfWeek: string;
  scheduledStart: string;
  scheduledEnd: string;
  isRestDay: boolean;
}): Promise<void> {
  if (!isSupabaseConfigured() || isNetworkCircuitOpen()) return;
  try {
    const supabase = getSupabase();
    const row = {
      id: schedule.id,
      user_id: schedule.userId,
      day_of_week: schedule.dayOfWeek,
      scheduled_start: schedule.scheduledStart,
      scheduled_end: schedule.scheduledEnd,
      is_rest_day: schedule.isRestDay,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('schedules').upsert([row], { onConflict: 'id' });
    if (error) {
      if (isNetworkError(error)) {
        tripCircuitBreaker(error.message);
      } else {
        console.warn('[Supabase] Failed to save schedule:', error.message);
      }
    }
  } catch (err: any) {
    if (isNetworkError(err)) {
      tripCircuitBreaker(err.message);
    } else {
      console.warn('[Supabase] saveScheduleToSupabase error:', err?.message || err);
    }
  }
}

/**
 * Direct mutation: Save/update an attendance record in Supabase
 */
export async function saveAttendanceToSupabase(att: {
  id: string;
  userId: string;
  workDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  timeIn: string;
  timeOut?: string | null;
  breakHours?: number;
  totalHours?: number;
  regularHours?: number;
  overtimeHours?: number;
  lateMinutes?: number;
  attendanceStatus?: string;
  hourlyRate?: number;
  salary?: number;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}): Promise<void> {
  if (!isSupabaseConfigured() || isNetworkCircuitOpen()) return;
  try {
    const supabase = getSupabase();
    const row = {
      id: att.id,
      user_id: att.userId,
      work_date: att.workDate,
      scheduled_start: att.scheduledStart || '07:00',
      scheduled_end: att.scheduledEnd || '17:00',
      time_in: att.timeIn,
      time_out: att.timeOut || null,
      break_hours: typeof att.breakHours === 'number' ? att.breakHours : 1.0,
      total_hours: typeof att.totalHours === 'number' ? att.totalHours : 0.0,
      regular_hours: typeof att.regularHours === 'number' ? att.regularHours : 0.0,
      overtime_hours: typeof att.overtimeHours === 'number' ? att.overtimeHours : 0.0,
      late_minutes: typeof att.lateMinutes === 'number' ? att.lateMinutes : 0,
      attendance_status: att.attendanceStatus || 'ON_TIME',
      hourly_rate: typeof att.hourlyRate === 'number' ? att.hourlyRate : 100.0,
      salary: typeof att.salary === 'number' ? att.salary : 0.0,
      notes: att.notes || null,
      created_at: att.createdAt || new Date().toISOString(),
      updated_at: att.updatedAt || new Date().toISOString(),
    };
    const { error } = await supabase.from('attendance').upsert([row], { onConflict: 'id' });
    if (error) {
      if (isNetworkError(error)) {
        tripCircuitBreaker(error.message);
      } else {
        console.warn('[Supabase] Failed to save attendance:', error.message);
      }
    }
  } catch (err: any) {
    if (isNetworkError(err)) {
      tripCircuitBreaker(err.message);
    } else {
      console.warn('[Supabase] saveAttendanceToSupabase error:', err?.message || err);
    }
  }
}

/**
 * Direct mutation: Delete attendance from Supabase
 */
export async function deleteAttendanceFromSupabase(userId: string, workDate?: string, recordId?: string): Promise<void> {
  if (!isSupabaseConfigured() || isNetworkCircuitOpen()) return;
  try {
    const supabase = getSupabase();
    let query = supabase.from('attendance').delete().eq('user_id', userId);
    if (recordId) {
      query = query.eq('id', recordId);
    } else if (workDate) {
      query = query.eq('work_date', workDate);
    }
    const { error } = await query;
    if (error) {
      if (isNetworkError(error)) {
        tripCircuitBreaker(error.message);
      } else {
        console.warn('[Supabase] Failed to delete attendance:', error.message);
      }
    }
  } catch (err: any) {
    if (isNetworkError(err)) {
      tripCircuitBreaker(err.message);
    } else {
      console.warn('[Supabase] deleteAttendanceFromSupabase error:', err?.message || err);
    }
  }
}

/**
 * Direct mutation: Save an audit log to Supabase
 */
export async function saveAuditLogToSupabase(log: {
  id?: string;
  userId: string;
  action: string;
  description: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  if (!isSupabaseConfigured() || isNetworkCircuitOpen()) return;
  try {
    const supabase = getSupabase();
    const row = {
      id: log.id || `aud-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      user_id: log.userId,
      action: log.action,
      details: log.description,
      ip_address: log.ipAddress || null,
      user_agent: log.userAgent || null,
      created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('audit_logs').insert([row]);
    if (error) {
      if (isNetworkError(error)) {
        tripCircuitBreaker(error.message);
      } else {
        console.warn('[Supabase] Failed to save audit log:', error.message);
      }
    }
  } catch (err: any) {
    if (isNetworkError(err)) {
      tripCircuitBreaker(err.message);
    } else {
      console.warn('[Supabase] saveAuditLogToSupabase error:', err?.message || err);
    }
  }
}

/**
 * Syncs all records from Supabase into local in-memory SQLite
 * Ensures lightning-fast queries, offline resiliency, and instant Vercel cold-boot state
 */
export async function syncFromSupabaseToSqlite(db: SqlJsDatabase, force = false): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  if (isNetworkCircuitOpen() && !force) return false;

  const now = Date.now();
  if (!force && now - lastSyncTimestamp < SYNC_CACHE_MS) {
    return true; // Recently synced
  }
  lastSyncTimestamp = now;

  try {
    const supabase = getSupabase();

    // 1. Fetch from Supabase in parallel
    const [usersRes, schedRes, attRes, auditRes] = await Promise.all([
      supabase.from('users').select('*'),
      supabase.from('schedules').select('*'),
      supabase.from('attendance').select('*'),
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100),
    ]);

    // If network failed or tables missing
    if (usersRes.error) {
      if (isNetworkError(usersRes.error)) {
        tripCircuitBreaker(usersRes.error.message);
        return false;
      }
      if (usersRes.error.code === '42P01' || usersRes.error.code === 'PGRST205' || usersRes.error.message?.includes('schema cache')) {
        // Tables not created yet
        return false;
      }
      console.warn('[Supabase] sync users skipped:', usersRes.error.message);
      return false;
    }

    // 2. Sync Users
    if (usersRes.data && usersRes.data.length > 0) {
      for (const u of usersRes.data) {
        db.run(
          `INSERT OR REPLACE INTO users (id, full_name, email, password_hash, phone, profile_picture, account_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            u.id,
            u.full_name || 'User',
            u.email,
            u.password_hash || '',
            u.phone || null,
            u.profile_picture || null,
            u.account_status || 'ACTIVE',
            u.created_at,
            u.updated_at,
          ]
        );
      }
    }

    // 3. Sync Schedules
    if (schedRes.data && schedRes.data.length > 0) {
      for (const s of schedRes.data) {
        db.run(
          `INSERT OR REPLACE INTO schedules (id, user_id, day_of_week, start_time, end_time, is_rest_day, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            s.id,
            s.user_id,
            s.day_of_week,
            s.scheduled_start || s.start_time || '07:00',
            s.scheduled_end || s.end_time || '17:00',
            s.is_rest_day ? 1 : 0,
            s.created_at,
            s.updated_at,
          ]
        );
      }
    }

    // 4. Sync Attendance
    if (attRes.data && attRes.data.length > 0) {
      for (const a of attRes.data) {
        db.run(
          `INSERT OR REPLACE INTO attendance (
            id, user_id, work_date, scheduled_start, scheduled_end, time_in, time_out,
            break_hours, total_hours, regular_hours, overtime_hours, late_minutes,
            attendance_status, hourly_rate, salary, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            a.id,
            a.user_id,
            a.work_date,
            a.scheduled_start || '07:00',
            a.scheduled_end || '17:00',
            a.time_in,
            a.time_out || null,
            Number(a.break_hours) || 0,
            Number(a.total_hours) || 0,
            Number(a.regular_hours) || 0,
            Number(a.overtime_hours) || 0,
            Number(a.late_minutes) || 0,
            a.attendance_status || 'ON_TIME',
            Number(a.hourly_rate) || 100.0,
            Number(a.salary) || 0.0,
            a.notes || null,
            a.created_at,
            a.updated_at,
          ]
        );
      }
    }

    // 5. Sync Audit Logs
    if (auditRes.data && auditRes.data.length > 0) {
      for (const l of auditRes.data) {
        db.run(
          `INSERT OR IGNORE INTO audit_logs (id, user_id, action, description, timestamp, ip_address, user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
          [
            l.id,
            l.user_id,
            l.action,
            l.details || l.description || '',
            l.created_at,
            l.ip_address || null,
            l.user_agent || null,
          ]
        );
      }
    }

    console.log(`[Supabase] Synced from Supabase: ${usersRes.data?.length || 0} users, ${attRes.data?.length || 0} attendance records.`);
    return true;
  } catch (err: any) {
    console.warn('[Supabase] Sync failed:', err?.message || err);
    return false;
  }
}

/**
 * Migrates data from local SQLite database into Supabase
 */
export async function migrateSqliteToSupabase(): Promise<{
  usersCount: number;
  schedulesCount: number;
  attendanceCount: number;
  auditLogsCount: number;
  message: string;
}> {
  if (!isSupabaseConfigured()) {
    throw new Error('Cannot migrate: Supabase credentials are not configured in environment.');
  }

  const supabase = getSupabase();
  const { getDb } = await import('./database.ts');
  const db = await getDb();

  // 1. Migrate Users
  const userRows: any[] = [];
  const uStmt = db.prepare('SELECT * FROM users;');
  while (uStmt.step()) {
    const r = uStmt.getAsObject();
    userRows.push({
      id: r.id,
      email: r.email,
      password_hash: r.password_hash,
      full_name: r.full_name,
      phone: r.phone || null,
      profile_picture: r.profile_picture || null,
      account_status: r.account_status || 'ACTIVE',
      hourly_rate: Number(r.hourly_rate) || 100.0,
      scheduled_start_time: r.scheduled_start_time || '07:00',
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  }
  uStmt.free();

  if (userRows.length > 0) {
    const { error } = await supabase.from('users').upsert(userRows, { onConflict: 'id' });
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205' || error.message?.includes('schema cache')) {
        throw new Error(
          'Supabase tables do not exist yet. Please run the SQL schema in your Supabase SQL Editor (supabase-schema.sql) before migrating.'
        );
      }
      throw new Error(`Users migration failed: ${error.message}`);
    }
  }

  // 2. Migrate Schedules
  const scheduleRows: any[] = [];
  const sStmt = db.prepare('SELECT * FROM schedules;');
  while (sStmt.step()) {
    const r = sStmt.getAsObject();
    scheduleRows.push({
      id: r.id,
      user_id: r.user_id,
      day_of_week: r.day_of_week,
      scheduled_start: r.start_time || r.scheduled_start || '07:00',
      scheduled_end: r.end_time || r.scheduled_end || '17:00',
      is_rest_day: Boolean(r.is_rest_day),
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  }
  sStmt.free();

  if (scheduleRows.length > 0) {
    const { error } = await supabase.from('schedules').upsert(scheduleRows, { onConflict: 'id' });
    if (error) throw new Error(`Schedules migration failed: ${error.message}`);
  }

  // 3. Migrate Attendance
  const attRows: any[] = [];
  const aStmt = db.prepare('SELECT * FROM attendance;');
  while (aStmt.step()) {
    const r = aStmt.getAsObject();
    attRows.push({
      id: r.id,
      user_id: r.user_id,
      work_date: r.work_date,
      scheduled_start: r.scheduled_start || '07:00',
      scheduled_end: r.scheduled_end || '17:00',
      time_in: r.time_in,
      time_out: r.time_out || null,
      break_hours: Number(r.break_hours) || 1.0,
      total_hours: Number(r.total_hours) || 0.0,
      regular_hours: Number(r.regular_hours) || 0.0,
      overtime_hours: Number(r.overtime_hours) || 0.0,
      late_minutes: Number(r.late_minutes) || 0,
      attendance_status: r.attendance_status || 'ON_TIME',
      hourly_rate: Number(r.hourly_rate) || 100.0,
      salary: Number(r.salary) || 0.0,
      notes: r.notes || null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  }
  aStmt.free();

  if (attRows.length > 0) {
    const { error } = await supabase.from('attendance').upsert(attRows, { onConflict: 'id' });
    if (error) throw new Error(`Attendance migration failed: ${error.message}`);
  }

  // 4. Migrate Audit Logs
  const auditRows: any[] = [];
  const lStmt = db.prepare('SELECT * FROM audit_logs;');
  while (lStmt.step()) {
    const r = lStmt.getAsObject();
    auditRows.push({
      id: r.id,
      user_id: r.user_id,
      action: r.action,
      details: r.description || r.details,
      ip_address: r.ip_address || null,
      user_agent: r.user_agent || null,
      created_at: r.created_at || r.timestamp,
    });
  }
  lStmt.free();

  if (auditRows.length > 0) {
    const { error } = await supabase.from('audit_logs').upsert(auditRows, { onConflict: 'id' });
    if (error) throw new Error(`Audit logs migration failed: ${error.message}`);
  }

  return {
    usersCount: userRows.length,
    schedulesCount: scheduleRows.length,
    attendanceCount: attRows.length,
    auditLogsCount: auditRows.length,
    message: `Successfully migrated ${userRows.length} users, ${scheduleRows.length} schedules, ${attRows.length} attendance records, and ${auditRows.length} audit logs to Supabase.`,
  };
}
