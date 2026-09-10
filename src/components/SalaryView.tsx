import React, { useState, useEffect } from 'react';
import { Banknote, Calendar, TrendingUp, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import { WeeklySalarySummary } from '../types.ts';
import { apiRequest } from '../lib/api.ts';
import { getDayOfWeek, formatTo12Hour } from '../utils/timezone.ts';

export const SalaryView: React.FC = () => {
  const [weekly, setWeekly] = useState<WeeklySalarySummary | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSalaryData = async () => {
      try {
        const [wData, hData] = await Promise.all([
          apiRequest<WeeklySalarySummary>('/salary'),
          apiRequest<any[]>('/salary/history'),
        ]);
        setWeekly(wData);
        setHistory(hData);
      } catch (err) {
        console.error('Failed to load salary:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSalaryData();
  }, []);

  if (loading) {
    return (
      <div className="flex h-80 items-center justify-center">
        <div className="text-sm text-neutral-500">Loading salary calculations...</div>
      </div>
    );
  }

  const hoursWorked = weekly?.totalWeeklyHours ?? 0;
  const maxHours = 30.0;
  const remainingHours = weekly?.remainingWeeklyHours ?? 30.0;
  const weeklyEarnings = weekly?.weeklySalary ?? 0;
  const percentage = Math.min(100, (hoursWorked / maxHours) * 100);

  return (
    <div id="salary-view" className="space-y-6">
      <div className="pb-2">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Salary & Weekly Earnings
        </h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Salary calculated strictly at <strong>₱100/hour</strong>, capped at <strong>30 hours (₱3,000)</strong> per calendar week.
        </p>
      </div>

      {/* Weekly Quota Card */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-neutral-100">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
              Current Weekly Period
            </div>
            <h2 className="text-lg font-bold text-neutral-900 mt-0.5">
              {weekly?.weekLabel || 'Current Week'}
            </h2>
            <div className="text-xs text-neutral-500 mt-0.5">
              Monday 00:00:00 to Sunday 23:59:59 (Asia/Manila)
            </div>
          </div>

          <div className="text-left sm:text-right">
            <div className="text-xs text-neutral-500 uppercase font-medium">Gross Weekly Salary</div>
            <div className="text-3xl font-mono font-bold text-emerald-700">
              ₱{weeklyEarnings.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-neutral-500">Max regular salary: ₱3,000.00</div>
          </div>
        </div>

        {/* 30-Hour Quota Visual Bar */}
        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-neutral-700">
              Regular Hours: <strong className="font-mono text-neutral-900">{hoursWorked}</strong> / 30.0 hrs
            </span>
            <span className={remainingHours <= 0 ? 'text-rose-600 font-bold' : 'text-indigo-600'}>
              {remainingHours <= 0 ? 'Weekly Quota Fully Exhausted' : `${remainingHours} hrs remaining`}
            </span>
          </div>

          <div className="w-full bg-neutral-100 rounded-full h-3 overflow-hidden">
            <div
              className={`h-3 rounded-full transition-all ${
                hoursWorked >= 30.0
                  ? 'bg-rose-500'
                  : hoursWorked >= 24.0
                  ? 'bg-amber-500'
                  : 'bg-emerald-600'
              }`}
              style={{ width: `${percentage}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono">
            <span>0.0 hrs (₱0)</span>
            <span>15.0 hrs (₱1,500)</span>
            <span>30.0 hrs (₱3,000 MAX)</span>
          </div>
        </div>
      </div>

      {/* Itemized Shifts for the Current Week */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-indigo-600" />
            Shifts in Current Week ({weekly?.records?.length || 0})
          </h3>
          <span className="text-xs font-mono text-neutral-500">
            {weekly?.weekStart} → {weekly?.weekEnd}
          </span>
        </div>

        {!weekly?.records || weekly.records.length === 0 ? (
          <div className="p-8 text-center text-sm text-neutral-500">
            No completed shifts recorded yet for this week.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-xs font-semibold text-neutral-600 uppercase">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Day</th>
                  <th className="py-3 px-4">Time In</th>
                  <th className="py-3 px-4">Time Out</th>
                  <th className="py-3 px-4">Break</th>
                  <th className="py-3 px-4">Hours</th>
                  <th className="py-3 px-4">Rate</th>
                  <th className="py-3 px-4">Daily Salary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 font-mono text-xs">
                {weekly.records.map((r) => (
                  <tr key={r.id} className="hover:bg-neutral-50">
                    <td className="py-3 px-4 font-semibold text-neutral-900">{r.workDate}</td>
                    <td className="py-3 px-4 text-neutral-600 font-sans">{getDayOfWeek(r.workDate)}</td>
                    <td className="py-3 px-4 text-neutral-800">{formatTo12Hour(r.timeIn)}</td>
                    <td className="py-3 px-4 text-neutral-800">{r.timeOut ? formatTo12Hour(r.timeOut) : '—'}</td>
                    <td className="py-3 px-4 text-neutral-600">{r.breakHours}h</td>
                    <td className="py-3 px-4 font-bold text-neutral-900">{r.regularHours}h</td>
                    <td className="py-3 px-4 text-neutral-600">₱{r.hourlyRate}/hr</td>
                    <td className="py-3 px-4 font-bold text-emerald-700">₱{r.salary.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* All-time Salary History */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
            <Banknote className="w-4 h-4 text-indigo-600" />
            Historical Salary Earnings
          </h3>
          <span className="text-xs text-neutral-500">All recorded shifts</span>
        </div>

        {history.length === 0 ? (
          <div className="p-8 text-center text-sm text-neutral-500">
            No historical salary earnings recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-xs font-semibold text-neutral-600 uppercase">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Day</th>
                  <th className="py-3 px-4">Regular Hours</th>
                  <th className="py-3 px-4">Hourly Rate</th>
                  <th className="py-3 px-4">Salary Earned</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 font-mono text-xs">
                {history.map((h, i) => (
                  <tr key={i} className="hover:bg-neutral-50">
                    <td className="py-3 px-4 font-semibold text-neutral-900">{h.workDate}</td>
                    <td className="py-3 px-4 font-sans text-neutral-600">{getDayOfWeek(h.workDate)}</td>
                    <td className="py-3 px-4 font-bold text-neutral-900">{h.regularHours}h</td>
                    <td className="py-3 px-4 text-neutral-600">₱{h.hourlyRate}/hr</td>
                    <td className="py-3 px-4 font-bold text-emerald-700">₱{h.salary.toFixed(2)}</td>
                    <td className="py-3 px-4 font-sans">
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {h.attendanceStatus}
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
