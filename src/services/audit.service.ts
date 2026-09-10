import { getDb, withTransaction } from '../db/database.ts';
import { saveAuditLogToSupabase } from '../db/supabase.ts';
import { AuditLogEntry } from '../types.ts';

export class AuditService {
  /**
   * Appends an immutable audit log entry for a user action
   */
  static async logAction(
    userId: string,
    action: string,
    description: string,
    ipAddress: string = '127.0.0.1',
    userAgent: string = 'App-Client'
  ): Promise<void> {
    try {
      const db = await getDb();
      const id = `aud-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      db.run(
        `INSERT INTO audit_logs (id, user_id, action, description, timestamp, ip_address, user_agent)
         VALUES (?, ?, ?, ?, datetime('now'), ?, ?);`,
        [id, userId, action, description, ipAddress, userAgent]
      );

      // Persist directly to Supabase
      saveAuditLogToSupabase({
        id,
        userId,
        action,
        description,
        ipAddress,
        userAgent,
      }).catch((e) => console.warn('[Supabase] audit log save:', e));
    } catch (err) {
      console.error('Failed to write audit log:', err);
    }
  }

  /**
   * Retrieves audit logs for the authenticated user only
   */
  static async getUserAuditLogs(userId: string, limit: number = 50): Promise<AuditLogEntry[]> {
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT id, user_id, action, description, timestamp, ip_address, user_agent
      FROM audit_logs
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT ?;
    `);
    stmt.bind([userId, limit]);

    const logs: AuditLogEntry[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      logs.push({
        id: row.id as string,
        userId: row.user_id as string,
        action: row.action as string,
        description: row.description as string,
        timestamp: row.timestamp as string,
        ipAddress: row.ip_address as string,
        userAgent: row.user_agent as string,
      });
    }
    stmt.free();

    return logs;
  }
}
