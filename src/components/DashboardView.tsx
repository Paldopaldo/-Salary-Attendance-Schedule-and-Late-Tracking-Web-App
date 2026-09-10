import React, { useState, useEffect } from 'react';
import {
  Clock,
  Banknote,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Timer,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
} from 'lucide-react';
import { UserDashboardData, AttendanceRecord } from '../types.ts';
import { apiRequest } from '../lib/api.ts';
import { CheckInOutWidget } from './CheckInOutWidget.tsx';

interface DashboardViewProps {
  onNavigateToAttendance?: () => void;
  onNavigateToLate?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigateToAttendance,
  onNavigateToLate,
}) => {
  const [data, setData] = useState<UserDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    try {
      const res = await apiRequest<UserDashboardData>('/dashboard');
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <span>Loading your personalized dashboard...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-sm">
          Failed to load dashboard: {error}
        </div>
      </div>
    );
  }

  const { user, today, weekly, lateSummary, recentAttendance } = data;

  return (
    <div id="dashboard-view" className="space-y-6">
      {/* Top Banner / Welcome */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Welcome back, {user.fullName}
          </h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            Your personal salary, attendance, schedule, and late tracking dashboard.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <ShieldCheck className="w-3.5 h-3.5" />
            Standard Rate: ₱100/hr
          </span>
        </div>
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Today's Hours */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-neutral-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Today's Hours</span>
            <Clock className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-neutral-900">
              {today.regularHours}
            </span>
            <span className="text-sm text-neutral-500 font-mono">/ 10.0 hrs</span>
          </div>
          <div className="w-full bg-neutral-100 rounded-full h-1.5 mt-3 overflow-hidden">
            <div
              className={`h-1.5 rounded-full ${
                today.regularHours >= 10.0 ? 'bg-amber-500' : 'bg-indigo-600'
              }`}
              style={{ width: `${Math.min(100, (today.regularHours / 10.0) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            Max 10 regular hours per day
          </p>
        </div>

        {/* Card 2: Today's Salary */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-neutral-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Today's Salary</span>
            <Banknote className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono text-emerald-700">
              ₱{today.dailySalary.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="mt-3 text-xs text-neutral-500 flex items-center justify-between">
            <span>Rate: ₱100.00/hr</span>
            <span className="font-semibold text-neutral-700">Max ₱1,000/day</span>
          </div>
        </div>

        {/* Card 3: Weekly Working Hours */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-neutral-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Weekly Quota</span>
            <TrendingUp className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-neutral-900">
              {weekly.hoursWorked}
            </span>
            <span className="text-sm text-neutral-500 font-mono">/ 30.0 hrs</span>
          </div>
          <div className="w-full bg-neutral-100 rounded-full h-1.5 mt-3 overflow-hidden">
            <div
              className={`h-1.5 rounded-full ${
                weekly.percentageUsed >= 100
                  ? 'bg-rose-500'
                  : weekly.percentageUsed >= 80
                  ? 'bg-amber-500'
                  : 'bg-indigo-600'
              }`}
              style={{ width: `${weekly.percentageUsed}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500 mt-2 flex justify-between">
            <span>{weekly.remainingHours} hrs remaining</span>
            <span className="font-medium text-indigo-600">₱{weekly.weeklySalary}</span>
          </p>
        </div>

        {/* Card 4: Late Today & Month */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-neutral-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Arrival Status</span>
            <Timer className="w-4 h-4 text-amber-600" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-lg font-bold ${
                today.lateMinutes > 0 ? 'text-amber-700' : 'text-emerald-700'
              }`}
            >
              {today.lateMinutes > 0 ? `${today.lateMinutes} min late` : 'On Time'}
            </span>
          </div>
          <div className="mt-3 pt-2 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500">
            <span>This Month:</span>
            <span className="font-medium text-neutral-800">
              {lateSummary.lateMinutesThisMonth} mins ({lateSummary.lateDaysThisMonth} days)
            </span>
          </div>
        </div>
      </div>

      {/* Central Check In / Check Out Terminal */}
      <CheckInOutWidget onAttendanceChange={fetchDashboardData} />

      {/* Two Column Layout: Late Summary & Recent Shift History */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Late Tracking Summary Card */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-neutral-900 flex items-center gap-2">
              <Timer className="w-4 h-4 text-indigo-600" />
              Late Summary
            </h3>
            {onNavigateToLate && (
              <button
                type="button"
                onClick={onNavigateToLate}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 cursor-pointer"
              >
                View History <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-xs text-neutral-600">
            Scheduled start is <strong>7:00 AM</strong>. Late minutes are calculated strictly based on arrival time after 7:00 AM.
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-neutral-100 text-sm">
              <span className="text-neutral-600">Late Minutes Today</span>
              <span className="font-mono font-semibold text-neutral-900">
                {today.lateMinutes} mins
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-neutral-100 text-sm">
              <span className="text-neutral-600">Late Minutes This Week</span>
              <span className="font-mono font-semibold text-neutral-900">
                {lateSummary.lateMinutesThisWeek} mins
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-neutral-100 text-sm">
              <span className="text-neutral-600">Late Minutes This Month</span>
              <span className="font-mono font-semibold text-amber-700">
                {lateSummary.lateMinutesThisMonth} mins
              </span>
            </div>
            <div className="flex items-center justify-between py-2 text-sm">
              <span className="text-neutral-600">Late Days This Month</span>
              <span className="font-mono font-semibold text-amber-700">
                {lateSummary.lateDaysThisMonth} days
              </span>
            </div>
          </div>
        </div>

        {/* Right: Recent Attendance Records */}
        <div className="lg:col-span-2 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-neutral-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-600" />
              Recent Attendance History
            </h3>
            {onNavigateToAttendance && (
              <button
                type="button"
                onClick={onNavigateToAttendance}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 cursor-pointer"
              >
                Full Attendance <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {recentAttendance.length === 0 ? (
            <div className="py-8 text-center text-sm text-neutral-500">
              No recent attendance records found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                    <th className="pb-3">Date</th>
                    <th className="pb-3">Time In</th>
                    <th className="pb-3">Time Out</th>
                    <th className="pb-3">Late</th>
                    <th className="pb-3">Hours</th>
                    <th className="pb-3">Salary</th>
                    <th className="pb-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {recentAttendance.map((rec) => (
                    <tr key={rec.id} className="hover:bg-neutral-50/80 transition-colors">
                      <td className="py-2.5 font-medium text-neutral-900 font-mono text-xs">
                        {rec.workDate}
                      </td>
                      <td className="py-2.5 text-neutral-600 text-xs">{rec.timeIn}</td>
                      <td className="py-2.5 text-neutral-600 text-xs">{rec.timeOut || '—'}</td>
                      <td className="py-2.5 text-xs">
                        {rec.lateMinutes > 0 ? (
                          <span className="font-semibold text-amber-600">
                            {rec.lateMinutes}m
                          </span>
                        ) : (
                          <span className="text-emerald-600">0m</span>
                        )}
                      </td>
                      <td className="py-2.5 font-mono text-xs text-neutral-900 font-semibold">
                        {rec.regularHours}h
                      </td>
                      <td className="py-2.5 font-mono text-xs font-semibold text-emerald-700">
                        ₱{rec.salary}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                            rec.attendanceStatus === 'ON_TIME'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : rec.attendanceStatus === 'LATE'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-neutral-100 text-neutral-700'
                          }`}
                        >
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
    </div>
  );
};
