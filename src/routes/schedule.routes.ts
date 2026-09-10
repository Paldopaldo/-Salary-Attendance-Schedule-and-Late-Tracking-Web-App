import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.middleware.ts';
import { ScheduleService } from '../services/schedule.service.ts';
import { AuditService } from '../services/audit.service.ts';

const router = Router();

/**
 * GET /api/schedule
 * User gets their own 7-day schedule
 */
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const schedules = await ScheduleService.getUserSchedule(userId);
    return res.json(schedules);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/schedule/:day
 * User updates their schedule for a specific day
 */
router.put('/:day', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const day = req.params.day;
    const { scheduledStart, scheduledEnd, isRestDay } = req.body;

    const updated = await ScheduleService.updateScheduleDay(userId, day, {
      scheduledStart: scheduledStart || '07:00',
      scheduledEnd: scheduledEnd || '17:00',
      isRestDay: Boolean(isRestDay),
    });

    await AuditService.logAction(
      userId,
      'SCHEDULE_UPDATED',
      `Updated schedule for ${day}: ${isRestDay ? 'Rest Day' : `${scheduledStart} - ${scheduledEnd}`}`,
      req.ip || '127.0.0.1'
    );

    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

export default router;
