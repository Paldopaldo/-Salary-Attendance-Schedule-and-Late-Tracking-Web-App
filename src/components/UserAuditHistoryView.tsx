import React, { useState, useEffect } from 'react';
import { ShieldCheck, History, Laptop, Globe, CheckCircle2, Lock } from 'lucide-react';
import { AuditLogEntry } from '../types.ts';
import { apiRequest } from '../lib/api.ts';

export const UserAuditHistoryView: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const data = await apiRequest<AuditLogEntry[]>('/audit-logs');
        setLogs(data);
      } catch (err) {
        console.error('Failed to load audit logs:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, []);

  if (loading) {
    return (
      <div className="flex h-80 items-center justify-center">
        <div className="text-sm text-neutral-500">Loading your personal security audit logs...</div>
      </div>
    );
  }

  return (
    <div id="user-audit-view" className="space-y-6">
      <div className="pb-2">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          My Security & Activity Audit Trail
        </h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Strictly scoped to your personal account. Every login, punch in, punch out, and profile change is immutably logged.
        </p>
      </div>

      <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-xl flex items-start gap-3">
        <Lock className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
        <div className="text-xs text-neutral-600 leading-relaxed">
          <span className="font-bold text-neutral-900">User Data Isolation Guarantee: </span>
          Under our user-only architecture, no administrator or third-party can access your audit records. All queries run against <code className="bg-neutral-200 px-1 py-0.5 rounded font-mono">WHERE user_id = :authenticated_user</code> on the server.
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" />
            Activity Log Entries ({logs.length})
          </h2>
          <span className="text-xs text-neutral-500">Most recent actions first</span>
        </div>

        {logs.length === 0 ? (
          <div className="p-8 text-center text-sm text-neutral-500">
            No audit logs recorded for your account yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-xs font-semibold text-neutral-600 uppercase">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action Event</th>
                  <th className="py-3 px-4">Details & Description</th>
                  <th className="py-3 px-4">Client IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-xs">
                {logs.map((log) => {
                  const isCheckIn = log.action === 'CHECK_IN';
                  const isCheckOut = log.action === 'CHECK_OUT';
                  const isLogin = log.action === 'LOGIN';
                  const isSecurity = log.action.includes('PASSWORD') || log.action.includes('REGISTER');

                  return (
                    <tr key={log.id} className="hover:bg-neutral-50/70">
                      <td className="py-3 px-4 font-mono text-neutral-500 whitespace-nowrap">
                        {log.timestamp}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                            isCheckIn
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : isCheckOut
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                              : isLogin
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : isSecurity
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : 'bg-neutral-100 text-neutral-700'
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium text-neutral-900">
                        {log.description}
                      </td>
                      <td className="py-3 px-4 font-mono text-neutral-500">
                        {log.ipAddress || '127.0.0.1'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
