import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { checkSupabaseHealth, isSupabaseConfigured, migrateSqliteToSupabase, syncFromSupabaseToSqlite } from '../db/supabase.ts';
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
      tablesMissing: (health as any).tablesMissing || false,
      message: health.message,
      error: health.error,
      databaseType: health.connected && !(health as any).tablesMissing ? 'Supabase PostgreSQL' : 'Local SQLite (Connected to Supabase project)',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/supabase/schema
 * Returns the raw SQL setup script so the user can easily copy & run it in Supabase
 */
router.get('/schema', async (_req, res) => {
  try {
    const schemaPath = path.join(process.cwd(), 'supabase-schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      return res.json({ sql });
    }
    return res.status(404).json({ error: 'Schema file not found' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/supabase/sync
 * Pulls latest records directly from Supabase into memory
 */
router.post('/sync', authenticate, async (_req, res) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.status(400).json({
        error: 'Supabase credentials are not configured.',
      });
    }
    const { getDb } = await import('../db/database.ts');
    const db = await getDb();
    const success = await syncFromSupabaseToSqlite(db, true);
    return res.json({
      success,
      message: success
        ? 'Latest records successfully refreshed from Supabase PostgreSQL.'
        : 'Failed to sync from Supabase. Ensure supabase-schema.sql has been executed.',
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
