import express, { Express } from 'express';
import authRoutes from './routes/auth.routes.ts';
import attendanceRoutes from './routes/attendance.routes.ts';
import dashboardRoutes from './routes/dashboard.routes.ts';
import scheduleRoutes from './routes/schedule.routes.ts';
import salaryRoutes from './routes/salary.routes.ts';
import lateRoutes from './routes/late.routes.ts';
import auditRoutes from './routes/audit.routes.ts';
import testRoutes from './routes/test.routes.ts';
import supabaseRoutes from './routes/supabase.routes.ts';
import { getDb } from './db/database.ts';

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  // Initialize DB and initial seed if local
  getDb().catch((err) => {
    console.error('[Database] Local database init check:', err);
  });

  // Health check API
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // User-Only API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/schedule', scheduleRoutes);
  app.use('/api/salary', salaryRoutes);
  app.use('/api/late', lateRoutes);
  app.use('/api/audit-logs', auditRoutes);
  app.use('/api/tests', testRoutes);
  app.use('/api/supabase', supabaseRoutes);

  return app;
}
