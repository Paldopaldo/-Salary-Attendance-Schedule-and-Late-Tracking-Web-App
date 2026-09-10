import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.middleware.ts';
import { SalaryService } from '../services/salary.service.ts';

const router = Router();

/**
 * GET /api/salary
 * Retrieves current weekly salary summary for the user
 */
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const summary = await SalaryService.getCurrentWeekSalary(userId);
    return res.json(summary);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/salary/history
 * Retrieves all historical daily salary payouts
 */
router.get('/history', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const history = await SalaryService.getSalaryHistory(userId);
    return res.json(history);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
