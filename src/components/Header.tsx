import React, { useState, useRef, useEffect } from 'react';
import { Clock, User as UserIcon, LogOut, ChevronDown, Check, Shield } from 'lucide-react';
import { User } from '../types.ts';

interface HeaderProps {
  currentUser: User | null;
  onLogout: () => void;
  onSwitchUser: (email: string) => Promise<void>;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  onLogout,
  onSwitchUser,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-neutral-200 bg-white/95 px-6 py-3.5 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-neutral-900 tracking-tight">
                Salary & Attendance Tracker
              </h1>
              <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
                ₱100 / hr
              </span>
            </div>
            <p className="text-xs text-neutral-500 font-medium">
              7:00 AM Start · Max 10h/day (₱1,000) · Max 30h/week (₱3,000) · Asia/Manila
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* User Account Switcher Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50/90 px-3 py-1.5 text-xs font-medium text-neutral-800 transition hover:bg-neutral-100 cursor-pointer"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white font-semibold text-xs">
              {currentUser?.fullName?.charAt(0) || 'U'}
            </span>
            <div className="text-left hidden sm:block">
              <div className="font-semibold text-neutral-900">
                {currentUser?.fullName || 'User'}
              </div>
              <div className="text-[10px] text-neutral-500 font-mono">
                {currentUser?.email || ''}
              </div>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-64 origin-top-right rounded-xl border border-neutral-200 bg-white p-1.5 shadow-lg z-50">
              <div className="px-2.5 py-1.5 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Switch Test Account (Isolation Test)
              </div>

              {/* Juan */}
              <button
                type="button"
                onClick={async () => {
                  await onSwitchUser('juan@example.com');
                  setDropdownOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs transition cursor-pointer ${
                  currentUser?.email === 'juan@example.com'
                    ? 'bg-neutral-100 font-semibold text-neutral-900'
                    : 'text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <div>
                  <div className="font-medium text-neutral-900">Juan Dela Cruz</div>
                  <div className="text-[10px] text-neutral-500">juan@example.com</div>
                </div>
                {currentUser?.email === 'juan@example.com' && (
                  <Check className="h-4 w-4 text-emerald-600" />
                )}
              </button>

              {/* Maria */}
              <button
                type="button"
                onClick={async () => {
                  await onSwitchUser('maria@example.com');
                  setDropdownOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs transition cursor-pointer ${
                  currentUser?.email === 'maria@example.com'
                    ? 'bg-neutral-100 font-semibold text-neutral-900'
                    : 'text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <div>
                  <div className="font-medium text-neutral-900">Maria Santos</div>
                  <div className="text-[10px] text-neutral-500">maria@example.com</div>
                </div>
                {currentUser?.email === 'maria@example.com' && (
                  <Check className="h-4 w-4 text-emerald-600" />
                )}
              </button>

              <div className="my-1 border-t border-neutral-100" />

              <button
                type="button"
                onClick={() => {
                  setDropdownOpen(false);
                  onLogout();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 transition cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Log Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
