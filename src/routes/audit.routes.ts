import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.middleware.ts';
import { AuditService } from '../services/audit.service.ts';

const router = Router();

/**
 * GET /api/audit-logs
 * User-only audit logs endpoint
 */
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const logs = await AuditService.getUserAuditLogs(userId, limit);
    return res.json(logs);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
