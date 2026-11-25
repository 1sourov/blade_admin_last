import React, { useEffect, useRef, useState } from 'react';
import {
  BadgeCheck,
  BarChart3,
  Film,
  Flag,
  FolderKanban,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  Shield,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type { AdminRecord, NavSection } from '../types/blade';

interface AdminLayoutProps {
  admin: AdminRecord;
  activeSection: NavSection;
  breadcrumbDetail?: string;
  onNavigate: (section: NavSection) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'videos', label: 'Videos', icon: Film },
  { id: 'upload-video', label: 'Upload Video', icon: Upload },
  { id: 'verification', label: 'Verification', icon: BadgeCheck },
  { id: 'reports', label: 'Reports', icon: Flag },
  { id: 'comments', label: 'Comments', icon: MessageSquare },
  { id: 'categories', label: 'Categories', icon: FolderKanban },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'admins', label: 'Admin Management', icon: Shield },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function AdminLayout({
  admin,
  activeSection,
  breadcrumbDetail,
  onNavigate,
  onLogout,
  children,
}: AdminLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  const sectionLabel =
    activeSection === 'user-details'
      ? 'Users'
      : NAV_ITEMS.find((i) => i.id === activeSection)?.label ?? 'Dashboard';

  // Reset independent main scroll container when navigating between sections
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [activeSection, breadcrumbDetail]);

  // Close mobile/tablet drawer on Escape key
  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen]);

  const handleNavClick = (id: NavSection) => {
    onNavigate(id);
    setMobileOpen(false);
  };

  const sidebarContent = (
    <div className="h-full w-full flex flex-col bg-zinc-950 text-white select-none overflow-hidden">
      <div className="px-5 h-16 flex items-center justify-between border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src="/assets/aistudio/Bold_Red_Geometric_B_Logo_701917dd.png"
            alt="BLADE"
            className="w-8 h-8 rounded object-cover shrink-0"
          />
          <span className="font-display font-bold tracking-tight text-sm text-white truncate">
            BLADE ADMIN PANEL
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1.5 text-zinc-400 hover:text-white rounded-md"
          aria-label="Close sidebar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            activeSection === item.id ||
            (item.id === 'users' && activeSection === 'user-details');
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-red-600 text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-zinc-800 shrink-0">
        <div className="px-3 py-2 mb-2">
          <div className="text-xs font-semibold text-white truncate">{admin.username}</div>
          <div className="text-[11px] text-zinc-400 truncate">{admin.email}</div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-screen h-dvh w-full overflow-hidden bg-white text-zinc-950 flex">
      {/* Desktop Fixed Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:w-64 border-r border-zinc-800 bg-zinc-950">
        {sidebarContent}
      </aside>

      {/* Mobile & Tablet Collapsible Drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full w-64 max-w-[85vw] border-r border-zinc-800 shadow-2xl">
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main Content Column (scrolls independently of the fixed sidebar) */}
      <div className="flex-1 min-w-0 w-full lg:pl-64 flex flex-col h-full overflow-hidden">
        <header className="h-16 shrink-0 bg-white border-b border-zinc-200 px-4 sm:px-6 flex items-center justify-between gap-3 sm:gap-6 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 text-zinc-700 hover:text-zinc-950 rounded-md shrink-0"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline font-semibold text-zinc-500 whitespace-nowrap">
                BLADE
              </span>
              <span className="hidden sm:inline text-zinc-300" aria-hidden="true">
                /
              </span>
              <span className="font-bold text-zinc-950 truncate">{sectionLabel}</span>
              {breadcrumbDetail && (
                <>
                  <span className="text-zinc-300 shrink-0" aria-hidden="true">
                    /
                  </span>
                  <span className="text-zinc-600 font-mono text-xs truncate">
                    {breadcrumbDetail}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('upload-video')}
              className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Video</span>
            </button>
          </div>
        </header>

        <main
          ref={mainRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain p-4 sm:p-6 lg:p-8 bg-zinc-50/50"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
