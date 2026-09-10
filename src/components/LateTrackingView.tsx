import React, { useState, useEffect } from 'react';
import { Timer, AlertCircle, Clock, Calendar, CheckCircle2, ShieldAlert } from 'lucide-react';
import { LateSummary } from '../types.ts';
import { apiRequest } from '../lib/api.ts';
import { formatTo12Hour } from '../utils/timezone.ts';

export const LateTrackingView: React.FC = () => {
  const [summary, setSummary] = useState<LateSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLateData = async () => {
      try {
        const data = await apiRequest<LateSummary>('/late/summary');
        setSummary(data);
      } catch (err) {
        console.error('Failed to load late summary:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchLateData();
  }, []);

  if (loading) {
    return (
      <div className="flex h-80 items-center justify-center">
        <div className="text-sm text-neutral-500">Loading late arrival statistics...</div>
      </div>
    );
  }

  return (
    <div id="late-tracking-view" className="space-y-6">
      <div className="pb-2">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Late-Minute Tracking System
        </h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Automatic calculation of arrival tardiness based on the official <strong>7:00 AM</strong> scheduled start time.
        </p>
      </div>

      {/* Policy Card */}
      <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 leading-relaxed">
          <span className="font-bold text-amber-950">How Late Tracking Works: </span>
          Scheduled start time is <span className="font-semibold">7:00 AM</span> in Asia/Manila. Any arrival after 7:00 AM calculates late minutes (<code className="bg-amber-100/80 px-1 py-0.5 rounded font-mono">Actual Time In - 7:00 AM</code>). Arrivals at or before 7:00 AM are marked <span className="font-semibold text-emerald-800">ON TIME</span> (0 late minutes). Late minutes are tracked for punctuality records and are kept distinct from approved working hours.
        </div>
      </div>

      {/* 4 Summary Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
            Late Minutes Today
          </div>
          <div className="text-2xl font-bold font-mono text-neutral-900 mt-2">
            {summary?.lateMinutesToday ?? 0} mins
          </div>
          <p className="text-xs text-neutral-500 mt-1">Based on today's punch in</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
            Late Minutes This Week
          </div>
          <div className="text-2xl font-bold font-mono text-neutral-900 mt-2">
            {summary?.lateMinutesThisWeek ?? 0} mins
          </div>
          <p className="text-xs text-neutral-500 mt-1">Monday to Sunday total</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
            Late Minutes This Month
          </div>
          <div className="text-2xl font-bold font-mono text-amber-700 mt-2">
            {summary?.lateMinutesThisMonth ?? 0} mins
          </div>
          <p className="text-xs text-neutral-500 mt-1">Current calendar month</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
            Late Days This Month
          </div>
          <div className="text-2xl font-bold font-mono text-amber-700 mt-2">
            {summary?.lateDaysThisMonth ?? 0} days
          </div>
          <p className="text-xs text-neutral-500 mt-1">Days with &gt; 0 min late</p>
        </div>
      </div>

      {/* Historical Late Arrivals Table */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
            <Timer className="w-4 h-4 text-indigo-600" />
            Late Arrival Records History
          </h2>
          <span className="text-xs text-neutral-500">
            {summary?.records?.length || 0} incidents recorded
          </span>
        </div>

        {!summary?.records || summary.records.length === 0 ? (
          <div className="p-12 text-center text-sm text-neutral-500 flex flex-col items-center gap-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            <span className="font-medium text-neutral-800">Clean punctuality record!</span>
            <span>No late arrival incidents recorded for your account.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Scheduled Start</th>
                  <th className="py-3 px-4">Actual Punch In</th>
                  <th className="py-3 px-4">Late Duration</th>
                  <th className="py-3 px-4">Punctuality Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {summary.records.map((rec) => (
                  <tr key={rec.id} className="hover:bg-neutral-50/70 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-neutral-900 text-xs">
                      {rec.workDate}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-neutral-600">
                      {formatTo12Hour(rec.scheduledStart)}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono font-medium text-neutral-900">
                      {formatTo12Hour(rec.timeIn)}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <span className="font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                        {rec.lateMinutes} minutes late
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">
                        {rec.attendanceStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
