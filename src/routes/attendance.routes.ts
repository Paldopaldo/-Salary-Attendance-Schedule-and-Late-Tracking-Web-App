import { Router } from 'express';
import { AttendanceService } from '../services/attendance.service.ts';
import { authenticate, AuthRequest } from '../middleware/auth.middleware.ts';

const router = Router();

/**
 * POST /api/attendance/check-in
 * User punch-in with 7:00 AM late calculation
 * Supports customTimeIn or timeIn, and customWorkDate or workDate
 */
router.post('/check-in', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { customTimeIn, timeIn, customWorkDate, workDate, date, notes } = req.body;

    const result = await AttendanceService.checkIn(userId, {
      customTimeIn: customTimeIn || timeIn,
      customWorkDate: customWorkDate || workDate || date,
      notes,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'App-Client',
    });

    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Check-in failed.' });
  }
});

/**
 * POST /api/attendance/check-out
 * User punch-out with 10h daily and 30h weekly limit validation
 * Supports customTimeOut or timeOut, breakHours, and customWorkDate
 */
router.post('/check-out', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { customTimeOut, timeOut, customWorkDate, workDate, date, breakHours, notes } = req.body;

    const result = await AttendanceService.checkOut(userId, {
      customTimeOut: customTimeOut || timeOut,
      customWorkDate: customWorkDate || workDate || date,
      breakHours: typeof breakHours === 'number' ? breakHours : undefined,
      notes,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'App-Client',
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Check-out failed.' });
  }
});

/**
 * POST /api/attendance/log-entry
 * Directly logs a complete shift with input type for log attendance (timeIn) and log out attendance (timeOut)
 */
router.post('/log-entry', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { workDate, date, timeIn, timeOut, breakHours, notes } = req.body;

    if (!timeIn) {
      return res.status(400).json({ error: 'Please specify Time In (Log Attendance time).' });
    }
    if (!timeOut) {
      return res.status(400).json({ error: 'Please specify Time Out (Log Out Attendance time).' });
    }

    const result = await AttendanceService.logAttendanceRecord(userId, {
      workDate: workDate || date,
      timeIn,
      timeOut,
      breakHours: typeof breakHours === 'number' ? breakHours : Number(breakHours) || 1.0,
      notes,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'App-Client',
    });

    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to log attendance entry.' });
  }
});

/**
 * POST /api/attendance/reset-today
 * Clears today's punch record to allow easy re-logging and testing
 */
router.post('/reset-today', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { workDate, date } = req.body;
    const result = await AttendanceService.resetToday(userId, workDate || date);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to reset today.' });
  }
});

/**
 * GET /api/attendance/today
 * Retrieves active shift, today's schedule, late status, and weekly quota
 */
router.get('/today', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const info = await AttendanceService.getTodayAttendance(userId);
    return res.json(info);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/attendance/history
 * Retrieves attendance logs for the authenticated user only
 */
router.get('/history', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const filter = (req.query.filter as any) || 'all';
    const history = await AttendanceService.getAttendanceHistory(userId, filter);
    return res.json(history);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
