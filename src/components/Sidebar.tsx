import React from 'react';
import {
  LayoutDashboard,
  CalendarCheck2,
  Timer,
  Banknote,
  CalendarDays,
  ShieldCheck,
  User,
  CheckCircle2,
  BookOpen,
  AlertTriangle,
} from 'lucide-react';

export type ActiveTab =
  | 'dashboard'
  | 'attendance'
  | 'late'
  | 'salary'
  | 'schedule'
  | 'audit'
  | 'settings'
  | 'tests'
  | 'docs';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  isWeeklyLimitReached?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  isWeeklyLimitReached,
}) => {
  const navItems = [
    {
      id: 'dashboard' as ActiveTab,
      label: 'Dashboard',
      icon: LayoutDashboard,
    },
    {
      id: 'attendance' as ActiveTab,
      label: 'Attendance & Punch',
      icon: CalendarCheck2,
      badge: isWeeklyLimitReached ? '30h Reached' : undefined,
    },
    {
      id: 'late' as ActiveTab,
      label: 'Late Tracking',
      icon: Timer,
    },
    {
      id: 'salary' as ActiveTab,
      label: 'Salary & Earnings',
      icon: Banknote,
    },
    {
      id: 'schedule' as ActiveTab,
      label: 'My Schedule',
      icon: CalendarDays,
    },
    {
      id: 'audit' as ActiveTab,
      label: 'My Audit Logs',
      icon: ShieldCheck,
    },
    {
      id: 'settings' as ActiveTab,
      label: 'Profile & Account',
      icon: User,
    },
    {
      id: 'tests' as ActiveTab,
      label: 'Automated Test Suite',
      icon: CheckCircle2,
      badge: '18 Tests',
    },
    {
      id: 'docs' as ActiveTab,
      label: 'Architecture & Docs',
      icon: BookOpen,
    },
  ];

  return (
    <aside className="w-64 shrink-0 border-r border-neutral-200 bg-neutral-50/70 flex flex-col justify-between p-4">
      <div className="space-y-6">
        <div>
          <div className="px-3 text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
            User Portal
          </div>
          <nav className="mt-2 space-y-1">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={`group flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition cursor-pointer ${
                    isActive
                      ? 'bg-neutral-900 text-white shadow-xs'
                      : 'text-neutral-700 hover:bg-neutral-200/60 hover:text-neutral-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon
                      className={`h-4 w-4 shrink-0 transition ${
                        isActive ? 'text-indigo-400' : 'text-neutral-400 group-hover:text-neutral-600'
                      }`}
                    />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        isActive
                          ? 'bg-indigo-500/20 text-indigo-300'
                          : item.badge.includes('Reached')
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Rules Enforcement Card */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-xs space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-900">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span>Core Business Rules</span>
        </div>
        <div className="space-y-1 text-[11px] text-neutral-600">
          <div className="flex justify-between">
            <span className="text-neutral-400">Rate:</span>
            <span className="font-semibold text-neutral-800">₱100 / hour</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Start Time:</span>
            <span className="font-semibold text-neutral-800">7:00 AM</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Daily Max:</span>
            <span className="font-semibold text-neutral-800">10 hrs (₱1,000)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Weekly Max:</span>
            <span className="font-semibold text-neutral-800">30 hrs (₱3,000)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Timezone:</span>
            <span className="font-semibold text-neutral-800">Asia/Manila</span>
          </div>
        </div>
        <div className="pt-1.5 border-t border-neutral-100 text-[10px] text-neutral-400">
          User-Only System · ACID Database Enforced
        </div>
      </div>
    </aside>
  );
};
