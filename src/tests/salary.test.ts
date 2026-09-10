import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/database.ts';
import { calculateLateMinutes, getManilaWeekRange } from '../utils/timezone.ts';
import { AttendanceService } from '../services/attendance.service.ts';
import { SalaryService } from '../services/salary.service.ts';
import { AuditService } from '../services/audit.service.ts';
import { JWT_SECRET } from '../middleware/auth.middleware.ts';

export interface TestResult {
  name: string;
  category: 'Authentication' | 'Late Calculation' | 'Check-In/Out' | 'Daily Limit' | 'Weekly Limit' | 'User Isolation';
  passed: boolean;
  expected: string;
  actual: string;
  error?: string;
}

export async function runAllTests(): Promise<{ total: number; passed: number; failed: number; results: TestResult[] }> {
  const results: TestResult[] = [];

  function record(
    name: string,
    category: TestResult['category'],
    passed: boolean,
    expected: string,
    actual: string,
    error?: string
  ) {
    results.push({ name, category, passed, expected, actual, error });
  }

  // ==========================================
  // 1. AUTHENTICATION & CREDENTIAL TESTS
  // ==========================================
  try {
    const db = await getDb();

    // 1.1: Valid Juan Login
    const stmt1 = db.prepare("SELECT password_hash FROM users WHERE email = 'juan@example.com'");
    if (stmt1.step()) {
      const hash = String(stmt1.get()[0]);
      stmt1.free();
      const valid = bcrypt.compareSync('password123', hash);
      record('Auth: Valid User Login Credential', 'Authentication', valid, 'Match true', `Match ${valid}`);
    } else {
      stmt1.free();
      record('Auth: Valid User Login Credential', 'Authentication', false, 'Match true', 'User not found');
    }

    // 1.2: Invalid Password
    const stmt2 = db.prepare("SELECT password_hash FROM users WHERE email = 'juan@example.com'");
    if (stmt2.step()) {
      const hash = String(stmt2.get()[0]);
      stmt2.free();
      const invalid = !bcrypt.compareSync('wrongpassword', hash);
      record('Auth: Reject Invalid Password', 'Authentication', invalid, 'Reject true', `Rejected ${invalid}`);
    } else {
      stmt2.free();
      record('Auth: Reject Invalid Password', 'Authentication', false, 'Reject true', 'User not found');
    }

    // 1.3: JWT Token generation and verification
    const token = jwt.sign({ id: 'usr-juan-001', email: 'juan@example.com', fullName: 'Juan Dela Cruz' }, JWT_SECRET, { expiresIn: '1h' });
    const decoded: any = jwt.verify(token, JWT_SECRET);
    record('Auth: JWT Sign & Verify User ID', 'Authentication', decoded.id === 'usr-juan-001', 'usr-juan-001', decoded.id);

  } catch (err: any) {
    record('Auth: System Error', 'Authentication', false, 'Success', 'Threw error', err.message);
  }

  // ==========================================
  // 2. LATE-MINUTE CALCULATION TESTS (7:00 AM START)
  // ==========================================
  try {
    // 2.1: 06:55 AM (Early) -> 0 minutes late
    const late655 = calculateLateMinutes('06:55', '07:00');
    record('Late Calc: 06:55 AM (Early Arrival)', 'Late Calculation', late655 === 0, '0 late minutes', `${late655} late minutes`);

    // 2.2: 07:00 AM (On Time) -> 0 minutes late
    const late700 = calculateLateMinutes('07:00', '07:00');
    record('Late Calc: 07:00 AM (Exact Scheduled Start)', 'Late Calculation', late700 === 0, '0 late minutes', `${late700} late minutes`);

    // 2.3: 07:01 AM (1 minute late) -> 1 minute late
    const late701 = calculateLateMinutes('07:01', '07:00');
    record('Late Calc: 07:01 AM (1 Minute Late)', 'Late Calculation', late701 === 1, '1 late minute', `${late701} late minute`);

    // 2.4: 07:05 AM (5 minutes late) -> 5 minutes late
    const late705 = calculateLateMinutes('07:05', '07:00');
    record('Late Calc: 07:05 AM (5 Minutes Late)', 'Late Calculation', late705 === 5, '5 late minutes', `${late705} late minutes`);

    // 2.5: 07:30 AM (30 minutes late) -> 30 minutes late
    const late730 = calculateLateMinutes('07:30', '07:00');
    record('Late Calc: 07:30 AM (30 Minutes Late)', 'Late Calculation', late730 === 30, '30 late minutes', `${late730} late minutes`);

    // 2.6: 08:15 AM (75 minutes late) -> 75 minutes late
    const late815 = calculateLateMinutes('08:15', '07:00');
    record('Late Calc: 08:15 AM (75 Minutes Late)', 'Late Calculation', late815 === 75, '75 late minutes', `${late815} late minutes`);

  } catch (err: any) {
    record('Late Calc: System Error', 'Late Calculation', false, 'Success', 'Threw error', err.message);
  }

  // ==========================================
  // 3. CHECK-IN / CHECK-OUT WORKFLOW TESTS
  // ==========================================
  try {
    const testUserId = 'usr-test-runner';
    const db = await getDb();

    // Prepare isolated test user
    db.run(`INSERT OR REPLACE INTO users (id, full_name, email, password_hash) VALUES ('usr-test-runner', 'Test Runner', 'runner@test.local', 'hash');`);

    // Clean any previous test attendance for today
    db.run(`DELETE FROM attendance WHERE user_id = 'usr-test-runner';`);

    // Test 3.1: Check-out without check-in -> Expect rejection
    let rejectedNoCheckIn = false;
    try {
      await AttendanceService.checkOut(testUserId, { customTimeOut: '16:00' });
    } catch (e: any) {
      rejectedNoCheckIn = e.message.includes('active check-in');
    }
    record('Check-In/Out: Reject Check-Out Without Active Check-In', 'Check-In/Out', rejectedNoCheckIn, 'Throws active check-in error', rejectedNoCheckIn ? 'Blocked' : 'Allowed');

    // Test 3.2: Valid Check-In at 07:10 (10 mins late)
    const checkInResult = await AttendanceService.checkIn(testUserId, { customTimeIn: '07:10' });
    record(
      'Check-In/Out: Successful Check-In at 07:10 AM',
      'Check-In/Out',
      checkInResult.lateMinutes === 10 && checkInResult.lateStatus === 'LATE',
      '10 late minutes and LATE status',
      `${checkInResult.lateMinutes} mins, ${checkInResult.lateStatus}`
    );

    // Test 3.3: Duplicate Check-in rejection
    let duplicateRejected = false;
    try {
      await AttendanceService.checkIn(testUserId, { customTimeIn: '07:20' });
    } catch (e: any) {
      duplicateRejected = e.message.includes('already checked in');
    }
    record('Check-In/Out: Reject Duplicate Check-In on Same Day', 'Check-In/Out', duplicateRejected, 'Reject duplicate check-in', duplicateRejected ? 'Rejected' : 'Allowed');

    // Test 3.4: Check-out with TimeOut earlier than TimeIn -> Expect rejection
    let invalidTimeRejected = false;
    try {
      await AttendanceService.checkOut(testUserId, { customTimeOut: '06:00' });
    } catch (e: any) {
      invalidTimeRejected = e.message.includes('after Time In');
    }
    record('Check-In/Out: Reject Time Out Earlier Than Time In', 'Check-In/Out', invalidTimeRejected, 'Time Out after Time In error', invalidTimeRejected ? 'Rejected' : 'Allowed');

    // Test 3.5: Valid Check-Out (7:10 to 16:10 = 9h, break 1h = 8h net)
    const checkOutResult = await AttendanceService.checkOut(testUserId, {
      customTimeOut: '16:10',
      breakHours: 1.0,
    });
    record(
      'Check-In/Out: Complete Shift (8.0h worked @ ₱100/hr = ₱800)',
      'Check-In/Out',
      checkOutResult.attendance.regularHours === 8 && checkOutResult.attendance.salary === 800,
      '8.0 hours worked, ₱800 salary',
      `${checkOutResult.attendance.regularHours}h, ₱${checkOutResult.attendance.salary}`
    );

  } catch (err: any) {
    record('Check-In/Out: Workflow Error', 'Check-In/Out', false, 'Success', 'Threw error', err.message);
  }

  // ==========================================
  // 4. DAILY 10-HOUR LIMIT TESTS
  // ==========================================
  try {
    const userId = 'usr-daily-test';
    const db = await getDb();
    db.run(`INSERT OR REPLACE INTO users (id, full_name, email, password_hash) VALUES ('usr-daily-test', 'Daily Tester', 'daily@test.local', 'hash');`);
    db.run(`DELETE FROM attendance WHERE user_id = 'usr-daily-test';`);

    // 4.1: Exactly 10 hours regular shift -> Salary ₱1,000
    await AttendanceService.checkIn(userId, { customTimeIn: '07:00' });
    // 07:00 to 18:00 = 11h elapsed - 1h break = 10h net
    const tenHourShift = await AttendanceService.checkOut(userId, {
      customTimeOut: '18:00',
      breakHours: 1.0,
    });
    record(
      'Daily Limit: Exactly 10 Regular Hours (Max Daily ₱1,000)',
      'Daily Limit',
      tenHourShift.attendance.regularHours === 10.0 && tenHourShift.attendance.salary === 1000.0,
      '10.0 regular hours, ₱1,000 salary',
      `${tenHourShift.attendance.regularHours}h, ₱${tenHourShift.attendance.salary}`
    );

    // 4.2: 12 net hours worked -> Capped at 10.0 regular hours, 2.0 hours overtime
    db.run(`DELETE FROM attendance WHERE user_id = 'usr-daily-test';`);
    await AttendanceService.checkIn(userId, { customTimeIn: '06:00' });
    // 06:00 to 19:00 = 13h - 1h break = 12h net
    const twelveHourShift = await AttendanceService.checkOut(userId, {
      customTimeOut: '19:00',
      breakHours: 1.0,
    });
    record(
      'Daily Limit: 12 Hours Capped at 10 Regular Hours (₱1,000 Regular Pay)',
      'Daily Limit',
      twelveHourShift.attendance.regularHours === 10.0 && twelveHourShift.attendance.salary === 1000.0 && twelveHourShift.attendance.overtimeHours === 2.0,
      'Regular hours capped at 10.0, salary ₱1,000',
      `${twelveHourShift.attendance.regularHours}h reg, ₱${twelveHourShift.attendance.salary}, ${twelveHourShift.attendance.overtimeHours}h OT`
    );

  } catch (err: any) {
    record('Daily Limit: System Error', 'Daily Limit', false, 'Success', 'Threw error', err.message);
  }

  // ==========================================
  // 5. WEEKLY 30-HOUR LIMIT TESTS (MON-SUN)
  // ==========================================
  try {
    const userId = 'usr-weekly-test';
    const db = await getDb();
    db.run(`INSERT OR REPLACE INTO users (id, full_name, email, password_hash) VALUES ('usr-weekly-test', 'Weekly Tester', 'weekly@test.local', 'hash');`);
    db.run(`DELETE FROM attendance WHERE user_id = 'usr-weekly-test';`);

    const weekRange = getManilaWeekRange();
    const testDate = weekRange.weekEnd; // Sunday of this week

    // Seed 28 hours earlier in the same week (Mon, Tue, Wed)
    // Mon: 10h, Tue: 10h, Wed: 8h = 28h total
    db.run(
      `INSERT INTO attendance (id, user_id, work_date, scheduled_start, time_in, time_out, break_hours, total_hours, regular_hours, salary, attendance_status)
       VALUES ('att-w1', 'usr-weekly-test', ?, '07:00', '07:00', '18:00', 1.0, 10.0, 10.0, 1000.0, 'ON_TIME'),
              ('att-w2', 'usr-weekly-test', date(?, '+1 day'), '07:00', '07:00', '18:00', 1.0, 10.0, 10.0, 1000.0, 'ON_TIME'),
              ('att-w3', 'usr-weekly-test', date(?, '+2 day'), '07:00', '07:00', '16:00', 1.0, 8.0, 8.0, 800.0, 'ON_TIME');`,
      [weekRange.weekStart, weekRange.weekStart, weekRange.weekStart]
    );

    // 5.1: 28h existing + 2h today = 30h (ALLOWED)
    await AttendanceService.checkIn(userId, { customTimeIn: '07:00', customWorkDate: testDate });
    // 07:00 to 09:00 = 2h net (break 0)
    const allowedWeekly = await AttendanceService.checkOut(userId, {
      customTimeOut: '09:00',
      customWorkDate: testDate,
      breakHours: 0.0,
    });
    record(
      'Weekly Limit: 28h Existing + 2h Today = 30h Max (ALLOW)',
      'Weekly Limit',
      allowedWeekly.attendance.regularHours === 2.0 && allowedWeekly.summary.weeklyHours === 30.0,
      '30.0 total weekly hours',
      `${allowedWeekly.summary.weeklyHours}h total weekly`
    );

    // 5.2: At 30h total -> New check-in must be REJECTED immediately!
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
      await AttendanceService.checkIn(userId, { customTimeIn: '07:00', customWorkDate: testDate });
    } catch (e: any) {
      weeklyCheckInBlocked = e.message.includes('Weekly limit reached') || e.message.includes('30 regular hours');
    }
    record(
      'Weekly Limit: 30h Reached -> Block New Check-In',
      'Weekly Limit',
      weeklyCheckInBlocked,
      'Blocked with weekly limit message',
      weeklyCheckInBlocked ? 'Blocked' : 'Allowed'
    );

    // 5.3: 28h existing + 3h today = 31h -> REJECT checkout with exact remaining hours message
    db.run(`DELETE FROM attendance WHERE user_id = 'usr-weekly-test';`);
    db.run(
      `INSERT INTO attendance (id, user_id, work_date, scheduled_start, time_in, time_out, break_hours, total_hours, regular_hours, salary, attendance_status)
       VALUES ('att-w1', 'usr-weekly-test', ?, '07:00', '07:00', '18:00', 1.0, 10.0, 10.0, 1000.0, 'ON_TIME'),
              ('att-w2', 'usr-weekly-test', date(?, '+1 day'), '07:00', '07:00', '18:00', 1.0, 10.0, 10.0, 1000.0, 'ON_TIME'),
              ('att-w3', 'usr-weekly-test', date(?, '+2 day'), '07:00', '07:00', '16:00', 1.0, 8.0, 8.0, 800.0, 'ON_TIME');`,
      [weekRange.weekStart, weekRange.weekStart, weekRange.weekStart]
    );

    await AttendanceService.checkIn(userId, { customTimeIn: '07:00', customWorkDate: testDate });
    let excessCheckOutBlocked = false;
    let excessMsg = '';
    try {
      // Try to check out 3 hours (07:00 to 10:00, break 0 = 3h)
      await AttendanceService.checkOut(userId, { customTimeOut: '10:00', customWorkDate: testDate, breakHours: 0.0 });
    } catch (e: any) {
      excessCheckOutBlocked = e.message.includes('Weekly limit exceeded') && e.message.includes('2.0');
      excessMsg = e.message;
    }
    record(
      'Weekly Limit: 28h + 3h = REJECT ("You only have 2.0 regular working hours remaining")',
      'Weekly Limit',
      excessCheckOutBlocked,
      'Throws "You only have 2.0 regular working hours remaining this week."',
      excessMsg || 'Not blocked'
    );

    // 5.4: Test logAttendanceRecord with input types (timeIn, timeOut, breakHours)
    db.run(`DELETE FROM attendance WHERE user_id = 'usr-weekly-test';`);
    const logResult = await AttendanceService.logAttendanceRecord('usr-weekly-test', {
      workDate: '2026-09-08',
      timeIn: '07:15',
      timeOut: '17:15',
      breakHours: 1.0,
      notes: 'Testing manual input types',
    });
    record(
      'Input Types: logAttendanceRecord creates valid 9.0h record with late tracking',
      'Check-In/Out',
      logResult.attendance.regularHours === 9.0 &&
        logResult.attendance.salary === 900.0 &&
        logResult.attendance.lateMinutes === 15,
      '9.0 regular hours, ₱900 salary, 15 late minutes',
      `${logResult.attendance.regularHours}h, ₱${logResult.attendance.salary}, ${logResult.attendance.lateMinutes}m late`
    );

    // 5.5: Test resetToday clears the record
    await AttendanceService.resetToday('usr-weekly-test', '2026-09-08');
    const resetCheck = await AttendanceService.getTodayAttendance('usr-weekly-test', '2026-09-08');
    record(
      'Input Types: resetToday clears attendance record for re-entry',
      'Check-In/Out',
      resetCheck.status === 'NOT_CHECKED_IN' && resetCheck.regularHours === 0,
      'Status reset to NOT_CHECKED_IN with 0 regular hours',
      `Status: ${resetCheck.status}, Hours: ${resetCheck.regularHours}`
    );

  } catch (err: any) {
    record('Weekly Limit: System Error', 'Weekly Limit', false, 'Success', 'Threw error', err.message);
  }

  // ==========================================
  // 6. USER DATA ISOLATION & SECURITY TESTS
  // ==========================================
  try {
    const userA = 'usr-juan-001';
    const userB = 'usr-maria-002';

    // 6.1: Juan's attendance history returns only Juan's records
    const juanAttendance = await AttendanceService.getAttendanceHistory(userA, 'all');
    const hasMariaRecordInJuan = juanAttendance.some((rec) => rec.userId === userB);
    record(
      'User Isolation: User A Cannot Query User B Attendance Records',
      'User Isolation',
      !hasMariaRecordInJuan && juanAttendance.length > 0,
      '0 records of User B in User A list',
      `${juanAttendance.filter((r) => r.userId === userB).length} records leaked`
    );

    // 6.2: Maria's attendance history returns 0 of Juan's records
    const mariaAttendance = await AttendanceService.getAttendanceHistory(userB, 'all');
    const hasJuanRecordInMaria = mariaAttendance.some((rec) => rec.userId === userA);
    record(
      'User Isolation: User B Cannot Query User A Attendance Records',
      'User Isolation',
      !hasJuanRecordInMaria,
      '0 records of User A in User B list',
      `${mariaAttendance.filter((r) => r.userId === userA).length} records leaked`
    );

    // 6.3: User A's Audit logs are strictly User A's
    await AuditService.logAction(userA, 'TEST_ACTION', 'User A test log');
    await AuditService.logAction(userB, 'TEST_ACTION', 'User B test log');

    const juanLogs = await AuditService.getUserAuditLogs(userA);
    const hasMariaLogsInJuan = juanLogs.some((l) => l.userId === userB);
    record(
      'User Isolation: User A Cannot Access User B Audit Trail',
      'User Isolation',
      !hasMariaLogsInJuan,
      'Strict User Isolation in Audit Logs',
      hasMariaLogsInJuan ? 'Leaked logs' : 'Strictly isolated'
    );

    // 6.4: User A's Salary records are strictly User A's
    const juanSalary = await SalaryService.getCurrentWeekSalary(userA);
    const hasMariaInSalary = juanSalary.records.some((r) => r.userId === userB);
    record(
      'User Isolation: User A Cannot Access User B Salary Calculations',
      'User Isolation',
      !hasMariaInSalary,
      'Strict User Isolation in Salary Service',
      hasMariaInSalary ? 'Leaked salary' : 'Strictly isolated'
    );

  } catch (err: any) {
    record('User Isolation: System Error', 'User Isolation', false, 'Success', 'Threw error', err.message);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  return {
    total: results.length,
    passed,
    failed,
    results,
  };
}
