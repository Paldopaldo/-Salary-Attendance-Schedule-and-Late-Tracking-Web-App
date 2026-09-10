import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { Sidebar, ActiveTab } from './components/Sidebar.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { AttendanceView } from './components/AttendanceView.tsx';
import { LateTrackingView } from './components/LateTrackingView.tsx';
import { SalaryView } from './components/SalaryView.tsx';
import { ScheduleView } from './components/ScheduleView.tsx';
import { UserAuditHistoryView } from './components/UserAuditHistoryView.tsx';
import { ProfileSettingsView } from './components/ProfileSettingsView.tsx';
import { TestRunnerView } from './components/TestRunnerView.tsx';
import { SystemDocumentationView } from './components/SystemDocumentationView.tsx';
import { AuthView } from './components/AuthView.tsx';
import { User } from './types.ts';
import { apiRequest, setAuthToken, clearAuthToken, getAuthToken } from './lib/api.ts';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [initialLoading, setInitialLoading] = useState(true);

  // Initialize session
  const initializeApp = async () => {
    try {
      let token = getAuthToken();
      if (!token) {
        // Auto-initialize demo session with Juan Dela Cruz for immediate live interactive preview
        const demoAuth = await apiRequest<{ token: string; user: User }>('/auth/demo-switch', {
          method: 'POST',
          body: JSON.stringify({ email: 'juan@example.com' }),
        });
        setAuthToken(demoAuth.token);
        token = demoAuth.token;
      }

      // Load user profile
      const meRes = await apiRequest<{ user: User }>('/auth/me');
      setCurrentUser(meRes.user);
    } catch (err) {
      console.error('Failed to initialize app, clearing token:', err);
      clearAuthToken();
      setCurrentUser(null);
    } finally {
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    initializeApp();
  }, []);

  const handleLogout = () => {
    clearAuthToken();
    setCurrentUser(null);
  };

  const handleSwitchUser = async (email: string) => {
    try {
      const res = await apiRequest<{ token: string; user: User }>('/auth/demo-switch', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setAuthToken(res.token);
      setCurrentUser(res.user);
      setActiveTab('dashboard');
    } catch (err: any) {
      alert(err.message || 'Failed to switch user');
    }
  };

  if (initialLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-neutral-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <div className="text-xs font-semibold text-neutral-600">
            Initializing User-Only Salary & Attendance System...
          </div>
        </div>
      </div>
    );
  }

  // If logged out, render full AuthView
  if (!currentUser) {
    return <AuthView onLoginSuccess={(user) => setCurrentUser(user)} />;
  }

  return (
    <div className="min-h-screen bg-neutral-100/60 flex flex-col font-sans antialiased text-neutral-900">
      {/* Top Header */}
      <Header
        currentUser={currentUser}
        onLogout={handleLogout}
        onSwitchUser={handleSwitchUser}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
        />

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-6xl mx-auto">
            {activeTab === 'dashboard' && (
              <DashboardView
                onNavigateToAttendance={() => setActiveTab('attendance')}
                onNavigateToLate={() => setActiveTab('late')}
              />
            )}

            {activeTab === 'attendance' && <AttendanceView />}

            {activeTab === 'late' && <LateTrackingView />}

            {activeTab === 'salary' && <SalaryView />}

            {activeTab === 'schedule' && <ScheduleView />}

            {activeTab === 'audit' && <UserAuditHistoryView />}

            {activeTab === 'settings' && (
              <ProfileSettingsView
                currentUser={currentUser}
                onUserUpdated={() => initializeApp()}
                onSwitchUser={handleSwitchUser}
              />
            )}

            {activeTab === 'tests' && <TestRunnerView />}

            {activeTab === 'docs' && <SystemDocumentationView />}
          </div>
        </main>
      </div>
    </div>
  );
}
