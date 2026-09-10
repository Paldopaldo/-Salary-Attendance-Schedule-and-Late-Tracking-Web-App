import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.middleware.ts';
import { AttendanceService } from '../services/attendance.service.ts';
import { SalaryService } from '../services/salary.service.ts';
import { getDb } from '../db/database.ts';
import { User, UserDashboardData } from '../types.ts';

const router = Router();

/**
 * GET /api/dashboard
 * User-only personalized dashboard payload
 */
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const db = await getDb();

    // Get User Profile
    const userStmt = db.prepare('SELECT id, full_name, email, phone, profile_picture, account_status, created_at, updated_at FROM users WHERE id = ?;');
    userStmt.bind([userId]);
    if (!userStmt.step()) {
      userStmt.free();
      return res.status(404).json({ error: 'User not found.' });
    }
    const userRow = userStmt.getAsObject();
    userStmt.free();

    const user: User = {
      id: userRow.id as string,
      fullName: userRow.full_name as string,
      email: userRow.email as string,
      phone: (userRow.phone as string) || undefined,
      profilePicture: (userRow.profile_picture as string) || undefined,
      accountStatus: userRow.account_status as any,
      createdAt: userRow.created_at as string,
      updatedAt: userRow.updated_at as string,
    };

    // Today's attendance info & weekly metrics
    const today = await AttendanceService.getTodayAttendance(userId);
    const weeklySalary = await SalaryService.getCurrentWeekSalary(userId);
    const lateSummary = await AttendanceService.getLateSummary(userId);
    const recentAttendance = await AttendanceService.getAttendanceHistory(userId, 'month');

    const hoursWorked = weeklySalary.totalWeeklyHours;
    const maxWeeklyHours = 30;
    const remainingHours = Math.max(0, Math.round((maxWeeklyHours - hoursWorked) * 100) / 100);
    const percentageUsed = Math.min(100, Math.round((hoursWorked / maxWeeklyHours) * 100));

    const dashboardData: UserDashboardData = {
      user,
      today,
      weekly: {
        weekLabel: weeklySalary.weekLabel,
        hoursWorked,
        maxWeeklyHours,
        remainingHours,
        weeklySalary: weeklySalary.weeklySalary,
        maxWeeklySalary: 3000,
        percentageUsed,
      },
      lateSummary: {
        lateMinutesThisMonth: lateSummary.lateMinutesThisMonth,
        lateDaysThisMonth: lateSummary.lateDaysThisMonth,
        lateMinutesThisWeek: lateSummary.lateMinutesThisWeek,
      },
      recentAttendance: recentAttendance.slice(0, 10),
    };

    return res.json(dashboardData);
  } catch (err: any) {
    console.error('Dashboard error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
