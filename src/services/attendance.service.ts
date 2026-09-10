import { getDb, withTransaction } from '../db/database.ts';
import { saveAttendanceToSupabase, deleteAttendanceFromSupabase } from '../db/supabase.ts';
import {
  AttendanceRecord,
  TodayAttendanceInfo,
  LateSummary,
  AttendanceStatus,
} from '../types.ts';
import {
  getManilaNow,
  calculateLateMinutes,
  getManilaWeekRange,
  getDayOfWeek,
  formatTo12Hour,
} from '../utils/timezone.ts';
import { ScheduleService } from './schedule.service.ts';
import { AuditService } from './audit.service.ts';

export class AttendanceService {
  /**
   * Performs atomic Check-In for the authenticated user
   */
  static async checkIn(
    userId: string,
    options?: { customTimeIn?: string; customWorkDate?: string; notes?: string; ipAddress?: string; userAgent?: string }
  ): Promise<{ message: string; record: AttendanceRecord; lateMinutes: number; lateStatus: string }> {
    return withTransaction(async (db) => {
      const manila = getManilaNow();
      const workDate = options?.customWorkDate || manila.date;
      const timeIn = options?.customTimeIn || manila.time;
      const dayOfWeek = getDayOfWeek(workDate);

      // Check if user already checked in today
      const existingStmt = db.prepare('SELECT id, attendance_status, time_in, time_out FROM attendance WHERE user_id = ? AND work_date = ?');
      existingStmt.bind([userId, workDate]);
      if (existingStmt.step()) {
        const existing = existingStmt.getAsObject();
        existingStmt.free();
        if (!existing.time_out) {
          throw new Error('You are already checked in for today.');
        } else {
          throw new Error('You have already completed your shift for today.');
        }
      }
      existingStmt.free();

      // Retrieve user's schedule for today
      const schedule = await ScheduleService.getScheduleForDay(userId, dayOfWeek);
      const scheduledStart = schedule.scheduledStart || '07:00';
      const scheduledEnd = schedule.scheduledEnd || '17:00';

      // Check weekly hours cap (30 hours limit)
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

      if (currentWeeklyHours >= 30.0) {
        throw new Error('Weekly limit reached: You have already completed 30 regular hours this week.');
      }

      // Calculate late minutes against scheduled start time (7:00 AM)
      const lateMinutes = calculateLateMinutes(timeIn, scheduledStart);
      const attendanceStatus: AttendanceStatus = schedule.isRestDay
        ? 'REST_DAY'
        : lateMinutes > 0
        ? 'LATE'
        : 'ON_TIME';

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
          options?.notes || null,
        ]
      );

      const record: AttendanceRecord = {
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
        hourlyRate: 100.0,
        salary: 0,
        notes: options?.notes,
        createdAt: manila.isoString,
        updatedAt: manila.isoString,
      };

      // Persist directly to Supabase
      saveAttendanceToSupabase(record).catch((e) => console.warn('[Supabase] checkIn save:', e));

      // Create Audit Log
      const lateMsg = lateMinutes > 0 ? `${lateMinutes} minutes late` : 'on time';
      await AuditService.logAction(
        userId,
        'CHECK_IN',
        `Checked in at ${formatTo12Hour(timeIn)} (Scheduled: ${formatTo12Hour(scheduledStart)} · ${lateMsg})`,
        options?.ipAddress || '127.0.0.1',
        options?.userAgent || 'App-Client'
      );

      return {
        message:
          lateMinutes > 0
            ? `Successfully checked in at ${formatTo12Hour(timeIn)}. You are ${lateMinutes} minutes late.`
            : `Successfully checked in at ${formatTo12Hour(timeIn)}. You are on time!`,
        record,
        lateMinutes,
        lateStatus: attendanceStatus,
      };
    });
  }

  /**
   * Performs atomic Check-Out and calculates working hours, salary, and enforces 10h daily and 30h weekly limits
   */
  static async checkOut(
    userId: string,
    options?: {
      customTimeOut?: string;
      customWorkDate?: string;
      breakHours?: number;
      notes?: string;
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<{ message: string; attendance: AttendanceRecord; summary: any }> {
    return withTransaction(async (db) => {
      const manila = getManilaNow();
      const workDate = options?.customWorkDate || manila.date;
      const timeOut = options?.customTimeOut || manila.time;
      const breakHours = typeof options?.breakHours === 'number' ? options.breakHours : 1.0;

      // Find active check-in row for user today
      const findStmt = db.prepare(`
        SELECT id, scheduled_start, scheduled_end, time_in, late_minutes, attendance_status, notes
        FROM attendance
        WHERE user_id = ? AND work_date = ? AND time_out IS NULL;
      `);
      findStmt.bind([userId, workDate]);
      if (!findStmt.step()) {
        findStmt.free();
        throw new Error('You do not have an active check-in for today.');
      }
      const active = findStmt.getAsObject();
      findStmt.free();

      const timeIn = active.time_in as string;

      // Parse time intervals
      const [inH, inM] = timeIn.split(':').map(Number);
      const [outH, outM] = timeOut.split(':').map(Number);

      const elapsedMinutes = outH * 60 + outM - (inH * 60 + inM);
      if (elapsedMinutes <= 0) {
        throw new Error('Time Out must be after Time In.');
      }

      const grossHours = Math.round((elapsedMinutes / 60) * 100) / 100;
      if (breakHours >= grossHours) {
        throw new Error('Break hours cannot be greater than or equal to total elapsed shift duration.');
      }

      const netHours = Math.max(0, Math.round((grossHours - breakHours) * 100) / 100);

      // Daily Limit: Maximum 10 hours regular working hours per day
      const regularHours = Math.min(10.0, netHours);
      const overtimeHours = Math.max(0, Math.round((netHours - regularHours) * 100) / 100);

      // Weekly Limit: Maximum 30 hours per calendar week (Monday to Sunday)
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

      const remainingWeeklyHours = Math.max(0, Math.round((30.0 - currentWeeklyHours) * 100) / 100);

      if (regularHours > remainingWeeklyHours) {
        throw new Error(
          `Weekly limit exceeded: You only have ${remainingWeeklyHours.toFixed(
            1
          )} regular working hours remaining this week.`
        );
      }

      // Salary Calculation: ₱100/hour
      const hourlyRate = 100.0;
      const dailySalary = Math.round(regularHours * hourlyRate * 100) / 100;

      // Update Attendance record
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

      // Update or insert weekly salary record
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
          dailySalary,
        ]
      );

      const updatedRecord: AttendanceRecord = {
        id: active.id as string,
        userId,
        workDate,
        scheduledStart: active.scheduled_start as string,
        scheduledEnd: active.scheduled_end as string,
        timeIn,
        timeOut,
        breakHours,
        totalHours: netHours,
        regularHours,
        overtimeHours,
        lateMinutes: Number(active.late_minutes) || 0,
        attendanceStatus: active.attendance_status as any,
        hourlyRate,
        salary: dailySalary,
        notes: (options?.notes || active.notes) as string | undefined,
        createdAt: manila.isoString,
        updatedAt: manila.isoString,
      };

      // Persist directly to Supabase
      saveAttendanceToSupabase(updatedRecord).catch((e) => console.warn('[Supabase] checkOut save:', e));

      // Create Audit Log
      await AuditService.logAction(
        userId,
        'CHECK_OUT',
        `Checked out at ${formatTo12Hour(timeOut)}. Worked: ${regularHours}h · Salary: ₱${dailySalary}`,
        options?.ipAddress || '127.0.0.1',
        options?.userAgent || 'App-Client'
      );

      const totalUpdatedWeekly = currentWeeklyHours + regularHours;
      const leftThisWeek = Math.max(0, 30.0 - totalUpdatedWeekly);

      return {
        message: `Successfully checked out. Worked: ${regularHours}h | Salary: ₱${dailySalary}. You have ${leftThisWeek.toFixed(
          1
        )} hours remaining this week.`,
        attendance: updatedRecord,
        summary: {
          hoursWorked: regularHours,
          salary: dailySalary,
          weeklyHours: totalUpdatedWeekly,
          remainingWeeklyHours: leftThisWeek,
        },
      };
    });
  }

  /**
   * Retrieves status for today's dashboard (or optional targetDate)
   */
  static async getTodayAttendance(userId: string, targetDate?: string): Promise<TodayAttendanceInfo> {
    const db = await getDb();
    const manila = getManilaNow();
    const workDate = targetDate || manila.date;
    const dayOfWeek = getDayOfWeek(workDate);

    const schedule = await ScheduleService.getScheduleForDay(userId, dayOfWeek);
    const scheduledStart = schedule.scheduledStart || '07:00';
    const scheduledEnd = schedule.scheduledEnd || '17:00';
    const isRestDay = schedule.isRestDay;

    // Check today's attendance row
    const attStmt = db.prepare(`
      SELECT id, time_in, time_out, break_hours, total_hours, regular_hours, late_minutes, attendance_status, salary
      FROM attendance
      WHERE user_id = ? AND work_date = ?;
    `);
    attStmt.bind([userId, workDate]);

    let status: 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'CHECKED_OUT' | 'REST_DAY' = isRestDay
      ? 'REST_DAY'
      : 'NOT_CHECKED_IN';
    let attendanceId: string | undefined;
    let timeIn: string | undefined;
    let timeOut: string | undefined;
    let breakHours = 0;
    let totalHours = 0;
    let regularHours = 0;
    let dailySalary = 0;
    let lateMinutes = 0;
    let lateStatus: 'ON_TIME' | 'LATE' | 'REST_DAY' = isRestDay ? 'REST_DAY' : 'ON_TIME';

    if (attStmt.step()) {
      const row = attStmt.getAsObject();
      attendanceId = row.id as string;
      timeIn = row.time_in as string;
      timeOut = (row.time_out as string) || undefined;
      breakHours = Number(row.break_hours) || 0;
      totalHours = Number(row.total_hours) || 0;
      regularHours = Number(row.regular_hours) || 0;
      dailySalary = Number(row.salary) || 0;
      lateMinutes = Number(row.late_minutes) || 0;
      lateStatus = (row.attendance_status as any) || (lateMinutes > 0 ? 'LATE' : 'ON_TIME');

      status = timeOut ? 'CHECKED_OUT' : 'CHECKED_IN';
    }
    attStmt.free();

    // Weekly metrics
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

    const remainingWeeklyHours = Math.max(0, Math.round((30.0 - currentWeeklyHours) * 100) / 100);
    const currentWeeklySalary = currentWeeklyHours * 100.0;

    return {
      status,
      attendanceId,
      workDate,
      dayOfWeek,
      scheduledStart,
      scheduledEnd,
      isRestDay,
      timeIn,
      formattedTimeIn: timeIn ? formatTo12Hour(timeIn) : undefined,
      timeOut,
      formattedTimeOut: timeOut ? formatTo12Hour(timeOut) : undefined,
      breakHours,
      totalHours,
      regularHours,
      dailySalary,
      lateMinutes,
      lateStatus,
      isDailyLimitReached: regularHours >= 10.0,
      currentWeeklyHours,
      remainingWeeklyHours,
      currentWeeklySalary,
      isWeeklyLimitReached: currentWeeklyHours >= 30.0,
    };
  }

  /**
   * Retrieves attendance history strictly for the authenticated user
   */
  static async getAttendanceHistory(
    userId: string,
    filter: 'today' | 'week' | 'month' | 'all' = 'all'
  ): Promise<AttendanceRecord[]> {
    const db = await getDb();
    const manila = getManilaNow();

    let query = `
      SELECT id, user_id, work_date, scheduled_start, scheduled_end, time_in, time_out,
             break_hours, total_hours, regular_hours, overtime_hours, late_minutes,
             attendance_status, hourly_rate, salary, notes, created_at, updated_at
      FROM attendance
      WHERE user_id = ?
    `;
    const params: any[] = [userId];

    if (filter === 'today') {
      query += ` AND work_date = ?`;
      params.push(manila.date);
    } else if (filter === 'week') {
      const weekRange = getManilaWeekRange(manila.date);
      query += ` AND work_date >= ? AND work_date <= ?`;
      params.push(weekRange.weekStart, weekRange.weekEnd);
    } else if (filter === 'month') {
      query += ` AND work_date LIKE ?`;
      params.push(`${manila.month}%`);
    }

    query += ` ORDER BY work_date DESC, time_in DESC;`;

    const stmt = db.prepare(query);
    stmt.bind(params);

    const list: AttendanceRecord[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      list.push({
        id: row.id as string,
        userId: row.user_id as string,
        workDate: row.work_date as string,
        scheduledStart: row.scheduled_start as string,
        scheduledEnd: row.scheduled_end as string,
        timeIn: row.time_in as string,
        timeOut: (row.time_out as string) || undefined,
        breakHours: Number(row.break_hours) || 0,
        totalHours: Number(row.total_hours) || 0,
        regularHours: Number(row.regular_hours) || 0,
        overtimeHours: Number(row.overtime_hours) || 0,
        lateMinutes: Number(row.late_minutes) || 0,
        attendanceStatus: row.attendance_status as any,
        hourlyRate: Number(row.hourly_rate) || 100.0,
        salary: Number(row.salary) || 0,
        notes: (row.notes as string) || undefined,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      });
    }
    stmt.free();

    return list;
  }

  /**
   * Retrieves late metrics and history for the authenticated user
   */
  static async getLateSummary(userId: string): Promise<LateSummary> {
    const db = await getDb();
    const manila = getManilaNow();
    const weekRange = getManilaWeekRange(manila.date);

    // Late today
    const todayStmt = db.prepare('SELECT late_minutes FROM attendance WHERE user_id = ? AND work_date = ?;');
    todayStmt.bind([userId, manila.date]);
    let lateMinutesToday = 0;
    if (todayStmt.step()) {
      lateMinutesToday = Number(todayStmt.getAsObject().late_minutes) || 0;
    }
    todayStmt.free();

    // Late this week
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

    // Late this month
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

    // Late records history
    const historyStmt = db.prepare(`
      SELECT id, work_date, scheduled_start, time_in, late_minutes, attendance_status
      FROM attendance
      WHERE user_id = ? AND late_minutes > 0
      ORDER BY work_date DESC;
    `);
    historyStmt.bind([userId]);

    const records: any[] = [];
    while (historyStmt.step()) {
      const row = historyStmt.getAsObject();
      records.push({
        id: row.id,
        workDate: row.work_date,
        scheduledStart: row.scheduled_start,
        timeIn: row.time_in,
        lateMinutes: row.late_minutes,
        attendanceStatus: row.attendance_status,
      });
    }
    historyStmt.free();

    return {
      lateMinutesToday,
      lateMinutesThisWeek,
      lateMinutesThisMonth,
      lateDaysThisMonth,
      records,
    };
  }

  /**
   * Resets / clears attendance record for today (or specified work date)
   * Helpful for user testing, shift corrections, and simulation
   */
  static async resetToday(userId: string, workDate?: string): Promise<{ message: string }> {
    return withTransaction(async (db) => {
      const manila = getManilaNow();
      const targetDate = workDate || manila.date;

      db.run('DELETE FROM attendance WHERE user_id = ? AND work_date = ?;', [userId, targetDate]);

      // Delete directly from Supabase
      deleteAttendanceFromSupabase(userId, targetDate).catch((e) => console.warn('[Supabase] resetToday delete:', e));

      await AuditService.logAction(
        userId,
        'ATTENDANCE_RESET',
        `Reset/cleared attendance record for ${targetDate}`,
        '127.0.0.1',
        'App-Client'
      );

      return { message: `Shift record for ${targetDate} has been cleared.` };
    });
  }

  /**
   * Logs a complete attendance record with input time in and input time out
   */
  static async logAttendanceRecord(
    userId: string,
    options: {
      workDate?: string;
      timeIn: string;
      timeOut: string;
      breakHours?: number;
      notes?: string;
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<{ message: string; attendance: AttendanceRecord }> {
    return withTransaction(async (db) => {
      const manila = getManilaNow();
      const workDate = options.workDate || manila.date;
      const timeIn = options.timeIn;
      const timeOut = options.timeOut;
      const breakHours = typeof options.breakHours === 'number' ? options.breakHours : 1.0;
      const dayOfWeek = getDayOfWeek(workDate);

      // Retrieve user's schedule for that day
      const schedule = await ScheduleService.getScheduleForDay(userId, dayOfWeek);
      const scheduledStart = schedule.scheduledStart || '07:00';
      const scheduledEnd = schedule.scheduledEnd || '17:00';

      // Parse time intervals
      const [inH, inM] = timeIn.split(':').map(Number);
      const [outH, outM] = timeOut.split(':').map(Number);

      const elapsedMinutes = outH * 60 + outM - (inH * 60 + inM);
      if (elapsedMinutes <= 0) {
        throw new Error('Log Out Attendance time must be after Log Attendance time.');
      }

      const grossHours = Math.round((elapsedMinutes / 60) * 100) / 100;
      if (breakHours >= grossHours) {
        throw new Error('Break hours cannot exceed or equal total elapsed shift duration.');
      }

      const netHours = Math.max(0, Math.round((grossHours - breakHours) * 100) / 100);
      const regularHours = Math.min(10.0, netHours);
      const overtimeHours = Math.max(0, Math.round((netHours - regularHours) * 100) / 100);

      // Check weekly 30h limit
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

      const remainingWeeklyHours = Math.max(0, Math.round((30.0 - currentWeeklyHours) * 100) / 100);
      if (regularHours > remainingWeeklyHours) {
        throw new Error(
          `Weekly limit exceeded: You only have ${remainingWeeklyHours.toFixed(1)} regular hours remaining this week.`
        );
      }

      // Late calculation relative to 7:00 AM
      const lateMinutes = calculateLateMinutes(timeIn, scheduledStart);
      const attendanceStatus = lateMinutes > 0 ? 'LATE' : 'ON_TIME';
      const hourlyRate = 100.0;
      const salary = regularHours * hourlyRate;

      // Delete existing on that date if any
      db.run('DELETE FROM attendance WHERE user_id = ? AND work_date = ?;', [userId, workDate]);

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
          manila.isoString,
        ]
      );

      await AuditService.logAction(
        userId,
        'LOG_ATTENDANCE_ENTRY',
        `Logged attendance: In ${formatTo12Hour(timeIn)}, Out ${formatTo12Hour(timeOut)} on ${workDate} (${regularHours}h · ₱${salary})`,
        options.ipAddress || '127.0.0.1',
        options.userAgent || 'App-Client'
      );

      const createdAttendance = {
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
        attendanceStatus: attendanceStatus as any,
        hourlyRate,
        salary,
        notes: options.notes,
        createdAt: manila.isoString,
        updatedAt: manila.isoString,
      };

      // Persist directly to Supabase
      saveAttendanceToSupabase(createdAttendance).catch((e) => console.warn('[Supabase] logAttendance save:', e));

      return {
        message: `Attendance logged successfully for ${workDate}: In at ${formatTo12Hour(timeIn)}, Out at ${formatTo12Hour(timeOut)} (${regularHours}h · ₱${salary}).`,
        attendance: createdAttendance,
      };
    });
  }
}
