import { Router } from 'express';
import { runAllTests } from '../tests/salary.test.ts';
import { authenticate } from '../middleware/auth.middleware.ts';

const router = Router();

router.get('/run', authenticate, async (req, res) => {
  try {
    const results = await runAllTests();
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
