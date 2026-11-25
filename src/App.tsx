import { useCallback, useEffect, useState } from 'react';
import { AdminLayout } from './components/AdminLayout';
import { ToastProvider, useToast } from './components/ui/ToastProvider';
import { inspectSupabaseSchema } from './lib/schemaInspector';
import {
  clearSavedSupabaseConfig,
  getActiveSupabaseConfig,
  getSupabaseClient,
} from './lib/supabaseClient';
import { AdminManagementPage } from './pages/AdminManagementPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AuthView } from './pages/AuthView';
import { CategoriesPage } from './pages/CategoriesPage';
import { CommentsPage } from './pages/CommentsPage';
import { ConnectSupabaseView } from './pages/ConnectSupabaseView';
import { DashboardPage, type UsersQuickFilter } from './pages/DashboardPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { StoragePage } from './pages/StoragePage';
import { UploadVideoPage } from './pages/UploadVideoPage';
import { UserDetailsPage } from './pages/UserDetailsPage';
import { UsersPage } from './pages/UsersPage';
import { VerificationPage } from './pages/VerificationPage';
import { VideosPage } from './pages/VideosPage';
import {
  restoreAdminSession,
  sendAppEntryHeartbeat,
  sendOfflineBeacon,
  signOutAdmin,
  startAppEntryPresence,
  stopAppEntryPresence,
} from './services/adminApi';
import type {
  AdminRecord,
  AppUser,
  NavSection,
  SchemaInspectionResult,
} from './types/blade';

function BladeAdminShell() {
  const { pushToast } = useToast();

  const [bootstrapping, setBootstrapping] = useState(true);
  const [schema, setSchema] = useState<SchemaInspectionResult | null>(null);
  const [admin, setAdmin] = useState<AdminRecord | null>(null);

  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [uploadOwner, setUploadOwner] = useState<AppUser | null>(null);
  const [usersQuickFilter, setUsersQuickFilter] = useState<UsersQuickFilter>('all');

  const initialize = useCallback(async () => {
    const config = getActiveSupabaseConfig();
    if (!config) {
      setSchema(null);
      setAdmin(null);
      setBootstrapping(false);
      return;
    }

    setBootstrapping(true);
    try {
      const inspected = await inspectSupabaseSchema();
      setSchema(inspected);
      const activeAdmin = await restoreAdminSession();
      setAdmin(activeAdmin);
    } catch {
      setSchema(null);
      setAdmin(null);
    } finally {
      setBootstrapping(false);
    }
  }, []);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Listen for session expiration / sign-out across tabs
  useEffect(() => {
    if (!schema) return;
    const supabase = getSupabaseClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setAdmin(null);
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [schema]);

  // Immediately mark current entering user as live active (DB heartbeat + Realtime Presence)
  useEffect(() => {
    if (!schema || !admin) return;

    void startAppEntryPresence(schema, admin);

    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        void sendAppEntryHeartbeat(schema);
      }
    }, 30_000);

    const handleVisibilityOrFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void startAppEntryPresence(schema, admin);
      }
    };

    const handleUnload = () => {
      sendOfflineBeacon();
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [schema, admin]);

  const handleLogout = async () => {
    try {
      await stopAppEntryPresence(schema);
      await signOutAdmin();
      setAdmin(null);
      setActiveSection('dashboard');
      pushToast({ title: 'Signed out cleanly', variant: 'info' });
    } catch (err) {
      pushToast({
        title: 'Sign out failed',
        description: err instanceof Error ? err.message : 'Unable to sign out.',
        variant: 'error',
      });
    }
  };

  const handleSelectUser = (userId: string) => {
    setSelectedUserId(userId);
    setActiveSection('user-details');
  };

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6">
        <img
          src="/assets/aistudio/Bold_Red_Geometric_B_Logo_701917dd.png"
          alt="BLADE"
          className="w-12 h-12 rounded-md object-cover mb-4"
        />
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-red-600 rounded-full animate-spin" />
        <p className="text-xs text-zinc-400 mt-3">Initializing BLADE ADMIN PANEL…</p>
      </div>
    );
  }

  if (!schema) {
    return (
      <ConnectSupabaseView
        onConnected={async (inspected) => {
          setSchema(inspected);
          const restored = await restoreAdminSession().catch(() => null);
          setAdmin(restored);
        }}
      />
    );
  }

  if (!admin) {
    return (
      <AuthView
        schema={schema}
        onSchemaUpdated={setSchema}
        onAuthenticated={async (loggedInAdmin) => {
          try {
            const freshSchema = await inspectSupabaseSchema();
            setSchema(freshSchema);
          } catch {
            // Keep existing probed schema if refresh fails
          }
          setAdmin(loggedInAdmin);
          setActiveSection('dashboard');
        }}
        onChangeConnection={() => {
          clearSavedSupabaseConfig();
          setSchema(null);
          setAdmin(null);
        }}
      />
    );
  }

  return (
    <AdminLayout
      admin={admin}
      activeSection={activeSection}
      breadcrumbDetail={
        activeSection === 'user-details' && selectedUserId ? selectedUserId : undefined
      }
      onNavigate={(section) => {
        if (section !== 'upload-video') setUploadOwner(null);
        if (section === 'users') setUsersQuickFilter('all');
        setActiveSection(section);
      }}
      onLogout={() => void handleLogout()}
    >
      {activeSection === 'dashboard' && (
        <DashboardPage
          schema={schema}
          onNavigate={(section, preset) => {
            if (section === 'users') setUsersQuickFilter(preset ?? 'all');
            setActiveSection(section);
          }}
          onSchemaUpdated={setSchema}
        />
      )}
      {activeSection === 'users' && (
        <UsersPage
          schema={schema}
          initialQuickFilter={usersQuickFilter}
          onSelectUser={handleSelectUser}
          onSchemaUpdated={setSchema}
        />
      )}
      {activeSection === 'user-details' && selectedUserId && (
        <UserDetailsPage
          schema={schema}
          userId={selectedUserId}
          onBack={() => setActiveSection('users')}
          onUploadForUser={(user) => {
            setUploadOwner(user);
            setActiveSection('upload-video');
          }}
        />
      )}
      {activeSection === 'videos' && (
        <VideosPage
          schema={schema}
          onSelectUser={handleSelectUser}
          onNavigateUpload={() => setActiveSection('upload-video')}
          onSchemaUpdated={setSchema}
        />
      )}
      {activeSection === 'upload-video' && (
        <UploadVideoPage
          schema={schema}
          preselectedOwner={uploadOwner}
          onUploaded={(ownerId) => {
            setUploadOwner(null);
            setSelectedUserId(ownerId);
            setActiveSection('user-details');
          }}
        />
      )}
      {activeSection === 'verification' && (
        <VerificationPage schema={schema} onSelectUser={handleSelectUser} />
      )}
      {activeSection === 'reports' && (
        <ReportsPage
          schema={schema}
          onSelectUser={handleSelectUser}
          onSchemaUpdated={setSchema}
        />
      )}
      {activeSection === 'comments' && (
        <CommentsPage schema={schema} onSelectUser={handleSelectUser} />
      )}
      {activeSection === 'categories' && <CategoriesPage schema={schema} />}
      {activeSection === 'storage' && <StoragePage />}
      {activeSection === 'analytics' && (
        <AnalyticsPage schema={schema} onSelectUser={handleSelectUser} />
      )}
      {activeSection === 'admins' && <AdminManagementPage currentAdmin={admin} />}
      {activeSection === 'settings' && (
        <SettingsPage schema={schema} onSchemaUpdated={setSchema} />
      )}
    </AdminLayout>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <BladeAdminShell />
    </ToastProvider>
  );
}
