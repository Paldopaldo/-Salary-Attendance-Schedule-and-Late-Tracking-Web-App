import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.middleware.ts';
import { AttendanceService } from '../services/attendance.service.ts';

const router = Router();

/**
 * GET /api/late/summary
 * Retrieves late summary (today, week, month, and late days)
 */
router.get('/summary', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const summary = await AttendanceService.getLateSummary(userId);
    return res.json(summary);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/late/history
 * Retrieves late arrival records
 */
router.get('/history', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const summary = await AttendanceService.getLateSummary(userId);
    return res.json(summary.records);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
