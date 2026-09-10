import { Router } from 'express';
import { checkSupabaseHealth, isSupabaseConfigured, migrateSqliteToSupabase } from '../db/supabase.ts';
import { authenticate, AuthRequest } from '../middleware/auth.middleware.ts';

const router = Router();

/**
 * GET /api/supabase/status
 * Returns connection and configuration status of Supabase
 */
router.get('/status', async (_req, res) => {
  try {
    const health = await checkSupabaseHealth();
    return res.json({
      configured: health.configured,
      connected: health.connected,
      message: health.message,
      error: health.error,
      databaseType: health.connected ? 'Supabase PostgreSQL' : 'Local SQLite',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/supabase/migrate
 * Copies existing records from SQLite into Supabase (Admin/Authenticated)
 */
router.post('/migrate', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.status(400).json({
        error: 'Supabase credentials are not yet configured in environment variables (SUPABASE_URL and SUPABASE_ANON_KEY).',
      });
    }

    const result = await migrateSqliteToSupabase();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Migration to Supabase failed' });
  }
});

export default router;
