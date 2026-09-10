import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  Banknote,
  Filter,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  PlusCircle,
  X,
  Check,
  Coffee,
  AlertCircle,
} from 'lucide-react';
import { AttendanceRecord } from '../types.ts';
import { apiRequest } from '../lib/api.ts';
import { getDayOfWeek, formatTo12Hour, calculateLateMinutes } from '../utils/timezone.ts';

export const AttendanceView: React.FC = () => {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [filter, setFilter] = useState<'today' | 'week' | 'month' | 'all'>('month');
  const [loading, setLoading] = useState(true);

  // Form toggle state
  const [showLogForm, setShowLogForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Form input states
  const [workDate, setWorkDate] = useState(() => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  });
  const [timeIn, setTimeIn] = useState('07:00');
  const [timeOut, setTimeOut] = useState('17:00');
  const [breakHours, setBreakHours] = useState(1.0);
  const [notes, setNotes] = useState('');

  const fetchRecords = async (currentFilter: string) => {
    setLoading(true);
    try {
      const data = await apiRequest<AttendanceRecord[]>(`/attendance/history?filter=${currentFilter}`);
      setRecords(data);
    } catch (err) {
      console.error('Failed to load attendance:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords(filter);
  }, [filter]);

  const totalRegularHours = records.reduce((sum, r) => sum + (r.regularHours || 0), 0);
  const totalSalary = records.reduce((sum, r) => sum + (r.salary || 0), 0);
  const totalLateMinutes = records.reduce((sum, r) => sum + (r.lateMinutes || 0), 0);

  // Calculate live preview for the form
  const getPreview = () => {
    if (!timeIn || !timeOut) return null;
    const [inH, inM] = timeIn.split(':').map(Number);
    const [outH, outM] = timeOut.split(':').map(Number);
    const elapsedMinutes = outH * 60 + outM - (inH * 60 + inM);

    if (elapsedMinutes <= 0) {
      return { error: 'Time Out must be after Time In' };
    }

    const grossHours = Math.round((elapsedMinutes / 60) * 100) / 100;
    if (breakHours >= grossHours) {
      return { error: 'Break duration cannot exceed or equal shift duration' };
    }

    const netHours = Math.max(0, Math.round((grossHours - breakHours) * 100) / 100);
    const regularHours = Math.min(10.0, netHours);
    const salary = regularHours * 100.0;
    const lateMins = calculateLateMinutes(timeIn, '07:00');

    return {
      grossHours,
      netHours,
      regularHours,
      salary,
      lateMinutes: lateMins,
    };
  };

  const preview = getPreview();

  const handleCreateAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setSubmitting(true);

    try {
      const res = await apiRequest<{ message: string }>('/attendance/log-entry', {
        method: 'POST',
        body: JSON.stringify({
          workDate,
          timeIn,
          timeOut,
          breakHours,
          notes: notes.trim() || undefined,
        }),
      });

      setFormSuccess(res.message);
      setNotes('');
      await fetchRecords(filter);
      setTimeout(() => {
        setShowLogForm(false);
        setFormSuccess(null);
      }, 1500);
    } catch (err: any) {
      setFormError(err.message || 'Failed to submit attendance entry');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div id="attendance-view" className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Attendance History & Punch Records
          </h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            View your shifts, punch logs, late minutes, and daily regular earnings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Form Toggle Button */}
          <button
            id="btn-toggle-log-attendance"
            type="button"
            onClick={() => setShowLogForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors cursor-pointer"
          >
            {showLogForm ? <X className="w-4 h-4" /> : <PlusCircle className="w-4 h-4" />}
            {showLogForm ? 'Close Entry Form' : 'Log Attendance Entry'}
          </button>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-lg border border-neutral-200 text-xs">
            {[
              { id: 'today', label: 'Today' },
              { id: 'week', label: 'This Week' },
              { id: 'month', label: 'This Month' },
              { id: 'all', label: 'All Records' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id as any)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                  filter === item.id
                    ? 'bg-white text-neutral-900 shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Expandable Log Attendance Entry Form */}
      {showLogForm && (
        <form
          onSubmit={handleCreateAttendance}
          className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-5 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between border-b border-indigo-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-neutral-900 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-600" />
                Input Types for Log Attendance & Log Out Attendance
              </h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                Specify work date, time in, time out, and break duration.
              </p>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
              Manual Form
            </span>
          </div>

          {formError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{formError}</span>
            </div>
          )}

          {formSuccess && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{formSuccess}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Input Type Date */}
            <div>
              <label htmlFor="form-work-date" className="block text-xs font-semibold text-neutral-700 mb-1">
                Work Date
              </label>
              <input
                id="form-work-date"
                type="date"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                required
                className="w-full bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs font-mono text-neutral-900 shadow-sm focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Input Type Time In */}
            <div>
              <label htmlFor="form-time-in" className="block text-xs font-semibold text-neutral-700 mb-1">
                Log Attendance (Time In)
              </label>
              <input
                id="form-time-in"
                type="time"
                step="60"
                value={timeIn}
                onChange={(e) => setTimeIn(e.target.value)}
                required
                className="w-full bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs font-mono text-neutral-900 shadow-sm focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Input Type Time Out */}
            <div>
              <label htmlFor="form-time-out" className="block text-xs font-semibold text-neutral-700 mb-1">
                Log Out Attendance (Time Out)
              </label>
              <input
                id="form-time-out"
                type="time"
                step="60"
                value={timeOut}
                onChange={(e) => setTimeOut(e.target.value)}
                required
                className="w-full bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs font-mono text-neutral-900 shadow-sm focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Input Type Break Hours */}
            <div>
              <label htmlFor="form-break" className="block text-xs font-semibold text-neutral-700 mb-1">
                Break Hours
              </label>
              <input
                id="form-break"
                type="number"
                step="0.5"
                min="0"
                max="4"
                value={breakHours}
                onChange={(e) => setBreakHours(parseFloat(e.target.value) || 0)}
                required
                className="w-full bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs font-mono text-neutral-900 shadow-sm focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Live Preview Bar */}
          {preview && (
            <div className="p-3 bg-white border border-indigo-100 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
              {'error' in preview ? (
                <span className="text-rose-600 font-medium">{preview.error}</span>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <span>
                      Duration:{' '}
                      <strong className="font-mono text-neutral-800">
                        {preview.grossHours}h - {breakHours}h = {preview.netHours}h
                      </strong>
                    </span>
                    <span>
                      Regular:{' '}
                      <strong className="font-mono text-indigo-700">
                        {preview.regularHours}h (Max 10h)
                      </strong>
                    </span>
                    <span>
                      Salary:{' '}
                      <strong className="font-mono text-emerald-700 font-bold">
                        ₱{preview.salary.toFixed(2)}
                      </strong>
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      preview.lateMinutes > 0
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {preview.lateMinutes > 0
                      ? `${preview.lateMinutes} mins late (7:00 AM start)`
                      : 'On Time (<= 7:00 AM)'}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Notes Input */}
          <div>
            <label htmlFor="form-notes" className="block text-xs font-semibold text-neutral-700 mb-1">
              Notes (Optional)
            </label>
            <input
              id="form-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Project meetings, sprint tasks..."
              className="w-full text-xs rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-neutral-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowLogForm(false)}
              className="px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 cursor-pointer"
            >
              Cancel
            </button>
            <button
              id="btn-submit-attendance-entry"
              type="submit"
              disabled={submitting || (preview && 'error' in preview)}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save Attendance Record'}
            </button>
          </div>
        </form>
      )}

      {/* Aggregate Summary Metrics for Selected Filter */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
            Total Regular Hours
          </div>
          <div className="text-2xl font-bold font-mono text-neutral-900 mt-1">
            {totalRegularHours.toFixed(1)} hrs
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">Approved regular work hours</div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
            Total Salary Earned
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">
            ₱{totalSalary.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">Calculated at ₱100.00/hr</div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
            Total Late Minutes
          </div>
          <div className="text-2xl font-bold font-mono text-amber-700 mt-1">
            {totalLateMinutes} mins
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">Tracked against 7:00 AM start</div>
        </div>
      </div>

      {/* Attendance Table */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-indigo-600" />
            Attendance Records ({records.length})
          </h2>
          <span className="text-xs text-neutral-500">
            Daily Limit: 10 hrs (₱1,000) · Weekly Limit: 30 hrs (₱3,000)
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-neutral-500">Loading records...</div>
        ) : records.length === 0 ? (
          <div className="p-12 text-center text-sm text-neutral-500">
            No attendance records found for this period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Date & Day</th>
                  <th className="py-3 px-4">Scheduled</th>
                  <th className="py-3 px-4">Time In</th>
                  <th className="py-3 px-4">Time Out</th>
                  <th className="py-3 px-4">Break</th>
                  <th className="py-3 px-4">Late</th>
                  <th className="py-3 px-4">Regular Hours</th>
                  <th className="py-3 px-4">Daily Salary</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {records.map((r) => {
                  const dayName = getDayOfWeek(r.workDate);
                  return (
                    <tr key={r.id} className="hover:bg-neutral-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-neutral-900 font-mono text-xs">
                          {r.workDate}
                        </div>
                        <div className="text-xs text-neutral-500">{dayName}</div>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-neutral-600">
                        {r.scheduledStart} – {r.scheduledEnd}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono font-medium text-neutral-900">
                        {formatTo12Hour(r.timeIn)}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-neutral-700">
                        {r.timeOut ? (
                          formatTo12Hour(r.timeOut)
                        ) : (
                          <span className="text-amber-600 font-medium">In Progress</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-neutral-600">{r.breakHours} hr</td>
                      <td className="py-3 px-4 text-xs">
                        {r.lateMinutes > 0 ? (
                          <span className="font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                            {r.lateMinutes} min late
                          </span>
                        ) : (
                          <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-medium">
                            On Time
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono font-bold text-neutral-900">
                        {r.regularHours} hrs
                        {r.overtimeHours > 0 && (
                          <span className="ml-1 text-[11px] text-neutral-400 font-normal">
                            (+{r.overtimeHours}h OT)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono font-bold text-emerald-700">
                        ₱{r.salary.toFixed(2)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            r.attendanceStatus === 'ON_TIME'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : r.attendanceStatus === 'LATE'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-neutral-100 text-neutral-700 border border-neutral-200'
                          }`}
                        >
                          {r.attendanceStatus}
                        </span>
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
