import React, { useState } from 'react';
import {
  BookOpen,
  Database,
  Layers,
  Shield,
  Clock,
  Banknote,
  Cpu,
  Server,
  Timer,
  History,
  Cloud,
} from 'lucide-react';

export const SystemDocumentationView: React.FC = () => {
  const [activeSection, setActiveSection] = useState<string>('arch');

  const sections = [
    { id: 'arch', label: '1. Application Architecture', icon: Layers },
    { id: 'erd', label: '2. Database ERD', icon: Database },
    { id: 'schema', label: '3. Database Schema (SQL/Prisma)', icon: Database },
    { id: 'auth', label: '4. Authentication Flow', icon: Shield },
    { id: 'checkin', label: '5. Check-in / Check-out Flow', icon: Clock },
    { id: 'late', label: '6. Late-Minute Calculation Flow', icon: Timer },
    { id: 'salary', label: '7. Salary Calculation Flow', icon: Banknote },
    { id: 'audit', label: '8. Audit-Log Flow', icon: History },
    { id: 'api', label: '9. API Structure', icon: Server },
    { id: 'deployment', label: '10. Deployment Architecture', icon: Cloud },
  ];

  return (
    <div id="system-docs-view" className="space-y-6">
      <div className="border-b border-neutral-200 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Technical Architecture & System Documentation
        </h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Comprehensive specification of the User-Only Salary, Attendance, Schedule, and Late Tracking System.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Navigation Sidebar */}
        <div className="lg:col-span-4 space-y-1">
          {sections.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs font-semibold text-left transition-all cursor-pointer ${
                  isActive
                    ? 'bg-neutral-900 text-white shadow-sm'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : 'text-neutral-500'}`} />
                <span>{sec.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Pane */}
        <div className="lg:col-span-8 bg-white border border-neutral-200 rounded-xl p-6 shadow-sm min-h-[500px]">
          {activeSection === 'arch' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-neutral-900">1. Application Architecture</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                The application is architected as a strict <strong>User-Only, Multi-Tier System</strong>. There is no admin panel or administrator role. Every user has their own private account and credentials, and can only access their own records.
              </p>
              <pre className="p-4 bg-neutral-900 text-emerald-400 font-mono text-xs rounded-lg overflow-x-auto">
{`+-------------------------------------------------------------+
|               USER CLIENT LAYER (React + Vite)              |
|  - Login / Register / Forgot Password UI                    |
|  - Dashboard (7:00 AM Schedule, Late Badge, 10h/30h Limits) |
|  - Check In / Check Out Terminal with Manila Clock          |
|  - Late Tracking, Salary Records, My Schedule, Audit Logs   |
+------------------------------+------------------------------+
                               |
               HTTPS / JSON API with Bearer JWT
                               |
+------------------------------v------------------------------+
|             EXPRESS SERVER LAYER (Port 3000)                |
|  - Auth Middleware: Decodes JWT, extracts req.user.id       |
|  - Route Handlers: Attendance, Salary, Schedule, Audit      |
|  - Security: Rate Limiting & Account Lockout Guard          |
+------------------------------+------------------------------+
                               |
                   Transaction / Mutex Lock
                               |
+------------------------------v------------------------------+
|            BUSINESS LOGIC & PERSISTENCE SERVICE             |
|  - Asia/Manila Clock Authority (Never trust client device)  |
|  - Late Engine: Actual Time In - 07:00 AM                   |
|  - Ceilings: Max 10 hrs/day (₱1,000) & 30 hrs/week (₱3,000) |
|  - SQLite / PostgreSQL ACID Transaction Storage             |
+-------------------------------------------------------------+`}
              </pre>
            </div>
          )}

          {activeSection === 'erd' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-neutral-900">2. Database Entity Relationship Diagram (ERD)</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Every table in the database has a mandatory foreign key reference to <code>users(id)</code> with cascade on delete, guaranteeing zero cross-user leakage.
              </p>
              <pre className="p-4 bg-neutral-900 text-neutral-200 font-mono text-xs rounded-lg overflow-x-auto">
{` [USERS]
   id (PK, UUID)
   full_name (VARCHAR)
   email (VARCHAR, UNIQUE)
   password_hash (VARCHAR)
   phone (VARCHAR)
   profile_picture (VARCHAR)
   account_status (VARCHAR)
   created_at (TIMESTAMP)
   updated_at (TIMESTAMP)
      |
      | 1:N
      +-----> [SCHEDULES]
      |         id (PK)
      |         user_id (FK -> users.id)
      |         day_of_week ('Monday'..'Sunday')
      |         start_time ('07:00')
      |         end_time ('17:00')
      |         is_rest_day (BOOLEAN)
      |
      | 1:N
      +-----> [ATTENDANCE]
      |         id (PK)
      |         user_id (FK -> users.id)
      |         work_date (DATE)
      |         scheduled_start ('07:00')
      |         scheduled_end ('17:00')
      |         time_in (TIME)
      |         time_out (TIME)
      |         break_hours (REAL)
      |         regular_hours (REAL, <= 10.0)
      |         overtime_hours (REAL)
      |         late_minutes (INTEGER)
      |         attendance_status ('ON_TIME'|'LATE'|'REST_DAY')
      |         hourly_rate (REAL, 100.0)
      |         salary (REAL, regular_hours * 100)
      |
      | 1:N
      +-----> [SALARY_RECORDS]
      |         id (PK)
      |         user_id (FK -> users.id)
      |         week_start (DATE, Monday)
      |         week_end (DATE, Sunday)
      |         regular_hours (REAL, <= 30.0)
      |         gross_salary (REAL, <= 3000.0)
      |
      | 1:N
      +-----> [AUDIT_LOGS]
                id (PK)
                user_id (FK -> users.id)
                action (VARCHAR)
                description (TEXT)
                timestamp (TIMESTAMP)
                ip_address (VARCHAR)`}
              </pre>
            </div>
          )}

          {activeSection === 'schema' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-neutral-900">3. Database Schema (SQL Definition)</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Normalized relational tables enforced with foreign keys, UNIQUE constraints, and indexes.
              </p>
              <pre className="p-4 bg-neutral-900 text-emerald-400 font-mono text-xs rounded-lg overflow-x-auto">
{`CREATE TABLE users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  phone TEXT,
  profile_picture TEXT,
  account_status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '07:00',
  end_time TEXT NOT NULL DEFAULT '17:00',
  is_rest_day INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, day_of_week)
);

CREATE TABLE attendance (
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, work_date)
);

CREATE INDEX idx_attendance_user_date ON attendance(user_id, work_date);`}
              </pre>
            </div>
          )}

          {activeSection === 'auth' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-neutral-900">4. Authentication Flow</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Tokens are signed with user identity only. Passwords use bcrypt salt rounds 10. Rate limiting enforces a 5-minute lockout after 5 consecutive failed attempts.
              </p>
              <pre className="p-4 bg-neutral-900 text-sky-400 font-mono text-xs rounded-lg overflow-x-auto">
{`User Client                    Server API                 Database
    |                              |                          |
    |---- POST /auth/login ------->|                          |
    |     { email, password }      |-- Check Lockout Map ---->|
    |                              |-- Query user by email -->|
    |                              |<-- Return password_hash -|
    |                              |-- bcrypt.compare()       |
    |                              |   [If Invalid: Lockout++]|
    |                              |   [If Valid: Clear tries]|
    |                              |-- Write LOGIN audit log->|
    |<--- 200 OK + JWT Token ------|                          |
    |     { token, user }          |                          |
    |                              |                          |
    |---- Authenticated Req ------>|-- Verify JWT Token       |
    |     Authorization: Bearer    |-- req.user = decoded     |
    |                              |-- Execute query with     |
    |                              |   WHERE user_id = req.user.id`}
              </pre>
            </div>
          )}

          {activeSection === 'checkin' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-neutral-900">5. Check-In / Check-Out Flow</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                All time is resolved strictly using the official server clock in <code>Asia/Manila</code> timezone. Client clocks are completely ignored.
              </p>
              <pre className="p-4 bg-neutral-900 text-amber-400 font-mono text-xs rounded-lg overflow-x-auto">
{`CHECK-IN FLOW:
1. Client clicks "Punch In".
2. Server queries current Manila time (HH:mm) and date (YYYY-MM-DD).
3. Validate: Is user already checked in today? (If yes, throw 400).
4. Validate: Has user already reached 30.0 hours this week? (If yes, throw 400).
5. Compare Time In with scheduledStart (7:00 AM).
   If Time In > 07:00:
     late_minutes = (Time In - 07:00)
     status = 'LATE'
   Else:
     late_minutes = 0
     status = 'ON_TIME'
6. Insert attendance record inside ACID transaction.
7. Write CHECK_IN audit log.

CHECK-OUT FLOW:
1. Client clicks "Punch Out" with breakHours.
2. Server queries active check-in row for req.user.id.
3. Server records Time Out in Asia/Manila.
4. Calculate net elapsed hours: (Time Out - Time In) - breakHours.
5. Apply Daily Limit: regular_hours = min(10.0, net_hours).
6. Apply Weekly Limit:
   Query approved hours this week (Monday to Sunday).
   If existingWeeklyHours + regular_hours > 30.0:
     Throw: "You only have X regular working hours remaining this week."
7. Calculate salary: regular_hours * ₱100.00 (Max ₱1,000/day).
8. Commit update to attendance and write CHECK_OUT audit log.`}
              </pre>
            </div>
          )}

          {activeSection === 'late' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-neutral-900">6. Late-Minute Calculation Flow</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Late minutes are calculated strictly relative to the <strong>7:00 AM</strong> scheduled start time:
              </p>
              <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200 font-mono text-xs text-neutral-800 space-y-1.5">
                <div>• Arrival at <strong>06:55 AM</strong> → 0 late minutes (ON TIME)</div>
                <div>• Arrival at <strong>07:00 AM</strong> → 0 late minutes (ON TIME)</div>
                <div>• Arrival at <strong>07:01 AM</strong> → 1 late minute (LATE)</div>
                <div>• Arrival at <strong>07:05 AM</strong> → 5 late minutes (LATE)</div>
                <div>• Arrival at <strong>07:30 AM</strong> → 30 late minutes (LATE)</div>
                <div>• Formula: <code>diff = (hour * 60 + min) - 420; late_minutes = diff &gt; 0 ? diff : 0;</code></div>
              </div>
            </div>
          )}

          {activeSection === 'salary' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-neutral-900">7. Salary Calculation Flow</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Salary is computed purely on approved regular hours:
              </p>
              <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200 font-mono text-xs text-neutral-800 space-y-1.5">
                <div>• Hourly Rate = <strong>₱100.00 / hour</strong></div>
                <div>• Daily Regular Hours = <code>min(10.0, net_hours)</code></div>
                <div>• Daily Regular Salary = <code>regular_hours * 100.0</code> (Max <strong>₱1,000.00 / day</strong>)</div>
                <div>• Weekly Regular Cap = <strong>30.0 hours / calendar week</strong> (Monday to Sunday)</div>
                <div>• Max Weekly Regular Salary = <code>30.0 * 100.0 = <strong>₱3,000.00 / week</strong></code></div>
              </div>
            </div>
          )}

          {activeSection === 'audit' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-neutral-900">8. Audit-Log Flow</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Immutable, append-only security logs are written for every sensitive action:
              </p>
              <ul className="list-disc pl-5 text-xs text-neutral-700 space-y-1">
                <li><code>REGISTER</code>: Account registration timestamp and identity.</li>
                <li><code>LOGIN</code> / <code>LOGOUT</code>: Session authentication with IP address and user-agent.</li>
                <li><code>FAILED_LOGIN</code>: Suspicious password failure tracking for lockout protection.</li>
                <li><code>CHECK_IN</code>: Timestamp, arrival status, and late minutes calculated.</li>
                <li><code>CHECK_OUT</code>: Time Out, net hours worked, and salary earned.</li>
                <li><code>SCHEDULE_UPDATED</code> / <code>PROFILE_UPDATED</code> / <code>PASSWORD_CHANGED</code></li>
              </ul>
            </div>
          )}

          {activeSection === 'api' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-neutral-900">9. API Structure</h3>
              <pre className="p-4 bg-neutral-900 text-neutral-200 font-mono text-xs rounded-lg overflow-x-auto">
{`POST /api/auth/register          Register new user account
POST /api/auth/login             Login with email & password (rate-limited)
POST /api/auth/logout            Logout user session
GET  /api/auth/me                Get authenticated user profile
POST /api/auth/forgot-password   Issue password reset token
POST /api/auth/reset-password    Reset password using valid token
PUT  /api/auth/profile           Update full name & phone
PUT  /api/auth/profile/password  Change account password

GET  /api/dashboard              Get personalized dashboard metrics
POST /api/attendance/check-in    Atomic Punch In with 7:00 AM late calc
POST /api/attendance/check-out   Atomic Punch Out with 10h/30h ceilings
GET  /api/attendance/today       Get today's active shift info
GET  /api/attendance/history     Get attendance history (filtered)

GET  /api/schedule               Get user's 7-day schedule
PUT  /api/schedule/:day          Update schedule for day

GET  /api/salary                 Get current week salary breakdown (max ₱3k)
GET  /api/salary/history         Get daily salary payout history

GET  /api/late/summary           Get late statistics (today, week, month)
GET  /api/late/history           Get late records history

GET  /api/audit-logs             Get user's immutable audit trail
GET  /api/tests/run              Run automated verification test suite`}
              </pre>
            </div>
          )}

          {activeSection === 'deployment' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-neutral-900">10. Deployment Architecture</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Cloud container deployment configured for production:
              </p>
              <ul className="list-disc pl-5 text-xs text-neutral-700 space-y-1">
                <li><strong>Port & Host:</strong> Express binds to <code>0.0.0.0:3000</code> behind reverse proxy.</li>
                <li><strong>HTTPS Enforced:</strong> Secure cookie/token headers over TLS.</li>
                <li><strong>Database Persistence:</strong> SQLite/Postgres with transaction mutex preventing concurrency race conditions.</li>
                <li><strong>Health Check Endpoint:</strong> <code>GET /api/health</code> returning <code>200 OK</code> for container orchestrator readiness and liveness probes.</li>
                <li><strong>Bundle Compilation:</strong> Vite builds static assets to <code>dist/</code>; esbuild bundles backend into single self-contained <code>dist/server.cjs</code>.</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
