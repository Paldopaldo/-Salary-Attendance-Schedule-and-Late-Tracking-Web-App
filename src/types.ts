// User-Only Salary, Attendance, Schedule, and Late Tracking System Types

export type AttendanceStatus =
  | 'ON_TIME'
  | 'LATE'
  | 'ABSENT'
  | 'REST_DAY'
  | 'LEAVE'
  | 'CHECKED_IN';

export type TodayStatus = 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'CHECKED_OUT' | 'REST_DAY';

export interface User {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  profilePicture?: string;
  accountStatus: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface UserSchedule {
  id: string;
  userId: string;
  dayOfWeek: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  scheduledStart: string; // e.g. "07:00"
  scheduledEnd: string;   // e.g. "17:00"
  isRestDay: boolean;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  workDate: string; // YYYY-MM-DD
  scheduledStart: string; // "07:00"
  scheduledEnd: string;   // "17:00"
  timeIn: string;         // "07:12"
  timeOut?: string;       // "16:12"
  breakHours: number;     // 1.0
  totalHours: number;     // Total net hours
  regularHours: number;   // Capped at 10.0 hours/day
  overtimeHours: number;  // Hours exceeding 10.0
  lateMinutes: number;    // Calculated against scheduledStart (7:00 AM)
  attendanceStatus: AttendanceStatus;
  hourlyRate: number;     // ₱100/hr
  salary: number;         // regularHours * hourlyRate (max ₱1,000/day)
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TodayAttendanceInfo {
  status: TodayStatus;
  attendanceId?: string;
  workDate: string;
  dayOfWeek: string;
  scheduledStart: string;
  scheduledEnd: string;
  isRestDay: boolean;
  timeIn?: string;
  formattedTimeIn?: string;
  timeOut?: string;
  formattedTimeOut?: string;
  breakHours: number;
  totalHours: number;
  regularHours: number;
  dailySalary: number;
  lateMinutes: number;
  lateStatus: 'ON_TIME' | 'LATE' | 'REST_DAY';
  isDailyLimitReached: boolean;
  currentWeeklyHours: number;
  remainingWeeklyHours: number;
  currentWeeklySalary: number;
  isWeeklyLimitReached: boolean;
}

export interface LateSummary {
  lateMinutesToday: number;
  lateMinutesThisWeek: number;
  lateMinutesThisMonth: number;
  lateDaysThisMonth: number;
  records: Array<{
    id: string;
    workDate: string;
    scheduledStart: string;
    timeIn: string;
    lateMinutes: number;
    attendanceStatus: AttendanceStatus;
  }>;
}

export interface WeeklySalarySummary {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  totalWeeklyHours: number; // Max 30 hours
  remainingWeeklyHours: number; // 30 - totalWeeklyHours
  weeklySalary: number; // totalWeeklyHours * 100 (Max ₱3,000)
  hourlyRate: number; // ₱100/hr
  records: AttendanceRecord[];
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  action: string;
  description: string;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UserDashboardData {
  user: User;
  today: TodayAttendanceInfo;
  weekly: {
    weekLabel: string;
    hoursWorked: number;
    maxWeeklyHours: number; // 30
    remainingHours: number;
    weeklySalary: number;
    maxWeeklySalary: number; // 3,000
    percentageUsed: number;
  };
  lateSummary: {
    lateMinutesThisMonth: number;
    lateDaysThisMonth: number;
    lateMinutesThisWeek: number;
  };
  recentAttendance: AttendanceRecord[];
}
