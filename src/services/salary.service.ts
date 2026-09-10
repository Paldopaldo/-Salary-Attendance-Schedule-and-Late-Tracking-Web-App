import { getDb } from '../db/database.ts';
import { WeeklySalarySummary, AttendanceRecord } from '../types.ts';
import { getManilaNow, getManilaWeekRange } from '../utils/timezone.ts';

export class SalaryService {
  /**
   * Retrieves the current week's salary summary for the authenticated user
   */
  static async getCurrentWeekSalary(userId: string, targetDate?: string): Promise<WeeklySalarySummary> {
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

    const records: AttendanceRecord[] = [];
    let totalWeeklyHours = 0;
    let weeklySalary = 0;

    while (stmt.step()) {
      const row = stmt.getAsObject();
      const regHours = Number(row.regular_hours) || 0;
      const sal = Number(row.salary) || 0;

      totalWeeklyHours += regHours;
      weeklySalary += sal;

      records.push({
        id: row.id as string,
        userId: row.user_id as string,
        workDate: row.work_date as string,
        scheduledStart: row.scheduled_start as string,
        scheduledEnd: row.scheduled_end as string,
        timeIn: row.time_in as string,
        timeOut: row.time_out as string,
        breakHours: Number(row.break_hours) || 0,
        totalHours: Number(row.total_hours) || 0,
        regularHours: regHours,
        overtimeHours: Number(row.overtime_hours) || 0,
        lateMinutes: Number(row.late_minutes) || 0,
        attendanceStatus: row.attendance_status as any,
        hourlyRate: Number(row.hourly_rate) || 100.0,
        salary: sal,
        notes: (row.notes as string) || undefined,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      });
    }
    stmt.free();

    totalWeeklyHours = Math.round(totalWeeklyHours * 100) / 100;
    weeklySalary = Math.round(weeklySalary * 100) / 100;
    const remainingWeeklyHours = Math.max(0, Math.round((30.0 - totalWeeklyHours) * 100) / 100);

    return {
      weekStart: weekRange.weekStart,
      weekEnd: weekRange.weekEnd,
      weekLabel: weekRange.weekLabel,
      totalWeeklyHours,
      remainingWeeklyHours,
      weeklySalary,
      hourlyRate: 100.0,
      records,
    };
  }

  /**
   * Retrieves historical salary records by date
   */
  static async getSalaryHistory(userId: string): Promise<Array<{
    workDate: string;
    regularHours: number;
    hourlyRate: number;
    salary: number;
    attendanceStatus: string;
  }>> {
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT work_date, regular_hours, hourly_rate, salary, attendance_status
      FROM attendance
      WHERE user_id = ? AND time_out IS NOT NULL
      ORDER BY work_date DESC;
    `);
    stmt.bind([userId]);

    const history: any[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      history.push({
        workDate: row.work_date,
        regularHours: Number(row.regular_hours) || 0,
        hourlyRate: Number(row.hourly_rate) || 100.0,
        salary: Number(row.salary) || 0,
        attendanceStatus: row.attendance_status,
      });
    }
    stmt.free();

    return history;
  }
}
