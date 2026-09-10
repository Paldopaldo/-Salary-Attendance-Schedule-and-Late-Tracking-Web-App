import React, { useState, useEffect } from 'react';
import {
  Clock,
  LogIn,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Coffee,
  Calendar,
  Sparkles,
  Timer,
  RotateCcw,
  Check,
  FileSpreadsheet,
} from 'lucide-react';
import { TodayAttendanceInfo } from '../types.ts';
import { apiRequest } from '../lib/api.ts';
import { calculateLateMinutes, formatTo12Hour } from '../utils/timezone.ts';

interface CheckInOutWidgetProps {
  onAttendanceChange?: () => void;
}

export const CheckInOutWidget: React.FC<CheckInOutWidgetProps> = ({ onAttendanceChange }) => {
  const [todayInfo, setTodayInfo] = useState<TodayAttendanceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Widget view mode: 'terminal' (step-by-step) vs 'direct' (both in & out input types)
  const [mode, setMode] = useState<'terminal' | 'direct'>('terminal');

  // Manila live ticking clock
  const [manilaTime, setManilaTime] = useState<string>('');
  const [manilaDate, setManilaDate] = useState<string>('');
  const [current24Time, setCurrent24Time] = useState<string>('07:00');
  const [currentDateStr, setCurrentDateStr] = useState<string>('');
  const [elapsedDuration, setElapsedDuration] = useState<string>('00:00:00');

  // Log Attendance (Check-in) input states
  const [logInDate, setLogInDate] = useState<string>('');
  const [logInTime, setLogInTime] = useState<string>('07:00');
  const [logInNotes, setLogInNotes] = useState<string>('');

  // Log Out Attendance (Check-out) input states
  const [logOutDate, setLogOutDate] = useState<string>('');
  const [logOutTime, setLogOutTime] = useState<string>('17:00');
  const [breakHours, setBreakHours] = useState<number>(1.0);
  const [logOutNotes, setLogOutNotes] = useState<string>('');

  // Direct Unified Attendance input states
  const [directDate, setDirectDate] = useState<string>('');
  const [directTimeIn, setDirectTimeIn] = useState<string>('07:00');
  const [directTimeOut, setDirectTimeOut] = useState<string>('17:00');
  const [directBreak, setDirectBreak] = useState<number>(1.0);
  const [directNotes, setDirectNotes] = useState<string>('');

  const fetchTodayStatus = async () => {
    try {
      const data = await apiRequest<TodayAttendanceInfo>('/attendance/today');
      setTodayInfo(data);
    } catch (err: any) {
      console.error('Failed to load today status:', err);
    }
  };

  useEffect(() => {
    fetchTodayStatus();
  }, []);

  // Live ticking clock in Asia/Manila timezone
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
      const dateStr = now.toLocaleDateString('en-US', {
        timeZone: 'Asia/Manila',
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      setManilaTime(timeStr);
      setManilaDate(dateStr);

      // YYYY-MM-DD in Manila
      const dParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);
      setCurrentDateStr(dParts);

      // HH:mm in Manila
      const tParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now);
      setCurrent24Time(tParts);

      // Default initial states if blank
      setLogInDate((prev) => prev || dParts);
      setLogOutDate((prev) => prev || dParts);
      setDirectDate((prev) => prev || dParts);

      // Elapsed duration if checked in
      if (todayInfo?.status === 'CHECKED_IN' && todayInfo.timeIn) {
        const [inH, inM] = todayInfo.timeIn.split(':').map(Number);
        const [curH, curM] = tParts.split(':').map(Number);
        const elapsedMinutes = curH * 60 + curM - (inH * 60 + inM);
        if (elapsedMinutes >= 0) {
          const totalSecs = elapsedMinutes * 60 + now.getSeconds();
          const hrs = Math.floor(totalSecs / 3600);
          const mins = Math.floor((totalSecs % 3600) / 60);
          const secs = totalSecs % 60;
          setElapsedDuration(
            `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
          );
        }
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [todayInfo]);

  // Set default times once Manila time loads
  useEffect(() => {
    if (current24Time && logInTime === '07:00' && !todayInfo?.timeIn) {
      setLogInTime(current24Time);
    }
    if (current24Time && todayInfo?.status === 'CHECKED_IN') {
      setLogOutTime(current24Time);
    }
  }, [current24Time, todayInfo?.status]);

  // Dynamic late calculation for logInTime input
  const scheduledStart = todayInfo?.scheduledStart || '07:00';
  const computedLateMinutes = calculateLateMinutes(logInTime, scheduledStart);

  // Dynamic shift calculation for logOutTime input
  const previewShiftCalculation = () => {
    const timeIn = todayInfo?.timeIn || '07:00';
    const [inH, inM] = timeIn.split(':').map(Number);
    const [outH, outM] = logOutTime.split(':').map(Number);
    const elapsedMinutes = outH * 60 + outM - (inH * 60 + inM);

    if (elapsedMinutes <= 0) {
      return { isValid: false, message: 'Time Out must be after Time In' };
    }

    const grossHours = Math.round((elapsedMinutes / 60) * 100) / 100;
    if (breakHours >= grossHours) {
      return { isValid: false, message: 'Break duration cannot exceed shift duration' };
    }

    const netHours = Math.max(0, Math.round((grossHours - breakHours) * 100) / 100);
    const regularHours = Math.min(10.0, netHours);
    const overtimeHours = Math.max(0, Math.round((netHours - regularHours) * 100) / 100);
    const salary = regularHours * 100.0;

    return {
      isValid: true,
      grossHours,
      breakHours,
      netHours,
      regularHours,
      overtimeHours,
      salary,
    };
  };

  // Dynamic calculation for direct unified logger
  const previewDirectCalculation = () => {
    const [inH, inM] = directTimeIn.split(':').map(Number);
    const [outH, outM] = directTimeOut.split(':').map(Number);
    const elapsedMinutes = outH * 60 + outM - (inH * 60 + inM);

    if (elapsedMinutes <= 0) {
      return { isValid: false, message: 'Log Out time must be after Log Attendance time' };
    }

    const grossHours = Math.round((elapsedMinutes / 60) * 100) / 100;
    if (directBreak >= grossHours) {
      return { isValid: false, message: 'Break hours cannot exceed shift duration' };
    }

    const netHours = Math.max(0, Math.round((grossHours - directBreak) * 100) / 100);
    const regularHours = Math.min(10.0, netHours);
    const salary = regularHours * 100.0;
    const lateMins = calculateLateMinutes(directTimeIn, '07:00');

    return {
      isValid: true,
      grossHours,
      netHours,
      regularHours,
      salary,
      lateMinutes: lateMins,
    };
  };

  // Handler: Log Attendance (Check-in)
  const handleLogAttendance = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const res = await apiRequest<{ message: string }>('/attendance/check-in', {
        method: 'POST',
        body: JSON.stringify({
          customTimeIn: logInTime,
          customWorkDate: logInDate,
          notes: logInNotes.trim() || undefined,
        }),
      });

      setSuccessMsg(res.message);
      setLogInNotes('');
      await fetchTodayStatus();
      if (onAttendanceChange) onAttendanceChange();
    } catch (err: any) {
      setError(err.message || 'Log attendance failed');
    } finally {
      setLoading(false);
    }
  };

  // Handler: Log Out Attendance (Check-out)
  const handleLogOutAttendance = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const res = await apiRequest<{ message: string }>('/attendance/check-out', {
        method: 'POST',
        body: JSON.stringify({
          customTimeOut: logOutTime,
          customWorkDate: logOutDate,
          breakHours,
          notes: logOutNotes.trim() || undefined,
        }),
      });

      setSuccessMsg(res.message);
      setLogOutNotes('');
      await fetchTodayStatus();
      if (onAttendanceChange) onAttendanceChange();
    } catch (err: any) {
      setError(err.message || 'Log out attendance failed');
    } finally {
      setLoading(false);
    }
  };

  // Handler: Submit Direct Unified Log (both in & out)
  const handleDirectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const res = await apiRequest<{ message: string }>('/attendance/log-entry', {
        method: 'POST',
        body: JSON.stringify({
          workDate: directDate,
          timeIn: directTimeIn,
          timeOut: directTimeOut,
          breakHours: directBreak,
          notes: directNotes.trim() || undefined,
        }),
      });

      setSuccessMsg(res.message);
      setDirectNotes('');
      await fetchTodayStatus();
      if (onAttendanceChange) onAttendanceChange();
    } catch (err: any) {
      setError(err.message || 'Failed to log attendance entry');
    } finally {
      setLoading(false);
    }
  };

  // Handler: Reset Today's Shift for testing/re-entry
  const handleResetToday = async () => {
    if (!confirm('Are you sure you want to clear today’s shift to re-log attendance?')) {
      return;
    }
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const res = await apiRequest<{ message: string }>('/attendance/reset-today', {
        method: 'POST',
        body: JSON.stringify({ date: currentDateStr }),
      });
      setSuccessMsg(res.message);
      await fetchTodayStatus();
      if (onAttendanceChange) onAttendanceChange();
    } catch (err: any) {
      setError(err.message || 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  const isCheckedIn = todayInfo?.status === 'CHECKED_IN';
  const isCheckedOut = todayInfo?.status === 'CHECKED_OUT';
  const isWeeklyLimitReached = todayInfo?.isWeeklyLimitReached;
  const shiftCalc = previewShiftCalculation();
  const directCalc = previewDirectCalculation();

  return (
    <div id="check-in-out-widget" className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      {/* Header with Live Manila Clock and Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-100">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-neutral-900 tracking-tight">
              Attendance Logger Terminal
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              Asia/Manila (PHT)
            </span>
          </div>
          <p className="text-sm text-neutral-500 mt-0.5">
            Scheduled Start: <span className="font-semibold text-neutral-800">7:00 AM</span> · Standard Rate:{' '}
            <span className="font-semibold text-neutral-800">₱100/hr</span>
          </p>
        </div>

        {/* Live Clock & Mode Switcher */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-neutral-100 p-1 rounded-lg border border-neutral-200 text-xs">
            <button
              type="button"
              onClick={() => setMode('terminal')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                mode === 'terminal'
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Punch Flow
            </button>
            <button
              type="button"
              onClick={() => setMode('direct')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                mode === 'direct'
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Unified Entry
            </button>
          </div>

          <div className="flex items-center gap-2.5 bg-neutral-50 px-3.5 py-1.5 rounded-lg border border-neutral-200">
            <Clock className="w-4 h-4 text-indigo-600 animate-pulse shrink-0" />
            <div>
              <div className="text-sm font-mono font-bold text-neutral-900 leading-tight">
                {manilaTime || 'Loading...'}
              </div>
              <div className="text-[11px] text-neutral-500 leading-tight">{manilaDate}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Alert / Notification Feedback */}
      {error && (
        <div className="mt-4 p-3.5 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2.5 text-sm text-rose-800">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{error}</div>
        </div>
      )}

      {successMsg && (
        <div className="mt-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2.5 text-sm text-emerald-800">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{successMsg}</div>
        </div>
      )}

      {/* Weekly Quota Snapshot Cards */}
      {todayInfo && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
            <div className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Today's Schedule
            </div>
            <div className="text-sm font-semibold text-neutral-900 mt-1">
              {todayInfo.isRestDay ? 'Rest Day' : `${todayInfo.scheduledStart} – ${todayInfo.scheduledEnd}`}
            </div>
            <div className="text-xs text-neutral-500 mt-0.5">Start: 7:00 AM Manila</div>
          </div>

          <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
            <div className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Weekly Quota Progress
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-sm font-semibold text-neutral-900">
                {todayInfo.currentWeeklyHours} / 30.0 hrs
              </span>
              <span className="text-xs font-semibold text-indigo-600">
                ₱{todayInfo.currentWeeklySalary}
              </span>
            </div>
            <div className="w-full bg-neutral-200 rounded-full h-1.5 mt-1.5 overflow-hidden">
              <div
                className={`h-1.5 rounded-full ${
                  todayInfo.currentWeeklyHours >= 30
                    ? 'bg-rose-500'
                    : todayInfo.currentWeeklyHours >= 24
                    ? 'bg-amber-500'
                    : 'bg-indigo-600'
                }`}
                style={{ width: `${Math.min(100, (todayInfo.currentWeeklyHours / 30) * 100)}%` }}
              />
            </div>
          </div>

          <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
            <div className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Remaining Regular Hours
            </div>
            <div className="text-sm font-semibold text-neutral-900 mt-1">
              {todayInfo.remainingWeeklyHours} hrs left
            </div>
            <div className="text-xs text-neutral-500 mt-0.5">
              Available Pay: ₱{(todayInfo.remainingWeeklyHours * 100).toFixed(0)}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 1: STEP-BY-STEP TERMINAL FLOW (LOG ATTENDANCE -> LOG OUT ATTENDANCE) */}
      {/* ========================================================================= */}
      {mode === 'terminal' && (
        <div className="mt-6">
          {/* STATE A: NOT YET CHECKED IN -> FORM FOR LOG ATTENDANCE */}
          {!isCheckedIn && !isCheckedOut && (
            <form onSubmit={handleLogAttendance} className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-neutral-900">
                    Log Attendance (Check In)
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Enter your check-in time below or use the current Manila clock time.
                  </p>
                </div>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Ready to Punch
                </span>
              </div>

              {/* Input Type for Attendance Date & Time In */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-neutral-50/70 p-4 rounded-xl border border-neutral-200">
                {/* Input Type Date */}
                <div>
                  <label
                    htmlFor="input-log-attendance-date"
                    className="block text-xs font-semibold text-neutral-700 mb-1.5 flex items-center gap-1.5"
                  >
                    <Calendar className="w-3.5 h-3.5 text-neutral-500" />
                    Input Type: Log Attendance Date
                  </label>
                  <input
                    id="input-log-attendance-date"
                    type="date"
                    value={logInDate}
                    onChange={(e) => setLogInDate(e.target.value)}
                    required
                    className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-900 font-mono shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                  <span className="text-[11px] text-neutral-500 mt-1 block">
                    Asia/Manila business work date
                  </span>
                </div>

                {/* Input Type Time */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="input-log-attendance-time"
                      className="text-xs font-semibold text-neutral-700 flex items-center gap-1.5"
                    >
                      <Clock className="w-3.5 h-3.5 text-neutral-500" />
                      Input Type: Log Attendance Time (Time In)
                    </label>
                    <button
                      type="button"
                      onClick={() => setLogInTime(current24Time)}
                      className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 cursor-pointer"
                    >
                      Set to Now ({formatTo12Hour(current24Time)})
                    </button>
                  </div>
                  <input
                    id="input-log-attendance-time"
                    type="time"
                    step="60"
                    value={logInTime}
                    onChange={(e) => setLogInTime(e.target.value)}
                    required
                    className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-900 font-mono shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />

                  {/* Preset Buttons for Quick Testing */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-[11px] text-neutral-500 self-center mr-1">Presets:</span>
                    {[
                      { label: '06:55 AM (Early)', val: '06:55' },
                      { label: '07:00 AM (On Time)', val: '07:00' },
                      { label: '07:05 AM (+5m late)', val: '07:05' },
                      { label: '07:15 AM (+15m late)', val: '07:15' },
                      { label: '07:30 AM (+30m late)', val: '07:30' },
                    ].map((preset) => (
                      <button
                        key={preset.val}
                        type="button"
                        onClick={() => setLogInTime(preset.val)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                          logInTime === preset.val
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Dynamic Late Status Banner */}
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between text-xs sm:text-sm ${
                  computedLateMinutes > 0
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Timer className="w-4 h-4 shrink-0" />
                  <span>
                    {computedLateMinutes > 0 ? (
                      <>
                        Logging attendance at <strong className="font-mono">{formatTo12Hour(logInTime)}</strong>{' '}
                        will record <strong className="text-amber-800">{computedLateMinutes} minutes late</strong>{' '}
                        (Scheduled start is 7:00 AM).
                      </>
                    ) : (
                      <>
                        Logging attendance at <strong className="font-mono">{formatTo12Hour(logInTime)}</strong>{' '}
                        is <strong className="text-emerald-800">ON TIME</strong> (Arrival on or before 7:00 AM).
                      </>
                    )}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider shrink-0 ${
                    computedLateMinutes > 0
                      ? 'bg-amber-200 text-amber-900'
                      : 'bg-emerald-200 text-emerald-900'
                  }`}
                >
                  {computedLateMinutes > 0 ? `${computedLateMinutes}m Late` : 'On Time'}
                </span>
              </div>

              {/* Input Type for Optional Notes */}
              <div>
                <label
                  htmlFor="input-log-attendance-notes"
                  className="block text-xs font-semibold text-neutral-700 mb-1"
                >
                  Input Type: Shift Notes (Optional)
                </label>
                <input
                  id="input-log-attendance-notes"
                  type="text"
                  value={logInNotes}
                  onChange={(e) => setLogInNotes(e.target.value)}
                  placeholder="e.g., Working on client deliverables, morning standby..."
                  className="w-full text-xs rounded-lg border border-neutral-300 px-3 py-2 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Primary Action Button */}
              <button
                id="btn-log-attendance"
                type="submit"
                disabled={loading || isWeeklyLimitReached}
                className={`w-full py-3.5 px-6 rounded-xl font-semibold text-white text-base shadow-sm transition-all flex items-center justify-center gap-2.5 ${
                  isWeeklyLimitReached
                    ? 'bg-neutral-400 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] cursor-pointer'
                }`}
              >
                <LogIn className="w-5 h-5" />
                {loading
                  ? 'Processing Attendance Log...'
                  : isWeeklyLimitReached
                  ? 'Weekly 30-Hour Quota Reached'
                  : `LOG ATTENDANCE (${formatTo12Hour(logInTime)})`}
              </button>
            </form>
          )}

          {/* STATE B: CURRENTLY CHECKED IN -> FORM FOR LOG OUT ATTENDANCE */}
          {isCheckedIn && (
            <form onSubmit={handleLogOutAttendance} className="space-y-4">
              {/* Active Shift Header Banner */}
              <div className="p-4 bg-indigo-50/80 border border-indigo-200 rounded-xl flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
                  <div>
                    <div className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">
                      Active Shift in Progress
                    </div>
                    <div className="text-sm text-neutral-800 font-medium mt-0.5">
                      Logged in at{' '}
                      <span className="font-bold text-neutral-900 font-mono">
                        {todayInfo?.formattedTimeIn || todayInfo?.timeIn}
                      </span>
                      {todayInfo && todayInfo.lateMinutes > 0 ? (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800">
                          {todayInfo.lateMinutes} min late
                        </span>
                      ) : (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">
                          On time
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-center md:text-right">
                  <div className="text-[11px] text-neutral-500 font-medium">Elapsed Shift Time</div>
                  <div className="text-2xl font-mono font-bold text-indigo-950">{elapsedDuration}</div>
                </div>
              </div>

              {/* Input Types for Log Out Attendance */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-neutral-50/70 p-4 rounded-xl border border-neutral-200">
                {/* Input Type Time Out */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="input-log-out-attendance-time"
                      className="text-xs font-semibold text-neutral-700 flex items-center gap-1.5"
                    >
                      <Clock className="w-3.5 h-3.5 text-neutral-500" />
                      Input Type: Log Out Attendance Time (Time Out)
                    </label>
                    <button
                      type="button"
                      onClick={() => setLogOutTime(current24Time)}
                      className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 cursor-pointer"
                    >
                      Set to Now ({formatTo12Hour(current24Time)})
                    </button>
                  </div>
                  <input
                    id="input-log-out-attendance-time"
                    type="time"
                    step="60"
                    value={logOutTime}
                    onChange={(e) => setLogOutTime(e.target.value)}
                    required
                    className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-900 font-mono shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />

                  {/* Preset quick buttons */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-[11px] text-neutral-500 self-center mr-1">Presets:</span>
                    {[
                      { label: '12:00 PM (Half-Day)', val: '12:00' },
                      { label: '16:00 (4:00 PM)', val: '16:00' },
                      { label: '17:00 (5:00 PM)', val: '17:00' },
                      { label: '18:00 (6:00 PM)', val: '18:00' },
                    ].map((preset) => (
                      <button
                        key={preset.val}
                        type="button"
                        onClick={() => setLogOutTime(preset.val)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                          logOutTime === preset.val
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Input Type Break Duration */}
                <div>
                  <label
                    htmlFor="input-log-out-attendance-break"
                    className="block text-xs font-semibold text-neutral-700 mb-1.5 flex items-center gap-1.5"
                  >
                    <Coffee className="w-3.5 h-3.5 text-neutral-500" />
                    Input Type: Break Duration in Hours (Deducted)
                  </label>
                  <input
                    id="input-log-out-attendance-break"
                    type="number"
                    step="0.5"
                    min="0"
                    max="4"
                    value={breakHours}
                    onChange={(e) => setBreakHours(parseFloat(e.target.value) || 0)}
                    required
                    className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-900 font-mono shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />

                  {/* Quick Pill Buttons */}
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {[0, 0.5, 1.0, 1.5].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setBreakHours(val)}
                        className={`py-1 px-1 text-center text-[11px] font-medium rounded border transition-colors cursor-pointer ${
                          breakHours === val
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-bold'
                            : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        {val === 0 ? 'No Break' : `${val} hr`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Dynamic Shift Calculation Preview Card */}
              {shiftCalc.isValid ? (
                <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-xl text-xs">
                  <div className="flex items-center justify-between text-neutral-700 pb-2 border-b border-emerald-200/60">
                    <span className="font-semibold text-emerald-900">
                      Calculated Shift Pay & Hours Preview:
                    </span>
                    <span className="font-mono text-emerald-800 font-bold">
                      Rate: ₱100.00 / hour
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-2 text-center">
                    <div>
                      <div className="text-[11px] text-neutral-500">Gross Shift</div>
                      <div className="font-mono font-semibold text-neutral-800">
                        {shiftCalc.grossHours} hrs
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-neutral-500">Break Deducted</div>
                      <div className="font-mono font-semibold text-neutral-800">
                        -{shiftCalc.breakHours} hr
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-neutral-500">Regular Hours</div>
                      <div className="font-mono font-bold text-indigo-700">
                        {shiftCalc.regularHours} hrs (Max 10)
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-neutral-500">Shift Salary</div>
                      <div className="font-mono font-bold text-emerald-700 text-sm">
                        ₱{shiftCalc.salary.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg">
                  {shiftCalc.message}
                </div>
              )}

              {/* Input Type for Notes */}
              <div>
                <label
                  htmlFor="input-log-out-attendance-notes"
                  className="block text-xs font-semibold text-neutral-700 mb-1"
                >
                  Input Type: Shift Completion Notes (Optional)
                </label>
                <input
                  id="input-log-out-attendance-notes"
                  type="text"
                  value={logOutNotes}
                  onChange={(e) => setLogOutNotes(e.target.value)}
                  placeholder="e.g., Completed weekly reports, submitted design specs..."
                  className="w-full text-xs rounded-lg border border-neutral-300 px-3 py-2 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Action Button */}
              <button
                id="btn-log-out-attendance"
                type="submit"
                disabled={loading || !shiftCalc.isValid}
                className="w-full py-3.5 px-6 rounded-xl font-semibold text-white text-base bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] transition-all flex items-center justify-center gap-2.5 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <LogOut className="w-5 h-5" />
                {loading
                  ? 'Calculating Salary & Logging Out...'
                  : `LOG OUT ATTENDANCE (${formatTo12Hour(logOutTime)})`}
              </button>
            </form>
          )}

          {/* STATE C: SHIFT COMPLETED -> SUMMARY & RESET BUTTON */}
          {isCheckedOut && (
            <div className="p-5 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                  <div>
                    <h3 className="text-base font-semibold text-emerald-900">
                      Today's Attendance Finalized
                    </h3>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      Your working hours and salary have been calculated and saved to your account.
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                  Completed
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-center">
                <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                  <div className="text-[11px] text-neutral-500 uppercase font-medium">Time In</div>
                  <div className="text-sm font-bold text-neutral-900 mt-0.5">
                    {todayInfo?.formattedTimeIn || todayInfo?.timeIn}
                  </div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                  <div className="text-[11px] text-neutral-500 uppercase font-medium">Time Out</div>
                  <div className="text-sm font-bold text-neutral-900 mt-0.5">
                    {todayInfo?.formattedTimeOut || todayInfo?.timeOut}
                  </div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                  <div className="text-[11px] text-neutral-500 uppercase font-medium">Regular Hours</div>
                  <div className="text-sm font-bold text-neutral-900 mt-0.5">
                    {todayInfo?.regularHours} hrs (Max 10)
                  </div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                  <div className="text-[11px] text-neutral-500 uppercase font-medium">Earned Pay</div>
                  <div className="text-sm font-bold text-emerald-700 mt-0.5">
                    ₱{todayInfo?.dailySalary}
                  </div>
                </div>
              </div>

              {/* Option to clear & re-log with input types */}
              <div className="pt-2 border-t border-emerald-200/60 flex items-center justify-between">
                <span className="text-xs text-neutral-600">
                  Need to adjust your hours or test with another punch time?
                </span>
                <button
                  type="button"
                  onClick={handleResetToday}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-700 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Re-log / Reset Today's Shift
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 2: UNIFIED DIRECT LOGGER (INPUT TYPE FOR BOTH LOG IN & LOG OUT)      */}
      {/* ========================================================================= */}
      {mode === 'direct' && (
        <form onSubmit={handleDirectSubmit} className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-neutral-900">
                Unified Direct Attendance Entry
              </h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                Explicitly enter both Log Attendance (Time In) and Log Out Attendance (Time Out) for any date.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Direct Input Mode
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-neutral-50/70 p-4 rounded-xl border border-neutral-200">
            {/* Input Type Date */}
            <div>
              <label
                htmlFor="input-direct-date"
                className="block text-xs font-semibold text-neutral-700 mb-1"
              >
                Work Date
              </label>
              <input
                id="input-direct-date"
                type="date"
                value={directDate}
                onChange={(e) => setDirectDate(e.target.value)}
                required
                className="w-full bg-white border border-neutral-300 rounded-lg px-2.5 py-2 text-xs font-mono text-neutral-900 shadow-sm focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Input Type Log Attendance (Time In) */}
            <div>
              <label
                htmlFor="input-direct-time-in"
                className="block text-xs font-semibold text-neutral-700 mb-1"
              >
                Log Attendance (Time In)
              </label>
              <input
                id="input-direct-time-in"
                type="time"
                step="60"
                value={directTimeIn}
                onChange={(e) => setDirectTimeIn(e.target.value)}
                required
                className="w-full bg-white border border-neutral-300 rounded-lg px-2.5 py-2 text-xs font-mono text-neutral-900 shadow-sm focus:ring-1 focus:ring-indigo-500"
              />
              <div className="text-[10px] text-neutral-500 mt-0.5">
                {directCalc.isValid && (
                  <span>
                    {directCalc.lateMinutes > 0 ? (
                      <strong className="text-amber-700">{directCalc.lateMinutes} min late</strong>
                    ) : (
                      <strong className="text-emerald-700">On time</strong>
                    )}
                  </span>
                )}
              </div>
            </div>

            {/* Input Type Log Out Attendance (Time Out) */}
            <div>
              <label
                htmlFor="input-direct-time-out"
                className="block text-xs font-semibold text-neutral-700 mb-1"
              >
                Log Out Attendance (Time Out)
              </label>
              <input
                id="input-direct-time-out"
                type="time"
                step="60"
                value={directTimeOut}
                onChange={(e) => setDirectTimeOut(e.target.value)}
                required
                className="w-full bg-white border border-neutral-300 rounded-lg px-2.5 py-2 text-xs font-mono text-neutral-900 shadow-sm focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Input Type Break Hours */}
            <div>
              <label
                htmlFor="input-direct-break"
                className="block text-xs font-semibold text-neutral-700 mb-1"
              >
                Break (Hours)
              </label>
              <input
                id="input-direct-break"
                type="number"
                step="0.5"
                min="0"
                max="4"
                value={directBreak}
                onChange={(e) => setDirectBreak(parseFloat(e.target.value) || 0)}
                required
                className="w-full bg-white border border-neutral-300 rounded-lg px-2.5 py-2 text-xs font-mono text-neutral-900 shadow-sm focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Live Dynamic Preview */}
          {directCalc.isValid ? (
            <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-neutral-500">Gross:</span>{' '}
                  <strong className="font-mono">{directCalc.grossHours}h</strong>
                </div>
                <div>
                  <span className="text-neutral-500">Net Regular:</span>{' '}
                  <strong className="font-mono text-indigo-700">{directCalc.regularHours}h</strong>
                </div>
                <div>
                  <span className="text-neutral-500">Calculated Salary:</span>{' '}
                  <strong className="font-mono text-emerald-700 font-bold text-sm">
                    ₱{directCalc.salary.toFixed(2)}
                  </strong>
                </div>
              </div>
              <div className="text-[11px] text-neutral-500">Max 10h/day · Max 30h/week</div>
            </div>
          ) : (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg">
              {directCalc.message}
            </div>
          )}

          {/* Notes Input */}
          <div>
            <label htmlFor="input-direct-notes" className="block text-xs font-semibold text-neutral-700 mb-1">
              Input Type: Notes (Optional)
            </label>
            <input
              id="input-direct-notes"
              type="text"
              value={directNotes}
              onChange={(e) => setDirectNotes(e.target.value)}
              placeholder="e.g., Full shift completed, verified with supervisor..."
              className="w-full text-xs rounded-lg border border-neutral-300 px-3 py-2 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Submit Button */}
          <button
            id="btn-direct-submit"
            type="submit"
            disabled={loading || !directCalc.isValid}
            className="w-full py-3 px-6 rounded-xl font-semibold text-white text-sm bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            {loading ? 'Submitting Attendance...' : 'SUBMIT ATTENDANCE LOG RECORD'}
          </button>
        </form>
      )}
    </div>
  );
};
