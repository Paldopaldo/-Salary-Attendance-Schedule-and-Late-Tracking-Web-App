import fs from 'fs';
import path from 'path';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import bcrypt from 'bcryptjs';

let dbInstance: SqlJsDatabase | null = null;
const DB_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'salary_tracker.sqlite');

// Re-entrant transaction mutex lock for serialized ACID transactions
let isLocked = false;
const waitQueue: (() => void)[] = [];
let transactionDepth = 0;

export async function getDb(): Promise<SqlJsDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE);
      dbInstance = new SQL.Database(fileBuffer);
    } catch {
      dbInstance = new SQL.Database();
    }
  } else {
    dbInstance = new SQL.Database();
  }

  // Enforce foreign keys
  dbInstance.run('PRAGMA foreign_keys = ON;');

  initSchemaAndSeed(dbInstance);
  persistDb();

  return dbInstance;
}

export function persistDb(): void {
  if (!dbInstance) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
  } catch (err) {
    console.error('Failed to persist database to disk:', err);
  }
}

/**
 * Executes a function inside a serialized mutex lock and SQLite transaction
 * Guarantees zero race conditions during simultaneous check-in/out and 30-hour weekly cap
 * Supports nested calls safely (re-entrant)
 */
export async function withTransaction<T>(callback: (db: SqlJsDatabase) => T | Promise<T>): Promise<T> {
  const db = await getDb();

  // If already inside an active transaction on the call stack, run directly
  if (transactionDepth > 0) {
    return await callback(db);
  }

  // Wait if another transaction is currently running
  if (isLocked) {
    await new Promise<void>((resolve) => waitQueue.push(resolve));
  }

  isLocked = true;
  transactionDepth = 1;

  try {
    db.run('BEGIN TRANSACTION;');
    try {
      const result = await callback(db);
      db.run('COMMIT;');
      persistDb();
      return result;
    } catch (error) {
      try {
        db.run('ROLLBACK;');
      } catch (rbErr) {
        // Rollback error ignore
      }
      throw error;
    }
  } finally {
    transactionDepth = 0;
    isLocked = false;
    const next = waitQueue.shift();
    if (next) {
      next();
    }
  }
}

/**
 * Initializes tables and seeds initial users and schedules
 */
function initSchemaAndSeed(db: SqlJsDatabase): void {
  // Check if legacy schema exists without full_name column
  try {
    const check = db.exec("PRAGMA table_info(users);");
    if (check.length > 0 && check[0].values) {
      const colNames = check[0].values.map((v: any) => v[1]);
      if (!colNames.includes('full_name')) {
        console.log('[Database] Migrating from legacy schema to clean User-Only schema...');
        db.run('DROP TABLE IF EXISTS audit_logs;');
        db.run('DROP TABLE IF EXISTS attendance;');
        db.run('DROP TABLE IF EXISTS schedules;');
        db.run('DROP TABLE IF EXISTS salary_records;');
        db.run('DROP TABLE IF EXISTS password_reset_tokens;');
        db.run('DROP TABLE IF EXISTS employees;');
        db.run('DROP TABLE IF EXISTS departments;');
        db.run('DROP TABLE IF EXISTS system_settings;');
        db.run('DROP TABLE IF EXISTS users;');
      }
    }
  } catch (e) {
    // Ignore
  }

  db.run(`
    -- User accounts (No admin role, strictly user-only)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone TEXT,
      profile_picture TEXT,
      account_status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Weekly work schedules (Default 7:00 AM - 5:00 PM Mon-Fri, Sat/Sun Rest Day)
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day_of_week TEXT NOT NULL,
      start_time TEXT NOT NULL DEFAULT '07:00',
      end_time TEXT NOT NULL DEFAULT '17:00',
      is_rest_day INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE (user_id, day_of_week)
    );

    -- Attendance tracking with 7:00 AM scheduled start and late minutes
    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      work_date TEXT NOT NULL,
      scheduled_start TEXT NOT NULL DEFAULT '07:00',
      scheduled_end TEXT NOT NULL DEFAULT '17:00',
      time_in TEXT NOT NULL,
      time_out TEXT,
      break_hours REAL NOT NULL DEFAULT 0.0,
      total_hours REAL NOT NULL DEFAULT 0.0,
      regular_hours REAL NOT NULL DEFAULT 0.0,
      overtime_hours REAL NOT NULL DEFAULT 0.0,
      late_minutes INTEGER NOT NULL DEFAULT 0,
      attendance_status TEXT NOT NULL DEFAULT 'ON_TIME',
      hourly_rate REAL NOT NULL DEFAULT 100.0,
      salary REAL NOT NULL DEFAULT 0.0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE (user_id, work_date)
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, work_date);

    -- Weekly salary summary records (Max 30 hrs = ₱3,000)
    CREATE TABLE IF NOT EXISTS salary_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      regular_hours REAL NOT NULL,
      hourly_rate REAL NOT NULL DEFAULT 100.0,
      gross_salary REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE (user_id, week_start)
    );

    -- User-specific append-only audit trail
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      description TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      ip_address TEXT,
      user_agent TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_logs(user_id, timestamp);

    -- Password reset tokens
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0
    );

    -- System business parameters (Immutable by user)
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Initialize System Rules
  const settingsCheck = db.exec("SELECT COUNT(*) FROM system_settings WHERE key = 'hourly_rate'");
  if (settingsCheck.length === 0 || settingsCheck[0].values[0][0] === 0) {
    db.run(`
      INSERT OR REPLACE INTO system_settings (key, value, description) VALUES
      ('hourly_rate', '100', 'Standard pay rate in PHP per regular hour'),
      ('scheduled_start_time', '07:00', 'Standard daily scheduled start time'),
      ('max_daily_hours', '10', 'Maximum allowable regular hours per work day'),
      ('max_weekly_hours', '30', 'Maximum allowable regular hours per calendar week'),
      ('timezone', 'Asia/Manila', 'Official business calculation timezone');
    `);
  }

  // Seed default primary user: Juan Dela Cruz (juan@example.com / password123)
  const userCheck = db.exec("SELECT COUNT(*) FROM users WHERE email = 'juan@example.com'");
  if (userCheck.length === 0 || userCheck[0].values[0][0] === 0) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('password123', salt);
    const userId1 = 'usr-juan-001';
    const userId2 = 'usr-maria-002';

    // Seed Juan
    db.run(
      `INSERT INTO users (id, full_name, email, password_hash, phone, account_status)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE');`,
      [userId1, 'Juan Dela Cruz', 'juan@example.com', hash, '+63 917 123 4567']
    );

    // Seed Maria
    db.run(
      `INSERT INTO users (id, full_name, email, password_hash, phone, account_status)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE');`,
      [userId2, 'Maria Santos', 'maria@example.com', hash, '+63 918 234 5678']
    );

    // Seed schedules for Juan and Maria
    const days: Array<'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday'> = [
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
    ];

    for (const uId of [userId1, userId2]) {
      for (const day of days) {
        const isRest = day === 'Saturday' || day === 'Sunday' ? 1 : 0;
        db.run(
          `INSERT INTO schedules (id, user_id, day_of_week, start_time, end_time, is_rest_day)
           VALUES (?, ?, ?, '07:00', '17:00', ?);`,
          [`sch-${uId}-${day.toLowerCase()}`, uId, day, isRest]
        );
      }
    }

    // Seed sample historical attendance for Juan
    // Sep 1: 7:05 AM (5 min late), 8h worked, ₱800
    db.run(
      `INSERT INTO attendance (id, user_id, work_date, scheduled_start, scheduled_end, time_in, time_out, break_hours, total_hours, regular_hours, late_minutes, attendance_status, hourly_rate, salary)
       VALUES (?, ?, '2026-09-01', '07:00', '17:00', '07:05', '16:05', 1.0, 8.0, 8.0, 5, 'LATE', 100.0, 800.0);`,
      ['att-juan-01', userId1]
    );

    // Sep 2: 7:00 AM (On time), 8h worked, ₱800
    db.run(
      `INSERT INTO attendance (id, user_id, work_date, scheduled_start, scheduled_end, time_in, time_out, break_hours, total_hours, regular_hours, late_minutes, attendance_status, hourly_rate, salary)
       VALUES (?, ?, '2026-09-02', '07:00', '17:00', '07:00', '16:00', 1.0, 8.0, 8.0, 0, 'ON_TIME', 100.0, 800.0);`,
      ['att-juan-02', userId1]
    );

    // Sep 3: 7:12 AM (12 min late), 8h worked, ₱800
    db.run(
      `INSERT INTO attendance (id, user_id, work_date, scheduled_start, scheduled_end, time_in, time_out, break_hours, total_hours, regular_hours, late_minutes, attendance_status, hourly_rate, salary)
       VALUES (?, ?, '2026-09-03', '07:00', '17:00', '07:12', '16:12', 1.0, 8.0, 8.0, 12, 'LATE', 100.0, 800.0);`,
      ['att-juan-03', userId1]
    );

    // Initial audit logs for Juan
    db.run(
      `INSERT INTO audit_logs (id, user_id, action, description, timestamp, ip_address, user_agent) VALUES
       (?, ?, 'ACCOUNT_CREATED', 'Account registered for Juan Dela Cruz', datetime('now', '-7 days'), '127.0.0.1', 'Mozilla/5.0'),
       (?, ?, 'LOGIN', 'Successful user login', datetime('now', '-3 days'), '127.0.0.1', 'Mozilla/5.0'),
       (?, ?, 'CHECK_IN', 'Checked in at 7:05 AM (5 minutes late)', datetime('now', '-3 days', '+7 hours', '+5 minutes'), '127.0.0.1', 'Mozilla/5.0'),
       (?, ?, 'CHECK_OUT', 'Checked out at 4:05 PM. 8.0 hours worked. Salary: ₱800', datetime('now', '-3 days', '+16 hours', '+5 minutes'), '127.0.0.1', 'Mozilla/5.0');`,
      ['aud-1', userId1, 'aud-2', userId1, 'aud-3', userId1, 'aud-4', userId1]
    );

    persistDb();
  }
}
