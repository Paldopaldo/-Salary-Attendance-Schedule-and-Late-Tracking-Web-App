-- SQL Schema for Salary Tracker System
-- Compatible with PostgreSQL and SQLite

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  employee_code TEXT UNIQUE NOT NULL,
  user_id TEXT UNIQUE REFERENCES users(id),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  position TEXT NOT NULL,
  department_id TEXT NOT NULL REFERENCES departments(id),
  hourly_rate REAL NOT NULL DEFAULT 100.0,
  date_hired DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  time_in TEXT NOT NULL,
  time_out TEXT NOT NULL,
  break_hours REAL NOT NULL DEFAULT 0.0,
  total_hours REAL NOT NULL CHECK (total_hours >= 0.0 AND total_hours <= 8.0),
  hourly_rate REAL NOT NULL DEFAULT 100.0,
  daily_salary REAL NOT NULL CHECK (daily_salary >= 0.0 AND daily_salary <= 800.0),
  status TEXT NOT NULL DEFAULT 'PRESENT',
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date);

CREATE TABLE IF NOT EXISTS payroll (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- YYYY-MM
  total_working_days INTEGER NOT NULL,
  total_hours REAL NOT NULL CHECK (total_hours >= 0.0 AND total_hours <= 100.0),
  hourly_rate REAL NOT NULL DEFAULT 100.0,
  gross_salary REAL NOT NULL CHECK (gross_salary >= 0.0 AND gross_salary <= 10000.0),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (employee_id, month)
);

CREATE TABLE IF NOT EXISTS payroll_items (
  id TEXT PRIMARY KEY,
  payroll_id TEXT NOT NULL REFERENCES payroll(id) ON DELETE CASCADE,
  attendance_id TEXT NOT NULL REFERENCES attendance(id),
  date DATE NOT NULL,
  hours REAL NOT NULL,
  hourly_rate REAL NOT NULL,
  daily_salary REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
