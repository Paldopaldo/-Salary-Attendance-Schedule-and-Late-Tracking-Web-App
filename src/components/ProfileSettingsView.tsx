import React, { useState, useEffect } from 'react';
import { User, Lock, KeyRound, Shield, CheckCircle2, AlertCircle, RefreshCw, UserCheck } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';

interface ProfileSettingsViewProps {
  currentUser: any;
  onUserUpdated?: () => void;
  onSwitchUser?: (email: string) => void;
}

export const ProfileSettingsView: React.FC<ProfileSettingsViewProps> = ({
  currentUser,
  onUserUpdated,
  onSwitchUser,
}) => {
  // Profile state
  const [fullName, setFullName] = useState(currentUser?.fullName || '');
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (currentUser) {
      setFullName(currentUser.fullName || '');
      setPhone(currentUser.phone || '');
    }
  }, [currentUser]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      await apiRequest('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ fullName, phone }),
      });
      setProfileMsg({ type: 'success', text: 'Profile updated successfully.' });
      if (onUserUpdated) onUserUpdated();
    } catch (err: any) {
      setProfileMsg({ type: 'error', text: err.message || 'Failed to update profile.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg({ type: 'error', text: 'New password must be at least 6 characters.' });
      return;
    }

    setSavingPassword(true);
    setPasswordMsg(null);
    try {
      await apiRequest('/auth/profile/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setPasswordMsg({ type: 'success', text: 'Password changed successfully.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordMsg({ type: 'error', text: err.message || 'Failed to change password.' });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div id="profile-settings-view" className="space-y-6 max-w-4xl">
      <div className="pb-2">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Account & Profile Settings
        </h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Manage your personal credentials, contact info, and security credentials.
        </p>
      </div>

      {/* Account Switcher for Live Testing of User Isolation */}
      {onSwitchUser && (
        <div className="p-5 bg-indigo-50/70 border border-indigo-200 rounded-xl">
          <div className="flex items-center gap-2 text-sm font-bold text-indigo-950">
            <UserCheck className="w-4 h-4 text-indigo-600" />
            Quick User Switcher (Verify Account Isolation)
          </div>
          <p className="text-xs text-neutral-600 mt-1">
            Test how each employee can strictly access only their own schedule, attendance, late records, and salary:
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              onClick={() => onSwitchUser('juan@example.com')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                currentUser?.email === 'juan@example.com'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-neutral-800 border border-neutral-300 hover:bg-neutral-50'
              }`}
            >
              Juan Dela Cruz (juan@example.com)
            </button>
            <button
              type="button"
              onClick={() => onSwitchUser('maria@example.com')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                currentUser?.email === 'maria@example.com'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-neutral-800 border border-neutral-300 hover:bg-neutral-50'
              }`}
            >
              Maria Santos (maria@example.com)
            </button>
          </div>
        </div>
      )}

      {/* Form 1: Profile Information */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-neutral-900 mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-indigo-600" />
          Personal Information
        </h2>

        {profileMsg && (
          <div
            className={`mb-4 p-3 rounded-lg text-xs flex items-center gap-2 ${
              profileMsg.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {profileMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{profileMsg.text}</span>
          </div>
        )}

        <form onSubmit={handleUpdateProfile} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Registered Email (Immutable Account Key)
            </label>
            <input
              type="email"
              disabled
              value={currentUser?.email || ''}
              className="w-full text-xs font-mono rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-2 text-neutral-500 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Full Name
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full text-xs rounded-lg border border-neutral-300 px-3 py-2 text-neutral-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Contact Phone
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+63 900 000 0000"
              className="w-full text-xs rounded-lg border border-neutral-300 px-3 py-2 text-neutral-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            {savingProfile ? 'Saving...' : 'Save Profile Changes'}
          </button>
        </form>
      </div>

      {/* Form 2: Change Password */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-neutral-900 mb-4 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-indigo-600" />
          Change Password
        </h2>

        {passwordMsg && (
          <div
            className={`mb-4 p-3 rounded-lg text-xs flex items-center gap-2 ${
              passwordMsg.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {passwordMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{passwordMsg.text}</span>
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Current Password
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full text-xs rounded-lg border border-neutral-300 px-3 py-2 text-neutral-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                New Password (Min 6 chars)
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full text-xs rounded-lg border border-neutral-300 px-3 py-2 text-neutral-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full text-xs rounded-lg border border-neutral-300 px-3 py-2 text-neutral-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={savingPassword}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            {savingPassword ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>

      {/* Form 3: Database & Supabase Cloud Integration */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base font-semibold text-neutral-900">
              Cloud Database Integration (Supabase / Vercel)
            </h2>
          </div>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-700 border border-neutral-200">
            PostgreSQL Ready
          </span>
        </div>

        <p className="text-xs text-neutral-500 mb-4">
          This system is configured for dual-mode database persistence. When deployed on Vercel or cloud hosts, it connects directly to your Supabase PostgreSQL project.
        </p>

        <SupabaseStatusSection />
      </div>
    </div>
  );
};

const SupabaseStatusSection: React.FC = () => {
  const [status, setStatus] = useState<{
    configured: boolean;
    connected: boolean;
    message: string;
    databaseType: string;
    error?: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const data = await apiRequest<any>('/supabase/status');
      setStatus(data);
    } catch (err: any) {
      console.error('Supabase check failed:', err);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const handleMigrate = async () => {
    setMigrating(true);
    setMigrateMsg(null);
    try {
      const res = await apiRequest<any>('/supabase/migrate', { method: 'POST' });
      setMigrateMsg(res.message);
      await checkStatus();
    } catch (err: any) {
      setMigrateMsg(`Migration failed: ${err.message}`);
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50/70">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
              Active Storage Engine
            </div>
            <div className="text-sm font-bold text-neutral-900 mt-0.5 flex items-center gap-2">
              <span>{status?.databaseType || 'Local SQLite'}</span>
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  status?.connected
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-amber-500'
                }`}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={checkStatus}
            disabled={checking}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking...' : 'Check Connection'}
          </button>
        </div>

        <div className="mt-3 text-xs text-neutral-600 bg-white p-3 rounded-lg border border-neutral-200">
          <p className="font-medium">{status?.message || 'Checking database status...'}</p>
          {status?.error && (
            <p className="text-rose-600 mt-1 font-mono text-[11px]">{status.error}</p>
          )}
        </div>
      </div>

      {/* Migration Action if configured */}
      {status?.configured && (
        <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-3">
          <div className="text-xs text-neutral-700">
            <strong>Ready to Sync:</strong> You can migrate all local test users, schedules, and attendance records into your Supabase database.
          </div>
          {migrateMsg && (
            <div className="p-2.5 rounded-lg bg-white border border-emerald-200 text-xs text-emerald-800">
              {migrateMsg}
            </div>
          )}
          <button
            type="button"
            onClick={handleMigrate}
            disabled={migrating}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
          >
            {migrating ? 'Migrating Records...' : 'Migrate Existing Records to Supabase'}
          </button>
        </div>
      )}

      {/* Setup Instructions */}
      <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50/40 text-xs text-neutral-600 space-y-2">
        <div className="font-semibold text-neutral-900">How to Connect Your Supabase Credentials:</div>
        <ol className="list-decimal list-inside space-y-1 text-neutral-600">
          <li>Provide your <strong>Project URL</strong> (e.g. <code className="font-mono text-[11px] bg-neutral-200 px-1 py-0.5 rounded">https://xyz.supabase.co</code>) and <strong>Anon Key</strong>.</li>
          <li>Run the provided <code className="font-mono text-[11px] bg-neutral-200 px-1 py-0.5 rounded">supabase-schema.sql</code> script in your Supabase SQL Editor.</li>
          <li>Deploy directly to Vercel with these environment variables set in Vercel project settings.</li>
        </ol>
      </div>
    </div>
  );
};
