import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getDb } from './database.ts';

let supabaseClient: SupabaseClient | null = null;

/**
 * Checks if Supabase credentials are configured in the environment
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  return Boolean(url && key && url.trim() !== '' && key.trim() !== '');
}

/**
 * Lazy-initializes and returns the Supabase client
 */
export function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

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

  try {
    const client = getSupabase();
    // Test simple select on users
    const { error } = await client.from('users').select('id').limit(1);

    if (error) {
      // If table doesn't exist yet, it's configured but schema needs to be run
      if (error.code === '42P01') {
        return {
          connected: true,
          configured: true,
          message: 'Connected to Supabase project, but tables are missing. Please run supabase-schema.sql.',
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
      message: 'Successfully connected to Supabase PostgreSQL database.',
    };
  } catch (err: any) {
    return {
      connected: false,
      configured: true,
      message: 'Supabase connection failed.',
      error: err.message,
    };
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
      hourly_rate: Number(r.hourly_rate) || 100.0,
      scheduled_start_time: r.scheduled_start_time || '07:00',
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  }
  uStmt.free();

  if (userRows.length > 0) {
    const { error } = await supabase.from('users').upsert(userRows, { onConflict: 'id' });
    if (error) throw new Error(`Users migration failed: ${error.message}`);
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
      scheduled_start: r.scheduled_start,
      scheduled_end: r.scheduled_end,
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
      scheduled_start: r.scheduled_start,
      scheduled_end: r.scheduled_end,
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
      details: r.details,
      ip_address: r.ip_address,
      user_agent: r.user_agent,
      created_at: r.created_at,
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
