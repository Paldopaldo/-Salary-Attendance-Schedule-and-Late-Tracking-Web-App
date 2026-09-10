import React, { useState, useEffect } from 'react';
import { Calendar, Clock, CheckCircle2, AlertCircle, Save } from 'lucide-react';
import { UserSchedule } from '../types.ts';
import { apiRequest } from '../lib/api.ts';
import { formatTo12Hour } from '../utils/timezone.ts';

export const ScheduleView: React.FC = () => {
  const [schedules, setSchedules] = useState<UserSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingDay, setSavingDay] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchSchedule = async () => {
    try {
      const data = await apiRequest<UserSchedule[]>('/schedule');
      setSchedules(data);
    } catch (err) {
      console.error('Failed to load schedule:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedule();
  }, []);

  const handleUpdate = async (sch: UserSchedule) => {
    setSavingDay(sch.dayOfWeek);
    setFeedback(null);
    try {
      await apiRequest(`/schedule/${sch.dayOfWeek}`, {
        method: 'PUT',
        body: JSON.stringify({
          scheduledStart: sch.scheduledStart,
          scheduledEnd: sch.scheduledEnd,
          isRestDay: sch.isRestDay,
        }),
      });
      setFeedback(`Schedule for ${sch.dayOfWeek} updated successfully.`);
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback(`Failed to update ${sch.dayOfWeek}: ${err.message}`);
    } finally {
      setSavingDay(null);
    }
  };

  const handleFieldChange = (
    dayOfWeek: string,
    field: 'scheduledStart' | 'scheduledEnd' | 'isRestDay',
    value: any
  ) => {
    setSchedules((prev) =>
      prev.map((s) => (s.dayOfWeek === dayOfWeek ? { ...s, [field]: value } : s))
    );
  };

  if (loading) {
    return (
      <div className="flex h-80 items-center justify-center">
        <div className="text-sm text-neutral-500">Loading your schedule configuration...</div>
      </div>
    );
  }

  return (
    <div id="schedule-view" className="space-y-6">
      <div className="pb-2">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          My Weekly Schedule
        </h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Configure your standard daily working hours. Default schedule is <strong>7:00 AM – 5:00 PM</strong> (Mon–Fri, Sat & Sun Rest Days).
        </p>
      </div>

      {feedback && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-indigo-600" />
            7-Day Work Schedule Configuration
          </h2>
          <span className="text-xs text-neutral-500">All times in Asia/Manila (PHT)</span>
        </div>

        <div className="divide-y divide-neutral-100">
          {schedules.map((sch) => {
            const isSaving = savingDay === sch.dayOfWeek;
            return (
              <div
                key={sch.id}
                className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-neutral-50/60 transition-colors"
              >
                <div className="w-40">
                  <span className="text-sm font-semibold text-neutral-900">{sch.dayOfWeek}</span>
                  <div className="text-xs text-neutral-500">
                    {sch.isRestDay ? 'Scheduled Rest Day' : 'Working Day'}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 flex-1">
                  {/* Rest Day Switch */}
                  <label className="flex items-center gap-2 text-xs font-medium text-neutral-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sch.isRestDay}
                      onChange={(e) =>
                        handleFieldChange(sch.dayOfWeek, 'isRestDay', e.target.checked)
                      }
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Rest Day</span>
                  </label>

                  {!sch.isRestDay ? (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-neutral-500 font-medium">Start:</span>
                        <input
                          type="time"
                          value={sch.scheduledStart}
                          onChange={(e) =>
                            handleFieldChange(sch.dayOfWeek, 'scheduledStart', e.target.value)
                          }
                          className="border border-neutral-300 rounded px-2.5 py-1 text-xs font-mono text-neutral-800 focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-neutral-500 font-medium">End:</span>
                        <input
                          type="time"
                          value={sch.scheduledEnd}
                          onChange={(e) =>
                            handleFieldChange(sch.dayOfWeek, 'scheduledEnd', e.target.value)
                          }
                          className="border border-neutral-300 rounded px-2.5 py-1 text-xs font-mono text-neutral-800 focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>

                      <span className="text-xs text-neutral-400 font-mono hidden sm:inline">
                        ({formatTo12Hour(sch.scheduledStart)} – {formatTo12Hour(sch.scheduledEnd)})
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-neutral-400 italic">
                      No shift scheduled on rest day
                    </span>
                  )}
                </div>

                <div>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleUpdate(sch)}
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSaving ? 'Saving...' : 'Save Day'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
