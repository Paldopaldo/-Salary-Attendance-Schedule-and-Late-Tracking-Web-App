import { getDb, withTransaction } from '../db/database.ts';
import { UserSchedule } from '../types.ts';

export class ScheduleService {
  /**
   * Retrieves the 7-day schedule for a user.
   * If not found, initializes default 7:00 AM - 5:00 PM (Mon-Fri) & Sat/Sun Rest Day
   */
  static async getUserSchedule(userId: string): Promise<UserSchedule[]> {
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

    const schedules: UserSchedule[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      schedules.push({
        id: row.id as string,
        userId: row.user_id as string,
        dayOfWeek: row.day_of_week as any,
        scheduledStart: row.start_time as string,
        scheduledEnd: row.end_time as string,
        isRestDay: Boolean(row.is_rest_day),
      });
    }
    stmt.free();

    // If user has no schedule yet, initialize default
    if (schedules.length === 0) {
      await this.initDefaultSchedule(userId);
      return this.getUserSchedule(userId);
    }

    return schedules;
  }

  /**
   * Gets schedule for a specific day of week (e.g. 'Monday')
   */
  static async getScheduleForDay(userId: string, dayOfWeek: string): Promise<UserSchedule> {
    const schedules = await this.getUserSchedule(userId);
    const found = schedules.find((s) => s.dayOfWeek.toLowerCase() === dayOfWeek.toLowerCase());
    if (found) return found;

    return {
      id: `sch-${userId}-${dayOfWeek.toLowerCase()}`,
      userId,
      dayOfWeek: dayOfWeek as any,
      scheduledStart: '07:00',
      scheduledEnd: '17:00',
      isRestDay: dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday',
    };
  }

  /**
   * Updates schedule for a user on a given day
   */
  static async updateScheduleDay(
    userId: string,
    dayOfWeek: string,
    data: { scheduledStart: string; scheduledEnd: string; isRestDay: boolean }
  ): Promise<UserSchedule> {
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
        dayOfWeek: dayOfWeek as any,
        scheduledStart: data.scheduledStart,
        scheduledEnd: data.scheduledEnd,
        isRestDay: data.isRestDay,
      };
    });
  }

  private static async initDefaultSchedule(userId: string): Promise<void> {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    await withTransaction((db) => {
      for (const day of days) {
        const isRest = day === 'Saturday' || day === 'Sunday' ? 1 : 0;
        db.run(
          `INSERT OR IGNORE INTO schedules (id, user_id, day_of_week, start_time, end_time, is_rest_day)
           VALUES (?, ?, ?, '07:00', '17:00', ?);`,
          [`sch-${userId}-${day.toLowerCase()}`, userId, day, isRest]
        );
      }
    });
  }
}
