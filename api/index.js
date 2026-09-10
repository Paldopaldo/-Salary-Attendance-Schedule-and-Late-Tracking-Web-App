// src/serverless.ts
import dotenv from "dotenv";

// src/app.ts
import express from "express";

import app from "../src/app.ts";


// src/routes/auth.routes.ts
import { Router } from "express";
import bcrypt2 from "bcryptjs";
import jwt2 from "jsonwebtoken";
import crypto from "crypto";

// src/db/database.ts
import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import bcrypt from "bcryptjs";
var dbInstance = null;
var isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
var DB_DIR = isServerless ? "/tmp/data" : path.resolve(process.cwd(), "data");
var DB_FILE = path.join(DB_DIR, "salary_tracker.sqlite");
var SEED_FILE = path.resolve(process.cwd(), "data", "salary_tracker.sqlite");
var isLocked = false;
var waitQueue = [];
var transactionDepth = 0;
async function getDb() {
  if (dbInstance) {
    return dbInstance;
  }
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn("[Database] Read-only directory access:", err);
  }
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE);
      dbInstance = new SQL.Database(fileBuffer);
    } catch {
      dbInstance = new SQL.Database();
    }
  } else if (fs.existsSync(SEED_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(SEED_FILE);
      dbInstance = new SQL.Database(fileBuffer);
    } catch {
      dbInstance = new SQL.Database();
    }
  } else {
    dbInstance = new SQL.Database();
  }
  dbInstance.run("PRAGMA foreign_keys = ON;");
  initSchemaAndSeed(dbInstance);
  persistDb();
  return dbInstance;
}
function persistDb() {
  if (!dbInstance) return;
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
  } catch (err) {
    console.warn("Could not persist database to disk (e.g. read-only environment):", err);
  }
}
async function withTransaction(callback) {
  const db = await getDb();
  if (transactionDepth > 0) {
    return await callback(db);
  }
  if (isLocked) {
    await new Promise((resolve) => waitQueue.push(resolve));
  }
  isLocked = true;
  transactionDepth = 1;
  try {
    db.run("BEGIN TRANSACTION;");
    try {
      const result = await callback(db);
      db.run("COMMIT;");
      persistDb();
      return result;
    } catch (error) {
      try {
        db.run("ROLLBACK;");
      } catch (rbErr) {
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
function initSchemaAndSeed(db) {
  try {
    const check = db.exec("PRAGMA table_info(users);");
    if (check.length > 0 && check[0].values) {
      const colNames = check[0].values.map((v) => v[1]);
      if (!colNames.includes("full_name")) {
        console.log("[Database] Migrating from legacy schema to clean User-Only schema...");
        db.run("DROP TABLE IF EXISTS audit_logs;");
        db.run("DROP TABLE IF EXISTS attendance;");
        db.run("DROP TABLE IF EXISTS schedules;");
        db.run("DROP TABLE IF EXISTS salary_records;");
        db.run("DROP TABLE IF EXISTS password_reset_tokens;");
        db.run("DROP TABLE IF EXISTS employees;");
        db.run("DROP TABLE IF EXISTS departments;");
        db.run("DROP TABLE IF EXISTS system_settings;");
        db.run("DROP TABLE IF EXISTS users;");
      }
    }
  } catch (e) {
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

    -- Weekly salary summary records (Max 30 hrs = \u20B13,000)
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
  const userCheck = db.exec("SELECT COUNT(*) FROM users WHERE email = 'juan@example.com'");
  if (userCheck.length === 0 || userCheck[0].values[0][0] === 0) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync("password123", salt);
    const userId1 = "usr-juan-001";
    const userId2 = "usr-maria-002";
    db.run(
      `INSERT INTO users (id, full_name, email, password_hash, phone, account_status)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE');`,
      [userId1, "Juan Dela Cruz", "juan@example.com", hash, "+63 917 123 4567"]
    );
    db.run(
      `INSERT INTO users (id, full_name, email, password_hash, phone, account_status)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE');`,
      [userId2, "Maria Santos", "maria@example.com", hash, "+63 918 234 5678"]
    );
    const days = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday"
    ];
    for (const uId of [userId1, userId2]) {
      for (const day of days) {
        const isRest = day === "Saturday" || day === "Sunday" ? 1 : 0;
        db.run(
          `INSERT INTO schedules (id, user_id, day_of_week, start_time, end_time, is_rest_day)
           VALUES (?, ?, ?, '07:00', '17:00', ?);`,
          [`sch-${uId}-${day.toLowerCase()}`, uId, day, isRest]
        );
      }
    }
    db.run(
      `INSERT INTO attendance (id, user_id, work_date, scheduled_start, scheduled_end, time_in, time_out, break_hours, total_hours, regular_hours, late_minutes, attendance_status, hourly_rate, salary)
       VALUES (?, ?, '2026-09-01', '07:00', '17:00', '07:05', '16:05', 1.0, 8.0, 8.0, 5, 'LATE', 100.0, 800.0);`,
      ["att-juan-01", userId1]
    );
    db.run(
      `INSERT INTO attendance (id, user_id, work_date, scheduled_start, scheduled_end, time_in, time_out, break_hours, total_hours, regular_hours, late_minutes, attendance_status, hourly_rate, salary)
       VALUES (?, ?, '2026-09-02', '07:00', '17:00', '07:00', '16:00', 1.0, 8.0, 8.0, 0, 'ON_TIME', 100.0, 800.0);`,
      ["att-juan-02", userId1]
    );
    db.run(
      `INSERT INTO attendance (id, user_id, work_date, scheduled_start, scheduled_end, time_in, time_out, break_hours, total_hours, regular_hours, late_minutes, attendance_status, hourly_rate, salary)
       VALUES (?, ?, '2026-09-03', '07:00', '17:00', '07:12', '16:12', 1.0, 8.0, 8.0, 12, 'LATE', 100.0, 800.0);`,
      ["att-juan-03", userId1]
    );
    db.run(
      `INSERT INTO audit_logs (id, user_id, action, description, timestamp, ip_address, user_agent) VALUES
       (?, ?, 'ACCOUNT_CREATED', 'Account registered for Juan Dela Cruz', datetime('now', '-7 days'), '127.0.0.1', 'Mozilla/5.0'),
       (?, ?, 'LOGIN', 'Successful user login', datetime('now', '-3 days'), '127.0.0.1', 'Mozilla/5.0'),
       (?, ?, 'CHECK_IN', 'Checked in at 7:05 AM (5 minutes late)', datetime('now', '-3 days', '+7 hours', '+5 minutes'), '127.0.0.1', 'Mozilla/5.0'),
       (?, ?, 'CHECK_OUT', 'Checked out at 4:05 PM. 8.0 hours worked. Salary: \u20B1800', datetime('now', '-3 days', '+16 hours', '+5 minutes'), '127.0.0.1', 'Mozilla/5.0');`,
      ["aud-1", userId1, "aud-2", userId1, "aud-3", userId1, "aud-4", userId1]
    );
    persistDb();
  }
}

// src/services/audit.service.ts
var AuditService = class {
  /**
   * Appends an immutable audit log entry for a user action
   */
  static async logAction(userId, action, description, ipAddress = "127.0.0.1", userAgent = "App-Client") {
    try {
      const db = await getDb();
      const id = `aud-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      db.run(
        `INSERT INTO audit_logs (id, user_id, action, description, timestamp, ip_address, user_agent)
         VALUES (?, ?, ?, ?, datetime('now'), ?, ?);`,
        [id, userId, action, description, ipAddress, userAgent]
      );
    } catch (err) {
      console.error("Failed to write audit log:", err);
    }
  }
  /**
   * Retrieves audit logs for the authenticated user only
   */
  static async getUserAuditLogs(userId, limit = 50) {
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT id, user_id, action, description, timestamp, ip_address, user_agent
      FROM audit_logs
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT ?;
    `);
    stmt.bind([userId, limit]);
    const logs = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      logs.push({
        id: row.id,
        userId: row.user_id,
        action: row.action,
        description: row.description,
        timestamp: row.timestamp,
        ipAddress: row.ip_address,
        userAgent: row.user_agent
      });
    }
    stmt.free();
    return logs;
  }
};

// src/services/schedule.service.ts
var ScheduleService = class {
  /**
   * Retrieves the 7-day schedule for a user.
   * If not found, initializes default 7:00 AM - 5:00 PM (Mon-Fri) & Sat/Sun Rest Day
   */
  static async getUserSchedule(userId) {
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT id, user_id, day_of_week, start_time, end_time, is_rest_day
      FROM schedules
      WHERE user_id = ?
      ORDER BY 
        CASE day_of_week
          WHEN 'Monday' THEN 1
          WHEN 'Tuesday' THEN 2
          WHEN 'Wednesday' THEN 3
          WHEN 'Thursday' THEN 4
          WHEN 'Friday' THEN 5
          WHEN 'Saturday' THEN 6
          WHEN 'Sunday' THEN 7
          ELSE 8
        END;
    `);
    stmt.bind([userId]);
    const schedules = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      schedules.push({
        id: row.id,
        userId: row.user_id,
        dayOfWeek: row.day_of_week,
        scheduledStart: row.start_time,
        scheduledEnd: row.end_time,
        isRestDay: Boolean(row.is_rest_day)
      });
    }
    stmt.free();
    if (schedules.length === 0) {
      await this.initDefaultSchedule(userId);
      return this.getUserSchedule(userId);
    }
    return schedules;
  }
  /**
   * Gets schedule for a specific day of week (e.g. 'Monday')
   */
  static async getScheduleForDay(userId, dayOfWeek) {
    const schedules = await this.getUserSchedule(userId);
    const found = schedules.find((s) => s.dayOfWeek.toLowerCase() === dayOfWeek.toLowerCase());
    if (found) return found;
    return {
      id: `sch-${userId}-${dayOfWeek.toLowerCase()}`,
      userId,
      dayOfWeek,
      scheduledStart: "07:00",
      scheduledEnd: "17:00",
      isRestDay: dayOfWeek === "Saturday" || dayOfWeek === "Sunday"
    };
  }
  /**
   * Updates schedule for a user on a given day
   */
  static async updateScheduleDay(userId, dayOfWeek, data) {
    return withTransaction((db) => {
      const id = `sch-${userId}-${dayOfWeek.toLowerCase()}`;
      db.run(
        `INSERT OR REPLACE INTO schedules (id, user_id, day_of_week, start_time, end_time, is_rest_day, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'));`,
        [id, userId, dayOfWeek, data.scheduledStart, data.scheduledEnd, data.isRestDay ? 1 : 0]
      );
      return {
        id,
        userId,
        dayOfWeek,
        scheduledStart: data.scheduledStart,
        scheduledEnd: data.scheduledEnd,
        isRestDay: data.isRestDay
      };
    });
  }
  static async initDefaultSchedule(userId) {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    await withTransaction((db) => {
      for (const day of days) {
        const isRest = day === "Saturday" || day === "Sunday" ? 1 : 0;
        db.run(
          `INSERT OR IGNORE INTO schedules (id, user_id, day_of_week, start_time, end_time, is_rest_day)
           VALUES (?, ?, ?, '07:00', '17:00', ?);`,
          [`sch-${userId}-${day.toLowerCase()}`, userId, day, isRest]
        );
      }
    });
  }
};

// src/middleware/auth.middleware.ts
import jwt from "jsonwebtoken";
var JWT_SECRET = process.env.JWT_SECRET || "salary-tracker-user-secret-2026";
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required. Please log in." });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session. Please log in again." });
  }
}

// src/routes/auth.routes.ts
var router = Router();
var loginAttempts = /* @__PURE__ */ new Map();
var MAX_ATTEMPTS = 5;
var LOCKOUT_MS = 5 * 60 * 1e3;
function checkLockout(key) {
  const record = loginAttempts.get(key);
  if (!record) return { isLocked: false, remainingSeconds: 0 };
  if (record.count >= MAX_ATTEMPTS) {
    const now = Date.now();
    if (now < record.lockedUntil) {
      const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1e3);
      return { isLocked: true, remainingSeconds };
    } else {
      loginAttempts.delete(key);
    }
  }
  return { isLocked: false, remainingSeconds: 0 };
}
function recordFailedAttempt(key) {
  const existing = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  existing.count += 1;
  if (existing.count >= MAX_ATTEMPTS) {
    existing.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  loginAttempts.set(key, existing);
}
function clearAttempts(key) {
  loginAttempts.delete(key);
}
router.post("/register", async (req, res) => {
  try {
    const { email, password, fullName, phone } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json({ error: "Full name, email, and password are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }
    const cleanEmail = email.trim().toLowerCase();
    const db = await getDb();
    const checkStmt = db.prepare("SELECT id FROM users WHERE email = ?");
    checkStmt.bind([cleanEmail]);
    if (checkStmt.step()) {
      checkStmt.free();
      return res.status(400).json({ error: "An account with this email already exists." });
    }
    checkStmt.free();
    const userId = `usr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const salt = bcrypt2.genSaltSync(10);
    const passwordHash = bcrypt2.hashSync(password, salt);
    await withTransaction(async (dbTx) => {
      dbTx.run(
        `INSERT INTO users (id, full_name, email, password_hash, phone, account_status)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE');`,
        [userId, fullName.trim(), cleanEmail, passwordHash, phone?.trim() || null]
      );
    });
    await ScheduleService.getUserSchedule(userId);
    await AuditService.logAction(
      userId,
      "REGISTER",
      `User account created for ${fullName}`,
      req.ip || "127.0.0.1",
      req.headers["user-agent"] || "App-Client"
    );
    const token = jwt2.sign({ id: userId, email: cleanEmail, fullName }, JWT_SECRET, { expiresIn: "7d" });
    const user = {
      id: userId,
      fullName,
      email: cleanEmail,
      phone: phone?.trim(),
      accountStatus: "ACTIVE",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    return res.status(201).json({
      message: "Account successfully registered.",
      token,
      user
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: err.message || "Registration failed." });
  }
});
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    const cleanEmail = email.trim().toLowerCase();
    const lockoutKey = `${req.ip || "127.0.0.1"}_${cleanEmail}`;
    const lockout = checkLockout(lockoutKey);
    if (lockout.isLocked) {
      return res.status(429).json({
        error: `Too many failed login attempts. Account temporarily locked. Please try again in ${lockout.remainingSeconds} seconds.`
      });
    }
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT id, full_name, email, password_hash, phone, profile_picture, account_status, created_at, updated_at
      FROM users
      WHERE email = ?;
    `);
    stmt.bind([cleanEmail]);
    if (!stmt.step()) {
      stmt.free();
      recordFailedAttempt(lockoutKey);
      return res.status(401).json({ error: "Invalid email or password." });
    }
    const row = stmt.getAsObject();
    stmt.free();
    if (row.account_status !== "ACTIVE") {
      return res.status(403).json({ error: "Account is deactivated. Please contact support." });
    }
    const isMatch = bcrypt2.compareSync(password, row.password_hash);
    if (!isMatch) {
      recordFailedAttempt(lockoutKey);
      await AuditService.logAction(
        row.id,
        "FAILED_LOGIN",
        `Failed password attempt for ${cleanEmail}`,
        req.ip || "127.0.0.1",
        req.headers["user-agent"] || "App-Client"
      );
      return res.status(401).json({ error: "Invalid email or password." });
    }
    clearAttempts(lockoutKey);
    const token = jwt2.sign(
      { id: row.id, email: row.email, fullName: row.full_name },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    await AuditService.logAction(
      row.id,
      "LOGIN",
      `Successful login from IP ${req.ip || "127.0.0.1"}`,
      req.ip || "127.0.0.1",
      req.headers["user-agent"] || "App-Client"
    );
    const user = {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone || void 0,
      profilePicture: row.profile_picture || void 0,
      accountStatus: row.account_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    return res.json({
      message: "Login successful.",
      token,
      user
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Login failed." });
  }
});
router.post("/logout", authenticate, async (req, res) => {
  if (req.user) {
    await AuditService.logAction(
      req.user.id,
      "LOGOUT",
      "User logged out",
      req.ip || "127.0.0.1",
      req.headers["user-agent"] || "App-Client"
    );
  }
  return res.json({ message: "Successfully logged out." });
});
router.get("/me", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT id, full_name, email, phone, profile_picture, account_status, created_at, updated_at
      FROM users
      WHERE id = ?;
    `);
    stmt.bind([req.user.id]);
    if (!stmt.step()) {
      stmt.free();
      return res.status(404).json({ error: "User not found." });
    }
    const row = stmt.getAsObject();
    stmt.free();
    const user = {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone || void 0,
      profilePicture: row.profile_picture || void 0,
      accountStatus: row.account_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router.post("/demo-switch", async (req, res) => {
  try {
    const { email } = req.body;
    const targetEmail = (email || "juan@example.com").trim().toLowerCase();
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT id, full_name, email, phone, profile_picture, account_status, created_at, updated_at
      FROM users
      WHERE email = ?;
    `);
    stmt.bind([targetEmail]);
    if (!stmt.step()) {
      stmt.free();
      const firstStmt = db.prepare("SELECT id, full_name, email, phone, profile_picture, account_status, created_at, updated_at FROM users LIMIT 1;");
      if (!firstStmt.step()) {
        firstStmt.free();
        return res.status(404).json({ error: "No users found." });
      }
      const first = firstStmt.getAsObject();
      firstStmt.free();
      const token2 = jwt2.sign({ id: first.id, email: first.email, fullName: first.full_name }, JWT_SECRET, { expiresIn: "7d" });
      return res.json({ token: token2, user: first });
    }
    const row = stmt.getAsObject();
    stmt.free();
    const token = jwt2.sign({ id: row.id, email: row.email, fullName: row.full_name }, JWT_SECRET, { expiresIn: "7d" });
    const user = {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone || void 0,
      profilePicture: row.profile_picture || void 0,
      accountStatus: row.account_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    return res.json({ token, user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });
    const cleanEmail = email.trim().toLowerCase();
    const db = await getDb();
    const stmt = db.prepare("SELECT id FROM users WHERE email = ?");
    stmt.bind([cleanEmail]);
    if (!stmt.step()) {
      stmt.free();
      return res.json({ message: "If this email is registered, a password reset token has been issued." });
    }
    const userId = stmt.getAsObject().id;
    stmt.free();
    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1e3).toISOString();
    db.run("INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)", [
      token,
      userId,
      expiresAt
    ]);
    await AuditService.logAction(
      userId,
      "PASSWORD_RESET_REQUESTED",
      `Password reset token generated for ${cleanEmail}`,
      req.ip || "127.0.0.1"
    );
    return res.json({
      message: "Password reset token generated successfully.",
      resetToken: token
      // Returned for dev testing convenience
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: "Reset token and new password are required." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT token, user_id, expires_at, used
      FROM password_reset_tokens
      WHERE token = ? AND used = 0;
    `);
    stmt.bind([token]);
    if (!stmt.step()) {
      stmt.free();
      return res.status(400).json({ error: "Invalid or expired password reset token." });
    }
    const row = stmt.getAsObject();
    stmt.free();
    const expiresAt = new Date(row.expires_at).getTime();
    if (Date.now() > expiresAt) {
      return res.status(400).json({ error: "Password reset token has expired." });
    }
    const userId = row.user_id;
    const salt = bcrypt2.genSaltSync(10);
    const hash = bcrypt2.hashSync(newPassword, salt);
    await withTransaction((dbTx) => {
      dbTx.run('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?;', [
        hash,
        userId
      ]);
      dbTx.run("UPDATE password_reset_tokens SET used = 1 WHERE token = ?;", [token]);
    });
    await AuditService.logAction(
      userId,
      "PASSWORD_CHANGED",
      "Password successfully reset via token",
      req.ip || "127.0.0.1"
    );
    return res.json({ message: "Password has been reset successfully. You can now log in." });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router.get("/profile", authenticate, async (req, res) => {
  const db = await getDb();
  const stmt = db.prepare("SELECT id, full_name, email, phone, profile_picture, account_status, created_at, updated_at FROM users WHERE id = ?");
  stmt.bind([req.user.id]);
  if (!stmt.step()) {
    stmt.free();
    return res.status(404).json({ error: "User not found." });
  }
  const row = stmt.getAsObject();
  stmt.free();
  return res.json({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    profilePicture: row.profile_picture,
    accountStatus: row.account_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
});
router.put("/profile", authenticate, async (req, res) => {
  try {
    const { fullName, phone, profilePicture } = req.body;
    const userId = req.user.id;
    await withTransaction((db) => {
      db.run(
        `UPDATE users
         SET full_name = COALESCE(?, full_name),
             phone = COALESCE(?, phone),
             profile_picture = COALESCE(?, profile_picture),
             updated_at = datetime('now')
         WHERE id = ?;`,
        [fullName?.trim() || null, phone?.trim() || null, profilePicture || null, userId]
      );
    });
    await AuditService.logAction(
      userId,
      "PROFILE_UPDATED",
      "User updated profile information",
      req.ip || "127.0.0.1"
    );
    return res.json({ message: "Profile updated successfully." });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router.put("/profile/password", authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters long." });
    }
    const userId = req.user.id;
    const db = await getDb();
    const stmt = db.prepare("SELECT password_hash FROM users WHERE id = ?");
    stmt.bind([userId]);
    if (!stmt.step()) {
      stmt.free();
      return res.status(404).json({ error: "User not found." });
    }
    const hash = stmt.getAsObject().password_hash;
    stmt.free();
    const isMatch = bcrypt2.compareSync(currentPassword, hash);
    if (!isMatch) {
      return res.status(400).json({ error: "Current password does not match." });
    }
    const salt = bcrypt2.genSaltSync(10);
    const newHash = bcrypt2.hashSync(newPassword, salt);
    await withTransaction((dbTx) => {
      dbTx.run('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?;', [
        newHash,
        userId
      ]);
    });
    await AuditService.logAction(
      userId,
      "PASSWORD_CHANGED",
      "User changed account password",
      req.ip || "127.0.0.1"
    );
    return res.json({ message: "Password updated successfully." });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
var auth_routes_default = router;

// src/routes/attendance.routes.ts
import { Router as Router2 } from "express";

// src/utils/timezone.ts
var TIMEZONE = "Asia/Manila";
function getManilaNow() {
  const now = /* @__PURE__ */ new Date();
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const date = dateFormatter.format(now);
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const time = timeFormatter.format(now);
  const displayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
  const formattedTime = displayFormatter.format(now);
  const month = date.substring(0, 7);
  return {
    date,
    time,
    formattedTime,
    month,
    isoString: now.toISOString(),
    timestamp: now.getTime()
  };
}
function formatTo12Hour(time24) {
  if (!time24) return "";
  const [hStr, mStr] = time24.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || "0", 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  const displayMin = m < 10 ? `0${m}` : `${m}`;
  return `${displayHour}:${displayMin} ${ampm}`;
}
function calculateLateMinutes(timeIn, scheduledStart = "07:00") {
  if (!timeIn || !scheduledStart) return 0;
  const [inH, inM] = timeIn.split(":").map(Number);
  const [startH, startM] = scheduledStart.split(":").map(Number);
  const actualMinutes = inH * 60 + inM;
  const scheduledMinutes = startH * 60 + startM;
  const diff = actualMinutes - scheduledMinutes;
  return diff > 0 ? diff : 0;
}
function getManilaWeekRange(dateStr) {
  const targetDateStr = dateStr || getManilaNow().date;
  const [year, month, day] = targetDateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = d.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const formatIso = (dt) => dt.toISOString().split("T")[0];
  const weekStart = formatIso(monday);
  const weekEnd = formatIso(sunday);
  const startMonthName = monday.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const endMonthName = sunday.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const weekLabel = `${startMonthName} ${monday.getUTCDate()} - ${endMonthName} ${sunday.getUTCDate()}, ${sunday.getUTCFullYear()}`;
  return {
    weekStart,
    weekEnd,
    weekLabel
  };
}
function getDayOfWeek(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleString("en-US", { weekday: "long", timeZone: "UTC" });
}

// src/services/attendance.service.ts
var AttendanceService = class {
  /**
   * Performs atomic Check-In for the authenticated user
   */
  static async checkIn(userId, options) {
    return withTransaction(async (db) => {
      const manila = getManilaNow();
      const workDate = options?.customWorkDate || manila.date;
      const timeIn = options?.customTimeIn || manila.time;
      const dayOfWeek = getDayOfWeek(workDate);
      const existingStmt = db.prepare("SELECT id, attendance_status, time_in, time_out FROM attendance WHERE user_id = ? AND work_date = ?");
      existingStmt.bind([userId, workDate]);
      if (existingStmt.step()) {
        const existing = existingStmt.getAsObject();
        existingStmt.free();
        if (!existing.time_out) {
          throw new Error("You are already checked in for today.");
        } else {
          throw new Error("You have already completed your shift for today.");
        }
      }
      existingStmt.free();
      const schedule = await ScheduleService.getScheduleForDay(userId, dayOfWeek);
      const scheduledStart = schedule.scheduledStart || "07:00";
      const scheduledEnd = schedule.scheduledEnd || "17:00";
      const weekRange = getManilaWeekRange(workDate);
      const weeklyHoursStmt = db.prepare(`
        SELECT COALESCE(SUM(regular_hours), 0) as weekly_hours
        FROM attendance
        WHERE user_id = ? AND work_date >= ? AND work_date <= ? AND time_out IS NOT NULL;
      `);
      weeklyHoursStmt.bind([userId, weekRange.weekStart, weekRange.weekEnd]);
      let currentWeeklyHours = 0;
      if (weeklyHoursStmt.step()) {
        currentWeeklyHours = Number(weeklyHoursStmt.getAsObject().weekly_hours) || 0;
      }
      weeklyHoursStmt.free();
      if (currentWeeklyHours >= 30) {
        throw new Error("Weekly limit reached: You have already completed 30 regular hours this week.");
      }
      const lateMinutes = calculateLateMinutes(timeIn, scheduledStart);
      const attendanceStatus = schedule.isRestDay ? "REST_DAY" : lateMinutes > 0 ? "LATE" : "ON_TIME";
      const id = `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      db.run(
        `INSERT INTO attendance (
          id, user_id, work_date, scheduled_start, scheduled_end, time_in,
          break_hours, total_hours, regular_hours, overtime_hours, late_minutes,
          attendance_status, hourly_rate, salary, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0.0, 0.0, 0.0, 0.0, ?, ?, 100.0, 0.0, ?, datetime('now'), datetime('now'));`,
        [
          id,
          userId,
          workDate,
          scheduledStart,
          scheduledEnd,
          timeIn,
          lateMinutes,
          attendanceStatus,
          options?.notes || null
        ]
      );
      const record = {
        id,
        userId,
        workDate,
        scheduledStart,
        scheduledEnd,
        timeIn,
        breakHours: 0,
        totalHours: 0,
        regularHours: 0,
        overtimeHours: 0,
        lateMinutes,
        attendanceStatus,
        hourlyRate: 100,
        salary: 0,
        notes: options?.notes,
        createdAt: manila.isoString,
        updatedAt: manila.isoString
      };
      const lateMsg = lateMinutes > 0 ? `${lateMinutes} minutes late` : "on time";
      await AuditService.logAction(
        userId,
        "CHECK_IN",
        `Checked in at ${formatTo12Hour(timeIn)} (Scheduled: ${formatTo12Hour(scheduledStart)} \xB7 ${lateMsg})`,
        options?.ipAddress || "127.0.0.1",
        options?.userAgent || "App-Client"
      );
      return {
        message: lateMinutes > 0 ? `Successfully checked in at ${formatTo12Hour(timeIn)}. You are ${lateMinutes} minutes late.` : `Successfully checked in at ${formatTo12Hour(timeIn)}. You are on time!`,
        record,
        lateMinutes,
        lateStatus: attendanceStatus
      };
    });
  }
  /**
   * Performs atomic Check-Out and calculates working hours, salary, and enforces 10h daily and 30h weekly limits
   */
  static async checkOut(userId, options) {
    return withTransaction(async (db) => {
      const manila = getManilaNow();
      const workDate = options?.customWorkDate || manila.date;
      const timeOut = options?.customTimeOut || manila.time;
      const breakHours = typeof options?.breakHours === "number" ? options.breakHours : 1;
      const findStmt = db.prepare(`
        SELECT id, scheduled_start, scheduled_end, time_in, late_minutes, attendance_status, notes
        FROM attendance
        WHERE user_id = ? AND work_date = ? AND time_out IS NULL;
      `);
      findStmt.bind([userId, workDate]);
      if (!findStmt.step()) {
        findStmt.free();
        throw new Error("You do not have an active check-in for today.");
      }
      const active = findStmt.getAsObject();
      findStmt.free();
      const timeIn = active.time_in;
      const [inH, inM] = timeIn.split(":").map(Number);
      const [outH, outM] = timeOut.split(":").map(Number);
      const elapsedMinutes = outH * 60 + outM - (inH * 60 + inM);
      if (elapsedMinutes <= 0) {
        throw new Error("Time Out must be after Time In.");
      }
      const grossHours = Math.round(elapsedMinutes / 60 * 100) / 100;
      if (breakHours >= grossHours) {
        throw new Error("Break hours cannot be greater than or equal to total elapsed shift duration.");
      }
      const netHours = Math.max(0, Math.round((grossHours - breakHours) * 100) / 100);
      const regularHours = Math.min(10, netHours);
      const overtimeHours = Math.max(0, Math.round((netHours - regularHours) * 100) / 100);
      const weekRange = getManilaWeekRange(workDate);
      const weekStmt = db.prepare(`
        SELECT COALESCE(SUM(regular_hours), 0) as approved_weekly_hours
        FROM attendance
        WHERE user_id = ? AND work_date >= ? AND work_date <= ? AND id != ?;
      `);
      weekStmt.bind([userId, weekRange.weekStart, weekRange.weekEnd, active.id]);
      let currentWeeklyHours = 0;
      if (weekStmt.step()) {
        currentWeeklyHours = Number(weekStmt.getAsObject().approved_weekly_hours) || 0;
      }
      weekStmt.free();
      const remainingWeeklyHours = Math.max(0, Math.round((30 - currentWeeklyHours) * 100) / 100);
      if (regularHours > remainingWeeklyHours) {
        throw new Error(
          `Weekly limit exceeded: You only have ${remainingWeeklyHours.toFixed(
            1
          )} regular working hours remaining this week.`
        );
      }
      const hourlyRate = 100;
      const dailySalary = Math.round(regularHours * hourlyRate * 100) / 100;
      db.run(
        `UPDATE attendance
         SET time_out = ?,
             break_hours = ?,
             total_hours = ?,
             regular_hours = ?,
             overtime_hours = ?,
             salary = ?,
             notes = COALESCE(?, notes),
             updated_at = datetime('now')
         WHERE id = ?;`,
        [timeOut, breakHours, netHours, regularHours, overtimeHours, dailySalary, options?.notes || null, active.id]
      );
      db.run(
        `INSERT INTO salary_records (id, user_id, week_start, week_end, regular_hours, hourly_rate, gross_salary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 100.0, ?, datetime('now'), datetime('now'))
         ON CONFLICT(user_id, week_start) DO UPDATE SET
           regular_hours = regular_hours + excluded.regular_hours,
           gross_salary = gross_salary + excluded.gross_salary,
           updated_at = datetime('now');`,
        [
          `sal-${userId}-${weekRange.weekStart}`,
          userId,
          weekRange.weekStart,
          weekRange.weekEnd,
          regularHours,
          dailySalary
        ]
      );
      const updatedRecord = {
        id: active.id,
        userId,
        workDate,
        scheduledStart: active.scheduled_start,
        scheduledEnd: active.scheduled_end,
        timeIn,
        timeOut,
        breakHours,
        totalHours: netHours,
        regularHours,
        overtimeHours,
        lateMinutes: Number(active.late_minutes) || 0,
        attendanceStatus: active.attendance_status,
        hourlyRate,
        salary: dailySalary,
        notes: options?.notes || active.notes,
        createdAt: manila.isoString,
        updatedAt: manila.isoString
      };
      await AuditService.logAction(
        userId,
        "CHECK_OUT",
        `Checked out at ${formatTo12Hour(timeOut)}. Worked: ${regularHours}h \xB7 Salary: \u20B1${dailySalary}`,
        options?.ipAddress || "127.0.0.1",
        options?.userAgent || "App-Client"
      );
      const totalUpdatedWeekly = currentWeeklyHours + regularHours;
      const leftThisWeek = Math.max(0, 30 - totalUpdatedWeekly);
      return {
        message: `Successfully checked out. Worked: ${regularHours}h | Salary: \u20B1${dailySalary}. You have ${leftThisWeek.toFixed(
          1
        )} hours remaining this week.`,
        attendance: updatedRecord,
        summary: {
          hoursWorked: regularHours,
          salary: dailySalary,
          weeklyHours: totalUpdatedWeekly,
          remainingWeeklyHours: leftThisWeek
        }
      };
    });
  }
  /**
   * Retrieves status for today's dashboard (or optional targetDate)
   */
  static async getTodayAttendance(userId, targetDate) {
    const db = await getDb();
    const manila = getManilaNow();
    const workDate = targetDate || manila.date;
    const dayOfWeek = getDayOfWeek(workDate);
    const schedule = await ScheduleService.getScheduleForDay(userId, dayOfWeek);
    const scheduledStart = schedule.scheduledStart || "07:00";
    const scheduledEnd = schedule.scheduledEnd || "17:00";
    const isRestDay = schedule.isRestDay;
    const attStmt = db.prepare(`
      SELECT id, time_in, time_out, break_hours, total_hours, regular_hours, late_minutes, attendance_status, salary
      FROM attendance
      WHERE user_id = ? AND work_date = ?;
    `);
    attStmt.bind([userId, workDate]);
    let status = isRestDay ? "REST_DAY" : "NOT_CHECKED_IN";
    let attendanceId;
    let timeIn;
    let timeOut;
    let breakHours = 0;
    let totalHours = 0;
    let regularHours = 0;
    let dailySalary = 0;
    let lateMinutes = 0;
    let lateStatus = isRestDay ? "REST_DAY" : "ON_TIME";
    if (attStmt.step()) {
      const row = attStmt.getAsObject();
      attendanceId = row.id;
      timeIn = row.time_in;
      timeOut = row.time_out || void 0;
      breakHours = Number(row.break_hours) || 0;
      totalHours = Number(row.total_hours) || 0;
      regularHours = Number(row.regular_hours) || 0;
      dailySalary = Number(row.salary) || 0;
      lateMinutes = Number(row.late_minutes) || 0;
      lateStatus = row.attendance_status || (lateMinutes > 0 ? "LATE" : "ON_TIME");
      status = timeOut ? "CHECKED_OUT" : "CHECKED_IN";
    }
    attStmt.free();
    const weekRange = getManilaWeekRange(workDate);
    const weekStmt = db.prepare(`
      SELECT COALESCE(SUM(regular_hours), 0) as week_hours
      FROM attendance
      WHERE user_id = ? AND work_date >= ? AND work_date <= ? AND time_out IS NOT NULL;
    `);
    weekStmt.bind([userId, weekRange.weekStart, weekRange.weekEnd]);
    let currentWeeklyHours = 0;
    if (weekStmt.step()) {
      currentWeeklyHours = Number(weekStmt.getAsObject().week_hours) || 0;
    }
    weekStmt.free();
    const remainingWeeklyHours = Math.max(0, Math.round((30 - currentWeeklyHours) * 100) / 100);
    const currentWeeklySalary = currentWeeklyHours * 100;
    return {
      status,
      attendanceId,
      workDate,
      dayOfWeek,
      scheduledStart,
      scheduledEnd,
      isRestDay,
      timeIn,
      formattedTimeIn: timeIn ? formatTo12Hour(timeIn) : void 0,
      timeOut,
      formattedTimeOut: timeOut ? formatTo12Hour(timeOut) : void 0,
      breakHours,
      totalHours,
      regularHours,
      dailySalary,
      lateMinutes,
      lateStatus,
      isDailyLimitReached: regularHours >= 10,
      currentWeeklyHours,
      remainingWeeklyHours,
      currentWeeklySalary,
      isWeeklyLimitReached: currentWeeklyHours >= 30
    };
  }
  /**
   * Retrieves attendance history strictly for the authenticated user
   */
  static async getAttendanceHistory(userId, filter = "all") {
    const db = await getDb();
    const manila = getManilaNow();
    let query = `
      SELECT id, user_id, work_date, scheduled_start, scheduled_end, time_in, time_out,
             break_hours, total_hours, regular_hours, overtime_hours, late_minutes,
             attendance_status, hourly_rate, salary, notes, created_at, updated_at
      FROM attendance
      WHERE user_id = ?
    `;
    const params = [userId];
    if (filter === "today") {
      query += ` AND work_date = ?`;
      params.push(manila.date);
    } else if (filter === "week") {
      const weekRange = getManilaWeekRange(manila.date);
      query += ` AND work_date >= ? AND work_date <= ?`;
      params.push(weekRange.weekStart, weekRange.weekEnd);
    } else if (filter === "month") {
      query += ` AND work_date LIKE ?`;
      params.push(`${manila.month}%`);
    }
    query += ` ORDER BY work_date DESC, time_in DESC;`;
    const stmt = db.prepare(query);
    stmt.bind(params);
    const list = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      list.push({
        id: row.id,
        userId: row.user_id,
        workDate: row.work_date,
        scheduledStart: row.scheduled_start,
        scheduledEnd: row.scheduled_end,
        timeIn: row.time_in,
        timeOut: row.time_out || void 0,
        breakHours: Number(row.break_hours) || 0,
        totalHours: Number(row.total_hours) || 0,
        regularHours: Number(row.regular_hours) || 0,
        overtimeHours: Number(row.overtime_hours) || 0,
        lateMinutes: Number(row.late_minutes) || 0,
        attendanceStatus: row.attendance_status,
        hourlyRate: Number(row.hourly_rate) || 100,
        salary: Number(row.salary) || 0,
        notes: row.notes || void 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });
    }
    stmt.free();
    return list;
  }
  /**
   * Retrieves late metrics and history for the authenticated user
   */
  static async getLateSummary(userId) {
    const db = await getDb();
    const manila = getManilaNow();
    const weekRange = getManilaWeekRange(manila.date);
    const todayStmt = db.prepare("SELECT late_minutes FROM attendance WHERE user_id = ? AND work_date = ?;");
    todayStmt.bind([userId, manila.date]);
    let lateMinutesToday = 0;
    if (todayStmt.step()) {
      lateMinutesToday = Number(todayStmt.getAsObject().late_minutes) || 0;
    }
    todayStmt.free();
    const weekStmt = db.prepare(`
      SELECT COALESCE(SUM(late_minutes), 0) as total_late
      FROM attendance
      WHERE user_id = ? AND work_date >= ? AND work_date <= ?;
    `);
    weekStmt.bind([userId, weekRange.weekStart, weekRange.weekEnd]);
    let lateMinutesThisWeek = 0;
    if (weekStmt.step()) {
      lateMinutesThisWeek = Number(weekStmt.getAsObject().total_late) || 0;
    }
    weekStmt.free();
    const monthStmt = db.prepare(`
      SELECT COALESCE(SUM(late_minutes), 0) as total_late,
             COUNT(CASE WHEN late_minutes > 0 THEN 1 END) as late_days
      FROM attendance
      WHERE user_id = ? AND work_date LIKE ?;
    `);
    monthStmt.bind([userId, `${manila.month}%`]);
    let lateMinutesThisMonth = 0;
    let lateDaysThisMonth = 0;
    if (monthStmt.step()) {
      const obj = monthStmt.getAsObject();
      lateMinutesThisMonth = Number(obj.total_late) || 0;
      lateDaysThisMonth = Number(obj.late_days) || 0;
    }
    monthStmt.free();
    const historyStmt = db.prepare(`
      SELECT id, work_date, scheduled_start, time_in, late_minutes, attendance_status
      FROM attendance
      WHERE user_id = ? AND late_minutes > 0
      ORDER BY work_date DESC;
    `);
    historyStmt.bind([userId]);
    const records = [];
    while (historyStmt.step()) {
      const row = historyStmt.getAsObject();
      records.push({
        id: row.id,
        workDate: row.work_date,
        scheduledStart: row.scheduled_start,
        timeIn: row.time_in,
        lateMinutes: row.late_minutes,
        attendanceStatus: row.attendance_status
      });
    }
    historyStmt.free();
    return {
      lateMinutesToday,
      lateMinutesThisWeek,
      lateMinutesThisMonth,
      lateDaysThisMonth,
      records
    };
  }
  /**
   * Resets / clears attendance record for today (or specified work date)
   * Helpful for user testing, shift corrections, and simulation
   */
  static async resetToday(userId, workDate) {
    return withTransaction(async (db) => {
      const manila = getManilaNow();
      const targetDate = workDate || manila.date;
      db.run("DELETE FROM attendance WHERE user_id = ? AND work_date = ?;", [userId, targetDate]);
      await AuditService.logAction(
        userId,
        "ATTENDANCE_RESET",
        `Reset/cleared attendance record for ${targetDate}`,
        "127.0.0.1",
        "App-Client"
      );
      return { message: `Shift record for ${targetDate} has been cleared.` };
    });
  }
  /**
   * Logs a complete attendance record with input time in and input time out
   */
  static async logAttendanceRecord(userId, options) {
    return withTransaction(async (db) => {
      const manila = getManilaNow();
      const workDate = options.workDate || manila.date;
      const timeIn = options.timeIn;
      const timeOut = options.timeOut;
      const breakHours = typeof options.breakHours === "number" ? options.breakHours : 1;
      const dayOfWeek = getDayOfWeek(workDate);
      const schedule = await ScheduleService.getScheduleForDay(userId, dayOfWeek);
      const scheduledStart = schedule.scheduledStart || "07:00";
      const scheduledEnd = schedule.scheduledEnd || "17:00";
      const [inH, inM] = timeIn.split(":").map(Number);
      const [outH, outM] = timeOut.split(":").map(Number);
      const elapsedMinutes = outH * 60 + outM - (inH * 60 + inM);
      if (elapsedMinutes <= 0) {
        throw new Error("Log Out Attendance time must be after Log Attendance time.");
      }
      const grossHours = Math.round(elapsedMinutes / 60 * 100) / 100;
      if (breakHours >= grossHours) {
        throw new Error("Break hours cannot exceed or equal total elapsed shift duration.");
      }
      const netHours = Math.max(0, Math.round((grossHours - breakHours) * 100) / 100);
      const regularHours = Math.min(10, netHours);
      const overtimeHours = Math.max(0, Math.round((netHours - regularHours) * 100) / 100);
      const weekRange = getManilaWeekRange(workDate);
      const weekStmt = db.prepare(`
        SELECT COALESCE(SUM(regular_hours), 0) as approved_weekly_hours
        FROM attendance
        WHERE user_id = ? AND work_date >= ? AND work_date <= ? AND work_date != ?;
      `);
      weekStmt.bind([userId, weekRange.weekStart, weekRange.weekEnd, workDate]);
      let currentWeeklyHours = 0;
      if (weekStmt.step()) {
        currentWeeklyHours = Number(weekStmt.getAsObject().approved_weekly_hours) || 0;
      }
      weekStmt.free();
      const remainingWeeklyHours = Math.max(0, Math.round((30 - currentWeeklyHours) * 100) / 100);
      if (regularHours > remainingWeeklyHours) {
        throw new Error(
          `Weekly limit exceeded: You only have ${remainingWeeklyHours.toFixed(1)} regular hours remaining this week.`
        );
      }
      const lateMinutes = calculateLateMinutes(timeIn, scheduledStart);
      const attendanceStatus = lateMinutes > 0 ? "LATE" : "ON_TIME";
      const hourlyRate = 100;
      const salary = regularHours * hourlyRate;
      db.run("DELETE FROM attendance WHERE user_id = ? AND work_date = ?;", [userId, workDate]);
      const id = `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      db.run(
        `INSERT INTO attendance (
          id, user_id, work_date, scheduled_start, scheduled_end, time_in, time_out,
          break_hours, total_hours, regular_hours, overtime_hours, late_minutes,
          attendance_status, hourly_rate, salary, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          id,
          userId,
          workDate,
          scheduledStart,
          scheduledEnd,
          timeIn,
          timeOut,
          breakHours,
          netHours,
          regularHours,
          overtimeHours,
          lateMinutes,
          attendanceStatus,
          hourlyRate,
          salary,
          options.notes || null,
          manila.isoString,
          manila.isoString
        ]
      );
      await AuditService.logAction(
        userId,
        "LOG_ATTENDANCE_ENTRY",
        `Logged attendance: In ${formatTo12Hour(timeIn)}, Out ${formatTo12Hour(timeOut)} on ${workDate} (${regularHours}h \xB7 \u20B1${salary})`,
        options.ipAddress || "127.0.0.1",
        options.userAgent || "App-Client"
      );
      return {
        message: `Attendance logged successfully for ${workDate}: In at ${formatTo12Hour(timeIn)}, Out at ${formatTo12Hour(timeOut)} (${regularHours}h \xB7 \u20B1${salary}).`,
        attendance: {
          id,
          userId,
          workDate,
          scheduledStart,
          scheduledEnd,
          timeIn,
          timeOut,
          breakHours,
          totalHours: netHours,
          regularHours,
          overtimeHours,
          lateMinutes,
          attendanceStatus,
          hourlyRate,
          salary,
          notes: options.notes,
          createdAt: manila.isoString,
          updatedAt: manila.isoString
        }
      };
    });
  }
};

// src/routes/attendance.routes.ts
var router2 = Router2();
router2.post("/check-in", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { customTimeIn, timeIn, customWorkDate, workDate, date, notes } = req.body;
    const result = await AttendanceService.checkIn(userId, {
      customTimeIn: customTimeIn || timeIn,
      customWorkDate: customWorkDate || workDate || date,
      notes,
      ipAddress: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "App-Client"
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message || "Check-in failed." });
  }
});
router2.post("/check-out", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { customTimeOut, timeOut, customWorkDate, workDate, date, breakHours, notes } = req.body;
    const result = await AttendanceService.checkOut(userId, {
      customTimeOut: customTimeOut || timeOut,
      customWorkDate: customWorkDate || workDate || date,
      breakHours: typeof breakHours === "number" ? breakHours : void 0,
      notes,
      ipAddress: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "App-Client"
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message || "Check-out failed." });
  }
});
router2.post("/log-entry", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { workDate, date, timeIn, timeOut, breakHours, notes } = req.body;
    if (!timeIn) {
      return res.status(400).json({ error: "Please specify Time In (Log Attendance time)." });
    }
    if (!timeOut) {
      return res.status(400).json({ error: "Please specify Time Out (Log Out Attendance time)." });
    }
    const result = await AttendanceService.logAttendanceRecord(userId, {
      workDate: workDate || date,
      timeIn,
      timeOut,
      breakHours: typeof breakHours === "number" ? breakHours : Number(breakHours) || 1,
      notes,
      ipAddress: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "App-Client"
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message || "Failed to log attendance entry." });
  }
});
router2.post("/reset-today", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { workDate, date } = req.body;
    const result = await AttendanceService.resetToday(userId, workDate || date);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message || "Failed to reset today." });
  }
});
router2.get("/today", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const info = await AttendanceService.getTodayAttendance(userId);
    return res.json(info);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router2.get("/history", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const filter = req.query.filter || "all";
    const history = await AttendanceService.getAttendanceHistory(userId, filter);
    return res.json(history);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
var attendance_routes_default = router2;

// src/routes/dashboard.routes.ts
import { Router as Router3 } from "express";

// src/services/salary.service.ts
var SalaryService = class {
  /**
   * Retrieves the current week's salary summary for the authenticated user
   */
  static async getCurrentWeekSalary(userId, targetDate) {
    const db = await getDb();
    const manila = getManilaNow();
    const weekRange = getManilaWeekRange(targetDate || manila.date);
    const stmt = db.prepare(`
      SELECT id, user_id, work_date, scheduled_start, scheduled_end, time_in, time_out,
             break_hours, total_hours, regular_hours, overtime_hours, late_minutes,
             attendance_status, hourly_rate, salary, notes, created_at, updated_at
      FROM attendance
      WHERE user_id = ? AND work_date >= ? AND work_date <= ? AND time_out IS NOT NULL
      ORDER BY work_date ASC;
    `);
    stmt.bind([userId, weekRange.weekStart, weekRange.weekEnd]);
    const records = [];
    let totalWeeklyHours = 0;
    let weeklySalary = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const regHours = Number(row.regular_hours) || 0;
      const sal = Number(row.salary) || 0;
      totalWeeklyHours += regHours;
      weeklySalary += sal;
      records.push({
        id: row.id,
        userId: row.user_id,
        workDate: row.work_date,
        scheduledStart: row.scheduled_start,
        scheduledEnd: row.scheduled_end,
        timeIn: row.time_in,
        timeOut: row.time_out,
        breakHours: Number(row.break_hours) || 0,
        totalHours: Number(row.total_hours) || 0,
        regularHours: regHours,
        overtimeHours: Number(row.overtime_hours) || 0,
        lateMinutes: Number(row.late_minutes) || 0,
        attendanceStatus: row.attendance_status,
        hourlyRate: Number(row.hourly_rate) || 100,
        salary: sal,
        notes: row.notes || void 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });
    }
    stmt.free();
    totalWeeklyHours = Math.round(totalWeeklyHours * 100) / 100;
    weeklySalary = Math.round(weeklySalary * 100) / 100;
    const remainingWeeklyHours = Math.max(0, Math.round((30 - totalWeeklyHours) * 100) / 100);
    return {
      weekStart: weekRange.weekStart,
      weekEnd: weekRange.weekEnd,
      weekLabel: weekRange.weekLabel,
      totalWeeklyHours,
      remainingWeeklyHours,
      weeklySalary,
      hourlyRate: 100,
      records
    };
  }
  /**
   * Retrieves historical salary records by date
   */
  static async getSalaryHistory(userId) {
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT work_date, regular_hours, hourly_rate, salary, attendance_status
      FROM attendance
      WHERE user_id = ? AND time_out IS NOT NULL
      ORDER BY work_date DESC;
    `);
    stmt.bind([userId]);
    const history = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      history.push({
        workDate: row.work_date,
        regularHours: Number(row.regular_hours) || 0,
        hourlyRate: Number(row.hourly_rate) || 100,
        salary: Number(row.salary) || 0,
        attendanceStatus: row.attendance_status
      });
    }
    stmt.free();
    return history;
  }
};

// src/routes/dashboard.routes.ts
var router3 = Router3();
router3.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = await getDb();
    const userStmt = db.prepare("SELECT id, full_name, email, phone, profile_picture, account_status, created_at, updated_at FROM users WHERE id = ?;");
    userStmt.bind([userId]);
    if (!userStmt.step()) {
      userStmt.free();
      return res.status(404).json({ error: "User not found." });
    }
    const userRow = userStmt.getAsObject();
    userStmt.free();
    const user = {
      id: userRow.id,
      fullName: userRow.full_name,
      email: userRow.email,
      phone: userRow.phone || void 0,
      profilePicture: userRow.profile_picture || void 0,
      accountStatus: userRow.account_status,
      createdAt: userRow.created_at,
      updatedAt: userRow.updated_at
    };
    const today = await AttendanceService.getTodayAttendance(userId);
    const weeklySalary = await SalaryService.getCurrentWeekSalary(userId);
    const lateSummary = await AttendanceService.getLateSummary(userId);
    const recentAttendance = await AttendanceService.getAttendanceHistory(userId, "month");
    const hoursWorked = weeklySalary.totalWeeklyHours;
    const maxWeeklyHours = 30;
    const remainingHours = Math.max(0, Math.round((maxWeeklyHours - hoursWorked) * 100) / 100);
    const percentageUsed = Math.min(100, Math.round(hoursWorked / maxWeeklyHours * 100));
    const dashboardData = {
      user,
      today,
      weekly: {
        weekLabel: weeklySalary.weekLabel,
        hoursWorked,
        maxWeeklyHours,
        remainingHours,
        weeklySalary: weeklySalary.weeklySalary,
        maxWeeklySalary: 3e3,
        percentageUsed
      },
      lateSummary: {
        lateMinutesThisMonth: lateSummary.lateMinutesThisMonth,
        lateDaysThisMonth: lateSummary.lateDaysThisMonth,
        lateMinutesThisWeek: lateSummary.lateMinutesThisWeek
      },
      recentAttendance: recentAttendance.slice(0, 10)
    };
    return res.json(dashboardData);
  } catch (err) {
    console.error("Dashboard error:", err);
    return res.status(500).json({ error: err.message });
  }
});
var dashboard_routes_default = router3;

// src/routes/schedule.routes.ts
import { Router as Router4 } from "express";
var router4 = Router4();
router4.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const schedules = await ScheduleService.getUserSchedule(userId);
    return res.json(schedules);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router4.put("/:day", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const day = req.params.day;
    const { scheduledStart, scheduledEnd, isRestDay } = req.body;
    const updated = await ScheduleService.updateScheduleDay(userId, day, {
      scheduledStart: scheduledStart || "07:00",
      scheduledEnd: scheduledEnd || "17:00",
      isRestDay: Boolean(isRestDay)
    });
    await AuditService.logAction(
      userId,
      "SCHEDULE_UPDATED",
      `Updated schedule for ${day}: ${isRestDay ? "Rest Day" : `${scheduledStart} - ${scheduledEnd}`}`,
      req.ip || "127.0.0.1"
    );
    return res.json(updated);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});
var schedule_routes_default = router4;

// src/routes/salary.routes.ts
import { Router as Router5 } from "express";
var router5 = Router5();
router5.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const summary = await SalaryService.getCurrentWeekSalary(userId);
    return res.json(summary);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router5.get("/history", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const history = await SalaryService.getSalaryHistory(userId);
    return res.json(history);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
var salary_routes_default = router5;

// src/routes/late.routes.ts
import { Router as Router6 } from "express";
var router6 = Router6();
router6.get("/summary", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const summary = await AttendanceService.getLateSummary(userId);
    return res.json(summary);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router6.get("/history", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const summary = await AttendanceService.getLateSummary(userId);
    return res.json(summary.records);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
var late_routes_default = router6;

// src/routes/audit.routes.ts
import { Router as Router7 } from "express";
var router7 = Router7();
router7.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit || "50", 10);
    const logs = await AuditService.getUserAuditLogs(userId, limit);
    return res.json(logs);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
var audit_routes_default = router7;

// src/routes/test.routes.ts
import { Router as Router8 } from "express";

// src/tests/salary.test.ts
import bcrypt3 from "bcryptjs";
import jwt3 from "jsonwebtoken";
async function runAllTests() {
  const results = [];
  function record(name, category, passed2, expected, actual, error) {
    results.push({ name, category, passed: passed2, expected, actual, error });
  }
  try {
    const db = await getDb();
    const stmt1 = db.prepare("SELECT password_hash FROM users WHERE email = 'juan@example.com'");
    if (stmt1.step()) {
      const hash = String(stmt1.get()[0]);
      stmt1.free();
      const valid = bcrypt3.compareSync("password123", hash);
      record("Auth: Valid User Login Credential", "Authentication", valid, "Match true", `Match ${valid}`);
    } else {
      stmt1.free();
      record("Auth: Valid User Login Credential", "Authentication", false, "Match true", "User not found");
    }
    const stmt2 = db.prepare("SELECT password_hash FROM users WHERE email = 'juan@example.com'");
    if (stmt2.step()) {
      const hash = String(stmt2.get()[0]);
      stmt2.free();
      const invalid = !bcrypt3.compareSync("wrongpassword", hash);
      record("Auth: Reject Invalid Password", "Authentication", invalid, "Reject true", `Rejected ${invalid}`);
    } else {
      stmt2.free();
      record("Auth: Reject Invalid Password", "Authentication", false, "Reject true", "User not found");
    }
    const token = jwt3.sign({ id: "usr-juan-001", email: "juan@example.com", fullName: "Juan Dela Cruz" }, JWT_SECRET, { expiresIn: "1h" });
    const decoded = jwt3.verify(token, JWT_SECRET);
    record("Auth: JWT Sign & Verify User ID", "Authentication", decoded.id === "usr-juan-001", "usr-juan-001", decoded.id);
  } catch (err) {
    record("Auth: System Error", "Authentication", false, "Success", "Threw error", err.message);
  }
  try {
    const late655 = calculateLateMinutes("06:55", "07:00");
    record("Late Calc: 06:55 AM (Early Arrival)", "Late Calculation", late655 === 0, "0 late minutes", `${late655} late minutes`);
    const late700 = calculateLateMinutes("07:00", "07:00");
    record("Late Calc: 07:00 AM (Exact Scheduled Start)", "Late Calculation", late700 === 0, "0 late minutes", `${late700} late minutes`);
    const late701 = calculateLateMinutes("07:01", "07:00");
    record("Late Calc: 07:01 AM (1 Minute Late)", "Late Calculation", late701 === 1, "1 late minute", `${late701} late minute`);
    const late705 = calculateLateMinutes("07:05", "07:00");
    record("Late Calc: 07:05 AM (5 Minutes Late)", "Late Calculation", late705 === 5, "5 late minutes", `${late705} late minutes`);
    const late730 = calculateLateMinutes("07:30", "07:00");
    record("Late Calc: 07:30 AM (30 Minutes Late)", "Late Calculation", late730 === 30, "30 late minutes", `${late730} late minutes`);
    const late815 = calculateLateMinutes("08:15", "07:00");
    record("Late Calc: 08:15 AM (75 Minutes Late)", "Late Calculation", late815 === 75, "75 late minutes", `${late815} late minutes`);
  } catch (err) {
    record("Late Calc: System Error", "Late Calculation", false, "Success", "Threw error", err.message);
  }
  try {
    const testUserId = "usr-test-runner";
    const db = await getDb();
    db.run(`INSERT OR REPLACE INTO users (id, full_name, email, password_hash) VALUES ('usr-test-runner', 'Test Runner', 'runner@test.local', 'hash');`);
    db.run(`DELETE FROM attendance WHERE user_id = 'usr-test-runner';`);
    let rejectedNoCheckIn = false;
    try {
      await AttendanceService.checkOut(testUserId, { customTimeOut: "16:00" });
    } catch (e) {
      rejectedNoCheckIn = e.message.includes("active check-in");
    }
    record("Check-In/Out: Reject Check-Out Without Active Check-In", "Check-In/Out", rejectedNoCheckIn, "Throws active check-in error", rejectedNoCheckIn ? "Blocked" : "Allowed");
    const checkInResult = await AttendanceService.checkIn(testUserId, { customTimeIn: "07:10" });
    record(
      "Check-In/Out: Successful Check-In at 07:10 AM",
      "Check-In/Out",
      checkInResult.lateMinutes === 10 && checkInResult.lateStatus === "LATE",
      "10 late minutes and LATE status",
      `${checkInResult.lateMinutes} mins, ${checkInResult.lateStatus}`
    );
    let duplicateRejected = false;
    try {
      await AttendanceService.checkIn(testUserId, { customTimeIn: "07:20" });
    } catch (e) {
      duplicateRejected = e.message.includes("already checked in");
    }
    record("Check-In/Out: Reject Duplicate Check-In on Same Day", "Check-In/Out", duplicateRejected, "Reject duplicate check-in", duplicateRejected ? "Rejected" : "Allowed");
    let invalidTimeRejected = false;
    try {
      await AttendanceService.checkOut(testUserId, { customTimeOut: "06:00" });
    } catch (e) {
      invalidTimeRejected = e.message.includes("after Time In");
    }
    record("Check-In/Out: Reject Time Out Earlier Than Time In", "Check-In/Out", invalidTimeRejected, "Time Out after Time In error", invalidTimeRejected ? "Rejected" : "Allowed");
    const checkOutResult = await AttendanceService.checkOut(testUserId, {
      customTimeOut: "16:10",
      breakHours: 1
    });
    record(
      "Check-In/Out: Complete Shift (8.0h worked @ \u20B1100/hr = \u20B1800)",
      "Check-In/Out",
      checkOutResult.attendance.regularHours === 8 && checkOutResult.attendance.salary === 800,
      "8.0 hours worked, \u20B1800 salary",
      `${checkOutResult.attendance.regularHours}h, \u20B1${checkOutResult.attendance.salary}`
    );
  } catch (err) {
    record("Check-In/Out: Workflow Error", "Check-In/Out", false, "Success", "Threw error", err.message);
  }
  try {
    const userId = "usr-daily-test";
    const db = await getDb();
    db.run(`INSERT OR REPLACE INTO users (id, full_name, email, password_hash) VALUES ('usr-daily-test', 'Daily Tester', 'daily@test.local', 'hash');`);
    db.run(`DELETE FROM attendance WHERE user_id = 'usr-daily-test';`);
    await AttendanceService.checkIn(userId, { customTimeIn: "07:00" });
    const tenHourShift = await AttendanceService.checkOut(userId, {
      customTimeOut: "18:00",
      breakHours: 1
    });
    record(
      "Daily Limit: Exactly 10 Regular Hours (Max Daily \u20B11,000)",
      "Daily Limit",
      tenHourShift.attendance.regularHours === 10 && tenHourShift.attendance.salary === 1e3,
      "10.0 regular hours, \u20B11,000 salary",
      `${tenHourShift.attendance.regularHours}h, \u20B1${tenHourShift.attendance.salary}`
    );
    db.run(`DELETE FROM attendance WHERE user_id = 'usr-daily-test';`);
    await AttendanceService.checkIn(userId, { customTimeIn: "06:00" });
    const twelveHourShift = await AttendanceService.checkOut(userId, {
      customTimeOut: "19:00",
      breakHours: 1
    });
    record(
      "Daily Limit: 12 Hours Capped at 10 Regular Hours (\u20B11,000 Regular Pay)",
      "Daily Limit",
      twelveHourShift.attendance.regularHours === 10 && twelveHourShift.attendance.salary === 1e3 && twelveHourShift.attendance.overtimeHours === 2,
      "Regular hours capped at 10.0, salary \u20B11,000",
      `${twelveHourShift.attendance.regularHours}h reg, \u20B1${twelveHourShift.attendance.salary}, ${twelveHourShift.attendance.overtimeHours}h OT`
    );
  } catch (err) {
    record("Daily Limit: System Error", "Daily Limit", false, "Success", "Threw error", err.message);
  }
  try {
    const userId = "usr-weekly-test";
    const db = await getDb();
    db.run(`INSERT OR REPLACE INTO users (id, full_name, email, password_hash) VALUES ('usr-weekly-test', 'Weekly Tester', 'weekly@test.local', 'hash');`);
    db.run(`DELETE FROM attendance WHERE user_id = 'usr-weekly-test';`);
    const weekRange = getManilaWeekRange();
    const testDate = weekRange.weekEnd;
    db.run(
      `INSERT INTO attendance (id, user_id, work_date, scheduled_start, time_in, time_out, break_hours, total_hours, regular_hours, salary, attendance_status)
       VALUES ('att-w1', 'usr-weekly-test', ?, '07:00', '07:00', '18:00', 1.0, 10.0, 10.0, 1000.0, 'ON_TIME'),
              ('att-w2', 'usr-weekly-test', date(?, '+1 day'), '07:00', '07:00', '18:00', 1.0, 10.0, 10.0, 1000.0, 'ON_TIME'),
              ('att-w3', 'usr-weekly-test', date(?, '+2 day'), '07:00', '07:00', '16:00', 1.0, 8.0, 8.0, 800.0, 'ON_TIME');`,
      [weekRange.weekStart, weekRange.weekStart, weekRange.weekStart]
    );
    await AttendanceService.checkIn(userId, { customTimeIn: "07:00", customWorkDate: testDate });
    const allowedWeekly = await AttendanceService.checkOut(userId, {
      customTimeOut: "09:00",
      customWorkDate: testDate,
      breakHours: 0
    });
    record(
      "Weekly Limit: 28h Existing + 2h Today = 30h Max (ALLOW)",
      "Weekly Limit",
      allowedWeekly.attendance.regularHours === 2 && allowedWeekly.summary.weeklyHours === 30,
      "30.0 total weekly hours",
      `${allowedWeekly.summary.weeklyHours}h total weekly`
    );
    db.run(`DELETE FROM attendance WHERE user_id = 'usr-weekly-test';`);
    db.run(
      `INSERT INTO attendance (id, user_id, work_date, scheduled_start, time_in, time_out, break_hours, total_hours, regular_hours, salary, attendance_status)
       VALUES ('att-w1', 'usr-weekly-test', ?, '07:00', '07:00', '18:00', 1.0, 10.0, 10.0, 1000.0, 'ON_TIME'),
              ('att-w2', 'usr-weekly-test', date(?, '+1 day'), '07:00', '07:00', '18:00', 1.0, 10.0, 10.0, 1000.0, 'ON_TIME'),
              ('att-w3', 'usr-weekly-test', date(?, '+2 day'), '07:00', '07:00', '18:00', 1.0, 10.0, 10.0, 1000.0, 'ON_TIME');`,
      [weekRange.weekStart, weekRange.weekStart, weekRange.weekStart]
    );
    let weeklyCheckInBlocked = false;
    try {
      await AttendanceService.checkIn(userId, { customTimeIn: "07:00", customWorkDate: testDate });
    } catch (e) {
      weeklyCheckInBlocked = e.message.includes("Weekly limit reached") || e.message.includes("30 regular hours");
    }
    record(
      "Weekly Limit: 30h Reached -> Block New Check-In",
      "Weekly Limit",
      weeklyCheckInBlocked,
      "Blocked with weekly limit message",
      weeklyCheckInBlocked ? "Blocked" : "Allowed"
    );
    db.run(`DELETE FROM attendance WHERE user_id = 'usr-weekly-test';`);
    db.run(
      `INSERT INTO attendance (id, user_id, work_date, scheduled_start, time_in, time_out, break_hours, total_hours, regular_hours, salary, attendance_status)
       VALUES ('att-w1', 'usr-weekly-test', ?, '07:00', '07:00', '18:00', 1.0, 10.0, 10.0, 1000.0, 'ON_TIME'),
              ('att-w2', 'usr-weekly-test', date(?, '+1 day'), '07:00', '07:00', '18:00', 1.0, 10.0, 10.0, 1000.0, 'ON_TIME'),
              ('att-w3', 'usr-weekly-test', date(?, '+2 day'), '07:00', '07:00', '16:00', 1.0, 8.0, 8.0, 800.0, 'ON_TIME');`,
      [weekRange.weekStart, weekRange.weekStart, weekRange.weekStart]
    );
    await AttendanceService.checkIn(userId, { customTimeIn: "07:00", customWorkDate: testDate });
    let excessCheckOutBlocked = false;
    let excessMsg = "";
    try {
      await AttendanceService.checkOut(userId, { customTimeOut: "10:00", customWorkDate: testDate, breakHours: 0 });
    } catch (e) {
      excessCheckOutBlocked = e.message.includes("Weekly limit exceeded") && e.message.includes("2.0");
      excessMsg = e.message;
    }
    record(
      'Weekly Limit: 28h + 3h = REJECT ("You only have 2.0 regular working hours remaining")',
      "Weekly Limit",
      excessCheckOutBlocked,
      'Throws "You only have 2.0 regular working hours remaining this week."',
      excessMsg || "Not blocked"
    );
    db.run(`DELETE FROM attendance WHERE user_id = 'usr-weekly-test';`);
    const logResult = await AttendanceService.logAttendanceRecord("usr-weekly-test", {
      workDate: "2026-09-08",
      timeIn: "07:15",
      timeOut: "17:15",
      breakHours: 1,
      notes: "Testing manual input types"
    });
    record(
      "Input Types: logAttendanceRecord creates valid 9.0h record with late tracking",
      "Check-In/Out",
      logResult.attendance.regularHours === 9 && logResult.attendance.salary === 900 && logResult.attendance.lateMinutes === 15,
      "9.0 regular hours, \u20B1900 salary, 15 late minutes",
      `${logResult.attendance.regularHours}h, \u20B1${logResult.attendance.salary}, ${logResult.attendance.lateMinutes}m late`
    );
    await AttendanceService.resetToday("usr-weekly-test", "2026-09-08");
    const resetCheck = await AttendanceService.getTodayAttendance("usr-weekly-test", "2026-09-08");
    record(
      "Input Types: resetToday clears attendance record for re-entry",
      "Check-In/Out",
      resetCheck.status === "NOT_CHECKED_IN" && resetCheck.regularHours === 0,
      "Status reset to NOT_CHECKED_IN with 0 regular hours",
      `Status: ${resetCheck.status}, Hours: ${resetCheck.regularHours}`
    );
  } catch (err) {
    record("Weekly Limit: System Error", "Weekly Limit", false, "Success", "Threw error", err.message);
  }
  try {
    const userA = "usr-juan-001";
    const userB = "usr-maria-002";
    const juanAttendance = await AttendanceService.getAttendanceHistory(userA, "all");
    const hasMariaRecordInJuan = juanAttendance.some((rec) => rec.userId === userB);
    record(
      "User Isolation: User A Cannot Query User B Attendance Records",
      "User Isolation",
      !hasMariaRecordInJuan && juanAttendance.length > 0,
      "0 records of User B in User A list",
      `${juanAttendance.filter((r) => r.userId === userB).length} records leaked`
    );
    const mariaAttendance = await AttendanceService.getAttendanceHistory(userB, "all");
    const hasJuanRecordInMaria = mariaAttendance.some((rec) => rec.userId === userA);
    record(
      "User Isolation: User B Cannot Query User A Attendance Records",
      "User Isolation",
      !hasJuanRecordInMaria,
      "0 records of User A in User B list",
      `${mariaAttendance.filter((r) => r.userId === userA).length} records leaked`
    );
    await AuditService.logAction(userA, "TEST_ACTION", "User A test log");
    await AuditService.logAction(userB, "TEST_ACTION", "User B test log");
    const juanLogs = await AuditService.getUserAuditLogs(userA);
    const hasMariaLogsInJuan = juanLogs.some((l) => l.userId === userB);
    record(
      "User Isolation: User A Cannot Access User B Audit Trail",
      "User Isolation",
      !hasMariaLogsInJuan,
      "Strict User Isolation in Audit Logs",
      hasMariaLogsInJuan ? "Leaked logs" : "Strictly isolated"
    );
    const juanSalary = await SalaryService.getCurrentWeekSalary(userA);
    const hasMariaInSalary = juanSalary.records.some((r) => r.userId === userB);
    record(
      "User Isolation: User A Cannot Access User B Salary Calculations",
      "User Isolation",
      !hasMariaInSalary,
      "Strict User Isolation in Salary Service",
      hasMariaInSalary ? "Leaked salary" : "Strictly isolated"
    );
  } catch (err) {
    record("User Isolation: System Error", "User Isolation", false, "Success", "Threw error", err.message);
  }
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  return {
    total: results.length,
    passed,
    failed,
    results
  };
}

// src/routes/test.routes.ts
var router8 = Router8();
router8.get("/run", authenticate, async (req, res) => {
  try {
    const results = await runAllTests();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
var test_routes_default = router8;

// src/routes/supabase.routes.ts
import { Router as Router9 } from "express";

// src/db/supabase.ts
import { createClient } from "@supabase/supabase-js";
var supabaseClient = null;
function isSupabaseConfigured() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  return Boolean(url && key && url.trim() !== "" && key.trim() !== "");
}
function getSupabase() {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        "Supabase environment variables are missing. Please define SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY)."
      );
    }
    supabaseClient = createClient(url.trim(), key.trim(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }
  return supabaseClient;
}
async function checkSupabaseHealth() {
  if (!isSupabaseConfigured()) {
    return {
      connected: false,
      configured: false,
      message: "Supabase is not configured yet. System is currently running on local SQLite storage."
    };
  }
  try {
    const client = getSupabase();
    const { error } = await client.from("users").select("id").limit(1);
    if (error) {
      if (error.code === "42P01") {
        return {
          connected: true,
          configured: true,
          message: "Connected to Supabase project, but tables are missing. Please run supabase-schema.sql.",
          error: error.message
        };
      }
      return {
        connected: false,
        configured: true,
        message: "Failed to query Supabase.",
        error: error.message
      };
    }
    return {
      connected: true,
      configured: true,
      message: "Successfully connected to Supabase PostgreSQL database."
    };
  } catch (err) {
    return {
      connected: false,
      configured: true,
      message: "Supabase connection failed.",
      error: err.message
    };
  }
}
async function migrateSqliteToSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error("Cannot migrate: Supabase credentials are not configured in environment.");
  }
  const supabase = getSupabase();
  const db = await getDb();
  const userRows = [];
  const uStmt = db.prepare("SELECT * FROM users;");
  while (uStmt.step()) {
    const r = uStmt.getAsObject();
    userRows.push({
      id: r.id,
      email: r.email,
      password_hash: r.password_hash,
      full_name: r.full_name,
      hourly_rate: Number(r.hourly_rate) || 100,
      scheduled_start_time: r.scheduled_start_time || "07:00",
      created_at: r.created_at,
      updated_at: r.updated_at
    });
  }
  uStmt.free();
  if (userRows.length > 0) {
    const { error } = await supabase.from("users").upsert(userRows, { onConflict: "id" });
    if (error) throw new Error(`Users migration failed: ${error.message}`);
  }
  const scheduleRows = [];
  const sStmt = db.prepare("SELECT * FROM schedules;");
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
      updated_at: r.updated_at
    });
  }
  sStmt.free();
  if (scheduleRows.length > 0) {
    const { error } = await supabase.from("schedules").upsert(scheduleRows, { onConflict: "id" });
    if (error) throw new Error(`Schedules migration failed: ${error.message}`);
  }
  const attRows = [];
  const aStmt = db.prepare("SELECT * FROM attendance;");
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
      break_hours: Number(r.break_hours) || 1,
      total_hours: Number(r.total_hours) || 0,
      regular_hours: Number(r.regular_hours) || 0,
      overtime_hours: Number(r.overtime_hours) || 0,
      late_minutes: Number(r.late_minutes) || 0,
      attendance_status: r.attendance_status || "ON_TIME",
      hourly_rate: Number(r.hourly_rate) || 100,
      salary: Number(r.salary) || 0,
      notes: r.notes || null,
      created_at: r.created_at,
      updated_at: r.updated_at
    });
  }
  aStmt.free();
  if (attRows.length > 0) {
    const { error } = await supabase.from("attendance").upsert(attRows, { onConflict: "id" });
    if (error) throw new Error(`Attendance migration failed: ${error.message}`);
  }
  const auditRows = [];
  const lStmt = db.prepare("SELECT * FROM audit_logs;");
  while (lStmt.step()) {
    const r = lStmt.getAsObject();
    auditRows.push({
      id: r.id,
      user_id: r.user_id,
      action: r.action,
      details: r.details,
      ip_address: r.ip_address,
      user_agent: r.user_agent,
      created_at: r.created_at
    });
  }
  lStmt.free();
  if (auditRows.length > 0) {
    const { error } = await supabase.from("audit_logs").upsert(auditRows, { onConflict: "id" });
    if (error) throw new Error(`Audit logs migration failed: ${error.message}`);
  }
  return {
    usersCount: userRows.length,
    schedulesCount: scheduleRows.length,
    attendanceCount: attRows.length,
    auditLogsCount: auditRows.length,
    message: `Successfully migrated ${userRows.length} users, ${scheduleRows.length} schedules, ${attRows.length} attendance records, and ${auditRows.length} audit logs to Supabase.`
  };
}

// src/routes/supabase.routes.ts
var router9 = Router9();
router9.get("/status", async (_req, res) => {
  try {
    const health = await checkSupabaseHealth();
    return res.json({
      configured: health.configured,
      connected: health.connected,
      message: health.message,
      error: health.error,
      databaseType: health.connected ? "Supabase PostgreSQL" : "Local SQLite"
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
router9.post("/migrate", authenticate, async (req, res) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.status(400).json({
        error: "Supabase credentials are not yet configured in environment variables (SUPABASE_URL and SUPABASE_ANON_KEY)."
      });
    }
    const result = await migrateSqliteToSupabase();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Migration to Supabase failed" });
  }
});
var supabase_routes_default = router9;

// src/app.ts
function createApp() {
  const app2 = express();
  app2.use(express.json());
  getDb().catch((err) => {
    console.error("[Database] Local database init check:", err);
  });
  app2.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app2.use("/api/auth", auth_routes_default);
  app2.use("/api/attendance", attendance_routes_default);
  app2.use("/api/dashboard", dashboard_routes_default);
  app2.use("/api/schedule", schedule_routes_default);
  app2.use("/api/salary", salary_routes_default);
  app2.use("/api/late", late_routes_default);
  app2.use("/api/audit-logs", audit_routes_default);
  app2.use("/api/tests", test_routes_default);
  app2.use("/api/supabase", supabase_routes_default);
  return app2;
}

// src/serverless.ts
dotenv.config();
var app = createApp();
var serverless_default = app;
export {
  serverless_default as default
};
