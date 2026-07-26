"use client";

import Link from 'next/link';
import { AppLogo } from './AppLogo';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from 'next-themes';
import {
  ChevronDown,
  Sun, Moon,
  X, HelpCircle,
  Menu, User as UserIcon, ChevronRight,
  Settings
} from 'lucide-react';
import { MdAssistant } from "react-icons/md";
import {
  SiGmail,
  SiGooglecalendar,
  SiGoogledocs,
  SiGooglesheets,
  SiGoogleslides,
  SiGoogleforms,
  SiGoogledrive,
  SiGoogletasks
} from 'react-icons/si';
import { FaGoogle } from 'react-icons/fa6';
import { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/store/workspaceStore';

const HelpGuide = dynamic(() => import('./HelpGuide'), { ssr: false });

const NAV = [
  {
    href: '/chat',
    label: 'Chat',
    icon: MdAssistant,
    submenu: null,
  },
  {
    href: '/workspace',
    label: 'Workspaces',
    icon: FaGoogle,
    submenu: [
      {
        href: '/workspace/inbox',
        label: 'Smart Inbox',
        icon: SiGmail,
        color: 'text-[#EA4335]',
        desc: 'Read, reply, and manage your emails with AI',
      },
      {
        href: '/workspace/calendar',
        label: 'Smart Calendar',
        icon: SiGooglecalendar,
        color: 'text-[#4285F4]',
        desc: 'Schedule meetings and track your day',
      },
      {
        href: '/workspace/docs',
        label: 'Smart Docs',
        icon: SiGoogledocs,
        color: 'text-[#4285F4]',
        desc: 'Manage and search your Google Documents',
      },
      {
        href: '/workspace/sheets',
        label: 'Smart Sheets',
        icon: SiGooglesheets,
        color: 'text-[#34A853]',
        desc: 'Analyze and manage your spreadsheets',
      },
      {
        href: '/workspace/slides',
        label: 'Smart Slides',
        icon: SiGoogleslides,
        color: 'text-[#FBBC05]',
        desc: 'Manage your AI-enhanced presentations',
      },
      {
        href: '/workspace/forms',
        label: 'Smart Forms',
        icon: SiGoogleforms,
        color: 'text-[#7248B9]',
        desc: 'View and manage your Google Forms',
      },
      {
        href: '/workspace/tasks',
        label: 'Smart Tasks',
        icon: SiGoogletasks,
        color: 'text-[#4285F4]',
        desc: 'Stay on top of your daily checklist',
      },
      {
        href: '/workspace/drive',
        label: 'Cloud Drive',
        icon: SiGoogledrive,
        color: 'text-[#34A853]',
        desc: 'Access your entire Google Drive library',
      },
    ],
  },
] as const;

function ThemeToggleIcon() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex w-[30px] h-[30px] rounded-[8px] border-[0.5px] border-border bg-transparent cursor-pointer items-center justify-center text-muted transition-colors shrink-0 hover:bg-surface"
    >
      {theme === 'dark'
        ? <Moon className="w-[14px] h-[14px]" />
        : <Sun className="w-[14px] h-[14px]" />}
    </button>
  );
}

function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <div className=''>
      {open ? <X /> : <Menu />}
    </div>
  );
}

export default function Header() {
  const { user, logout, preferences } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const workspaceStore = useWorkspaceStore();

  const handlePrefetch = useCallback((href: string) => {
    if (!user?.email) return;
    const email = user.email;

    // Debounce/Rate-limit or check loaded state
    if (href === '/workspace/inbox') {
      if (!workspaceStore.inboxLoaded) workspaceStore.fetchInboxOnly(email);
    } else if (href === '/workspace/calendar') {
      workspaceStore.loadEvents(email, workspaceStore.currentDate || new Date());
    } else if (href === '/workspace/docs') {
      if (!workspaceStore.docsLoaded) workspaceStore.fetchDocs(email);
    } else if (href === '/workspace/tasks') {
      if (!workspaceStore.tasksLoaded) workspaceStore.fetchTasks(email);
    } else if (href === '/workspace/sheets') {
      if (!workspaceStore.initialLoadDone['sheets']) workspaceStore.fetchAssets(email, 'sheets');
    } else if (href === '/workspace/slides') {
      if (!workspaceStore.initialLoadDone['slides']) workspaceStore.fetchAssets(email, 'slides');
    } else if (href === '/workspace/forms') {
      if (!workspaceStore.initialLoadDone['forms']) workspaceStore.fetchAssets(email, 'forms');
    } else if (href === '/workspace/drive') {
      if (!workspaceStore.initialLoadDone['drive']) workspaceStore.fetchAssets(email, 'drive');
    }
  }, [user?.email, workspaceStore]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    setOpenMenu(null);
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileNavOpen]);

  const userInitial = user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? 'U';

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-[54px] bg-background border-b border-border/60 flex items-center px-[14px] shrink-0">
        <div className="flex-1 flex items-center">
          <Link href="/chat" className="flex flex-col items-center shrink-0 no-underline mr-[14px] gap-0.5">
            <AppLogo width={48} height={48} className="h-8 w-auto" />
            <span className="text-[13px] font-black text-foreground tracking-wide leading-none">AutoDeskAI</span>
          </Link>
        </div>

        <nav ref={navRef} className="hidden md:flex gap-2 font-semibold">
          {NAV.map((item) => {
            const isActive = pathname === item.href ||
              (item.href !== '/chat' && pathname?.startsWith(item.href)) ||
              (!!item.submenu && item.submenu.some(sub => sub.href && pathname?.startsWith(sub.href)));
            const isOpen = openMenu === item.label;
            const Icon = item.icon;

            return (
              <div key={item.label} className="relative">
                {item.submenu ? (
                  <>
                    <button
                      onClick={() => setOpenMenu(isOpen ? null : item.label)}
                      className={cn(
                        "px-[13px] py-[6px] text-[13px] group rounded-[8px] cursor-pointer border-none flex items-center gap-[6px] transition-all whitespace-nowrap",
                        isActive || isOpen ? "text-white bg-primary" : "text-muted bg-surface hover:text-foreground"
                      )}
                    >
                      {Icon && <Icon className="w-3 h-3" />}
                      {item.label}
                      <ChevronDown className={cn("w-[12px] h-[12px] text-muted group-hover:text-foreground stroke-3 transition-transform duration-200", (isActive || isOpen) && "rotate-180 text-white")} />
                    </button>

                    {isOpen && (
                      <div className="absolute top-[calc(100%+6px)] -translate-x-1/2 left-1/2 w-[480px] rounded-[14px] border border-border-light bg-background shadow-[0_20px_50px_rgba(0,0,0,0.2)] overflow-hidden z-[100] p-1.5 grid grid-cols-2 gap-1">
                        {item.submenu.map((sub) => {
                          const subActive = sub.href && pathname?.startsWith(sub.href);
                          return (
                            <Link
                              key={sub.label}
                              href={sub.href}
                              onMouseEnter={() => handlePrefetch(sub.href)}
                              onClick={() => setOpenMenu(null)}
                              className={cn(
                                "flex items-start gap-2.5 p-2.5 rounded-xl no-underline transition-all duration-200 group/sub",
                                subActive ? "bg-surface shadow-sm" : "bg-transparent hover:bg-surface/60"
                              )}
                            >
                              <div className={cn(
                                "w-8 h-8 rounded-lg shrink-0 flex items-center justify-center transition-colors",
                                subActive ? "bg-background" : "bg-surface group-hover/sub:bg-background"
                              )}>
                                <sub.icon className={cn("w-4 h-4", sub.color)} />
                              </div>
                              <div className="min-w-0">
                                <p className={cn("text-[13px] font-bold m-0 leading-tight transition-colors", subActive ? "text-primary" : "text-foreground")}>{sub.label}</p>
                                <p className="text-[10px] text-muted m-0.5 leading-tight line-clamp-1 group-hover/sub:text-muted/80">{sub.desc}</p>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <Link
                    id={item.href === '/chat' ? 'dashboard-nav-link' : undefined}
                    href={item.href}
                    className={cn(
                      "px-[13px] py-[6px] text-[13px] rounded-[8px] cursor-pointer  flex items-center gap-[6px] transition-all whitespace-nowrap",
                      isActive ? "text-white bg-primary" : "text-muted bg-surface hover:text-foreground"
                    )}
                  >
                    {Icon && <Icon className="w-3.5 h-3.5" />}
                    {item.label}
                  </Link>
                )}
              </div>
            );
          })}
        </nav>

        <div className="flex-1 flex items-center justify-end gap-[6px]">
          {user && <ThemeToggleIcon />}
          <div ref={profileRef} className="hidden md:block relative">
            <button
              id="profile-menu-btn"
              onClick={() => setProfileOpen(o => !o)}
              className={cn("flex items-center gap-2 px-2 py-1 rounded-lg transition-all duration-200 select-none", profileOpen ? "bg-surface border-border-light shadow-sm" : "bg-transparent hover:bg-surface border-transparent")}
              style={{ border: '0.5px solid var(--border)' }}
            >
              <div className="w-[20px] h-[20px] rounded-full bg-primary-hover flex items-center justify-center border border-primary/20 shrink-0">
                <UserIcon className="w-3.5 h-3.5 text-[#f3f0ff]" />
              </div>
              <span className="text-[13px] font-medium text-foreground max-w-[120px] truncate">{user?.name || user?.email?.split('@')[0]}</span>
              <ChevronDown className={cn("w-3.5 h-3.5 text-muted transition-transform duration-200", profileOpen && "rotate-180")} />
            </button>

            {profileOpen && (
              <div className="absolute top-[calc(100%+8px)] right-0 w-[200px] rounded-[10px] bg-background shadow-[0_8px_24px_rgba(0,0,0,0.12)] overflow-hidden z-[100] p-[6px]">
                <div className="p-[8px_10px_8px]">
                  <p className="text-[12px] font-semibold text-foreground m-0 overflow-hidden text-ellipsis whitespace-nowrap">{user?.name || user?.email}</p>
                  <p className="text-[11px] text-muted m-[2px_0_0] overflow-hidden text-ellipsis whitespace-nowrap">{user?.email}</p>
                </div>
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    window.dispatchEvent(new CustomEvent('open-help-guide'));
                  }}
                  className="flex items-center gap-[8px] p-[7px_10px] rounded-[7px] w-full bg-transparent border-none cursor-pointer text-left transition-colors mb-[2px] hover:bg-surface"
                >
                  <HelpCircle className="w-[13px] h-[13px] text-muted shrink-0" />
                  <span className="text-[12px] font-medium text-foreground">User Guide</span>
                </button>
                <Link
                  href="/settings"
                  id="settings-nav-link"
                  onClick={() => setProfileOpen(false)}
                  className={cn(
                    "flex items-center gap-[8px] p-[7px_10px] rounded-[7px] w-full no-underline transition-colors mb-[2px]",
                    pathname?.startsWith('/settings') ? "bg-primary/10 text-primary" : "bg-transparent text-foreground hover:bg-surface"
                  )}
                >
                  <Settings className={cn("w-[13px] h-[13px] shrink-0", pathname?.startsWith('/settings') ? "text-primary" : "text-muted")} />
                  <span className="text-[12px] font-medium">Settings</span>
                </Link>
                <button onClick={() => { setProfileOpen(false); logout(); router.push('/'); }} className="flex items-center gap-[8px] p-[7px_10px] rounded-[7px] w-full bg-transparent border-none cursor-pointer text-left transition-colors  hover:bg-red-500/8">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                  <span className="text-[12px] font-medium text-[#F87171]">Sign out</span>
                </button>
              </div>
            )}
          </div>
          {user && (
            <button className="flex md:hidden w-[30px] h-[30px] items-center justify-center border-none bg-transparent cursor-pointer" onClick={() => setMobileNavOpen(o => !o)} aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}>
              <HamburgerIcon open={mobileNavOpen} />
            </button>
          )}
        </div>
      </header>

      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-[49] bg-background flex flex-col pt-[54px] border-t border-border">
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {NAV.map((item) => {
              const isActive = pathname === item.href ||
                (item.href !== '/chat' && pathname?.startsWith(item.href)) ||
                (!!item.submenu && item.submenu.some(sub => sub.href && pathname?.startsWith(sub.href)));
              const Icon = item.icon;
              const isExpanded = mobileExpanded === item.label;

              if (item.submenu) {
                return (
                  <div key={item.label} className="space-y-1">
                    <button onClick={() => setMobileExpanded(isExpanded ? null : item.label)} className="flex items-center justify-between w-full p-3 rounded-xl bg-surface/50 border border-border/10 transition-all">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Icon className="w-4 h-4 text-primary" />
                        </div>
                        <span className="text-[14px] font-bold text-foreground tracking-wider">{item.label}</span>
                      </div>
                      <ChevronRight className={cn("w-4 h-4 text-muted transition-transform duration-200", isExpanded && "rotate-90")} />
                    </button>
                    {isExpanded && (
                      <div className="pl-2 space-y-1 mt-1">
                        {item.submenu.map((sub) => {
                          const subActive = sub.href && pathname?.startsWith(sub.href);
                          return (
                            <Link 
                                key={sub.label} 
                                href={sub.href} 
                                onMouseEnter={() => handlePrefetch(sub.href)}
                                onClick={() => setMobileNavOpen(false)} 
                                className={cn("flex items-center gap-3 p-3 rounded-xl transition-all", subActive ? "bg-primary/5 border border-primary/10" : "hover:bg-surface")}
                            >
                              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-border/20 bg-background")}>
                                <sub.icon className={cn("w-4 h-4", sub.color)} />
                              </div>
                              <div className="min-w-0">
                                <p className={cn("text-[13px] font-bold m-0", subActive ? "text-primary" : "text-foreground")}>{sub.label}</p>
                                <p className="text-[10px] text-muted m-0 line-clamp-1">{sub.desc}</p>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <Link key={item.label} href={item.href} onClick={() => setMobileNavOpen(false)} className={cn("flex items-center gap-3 p-3 rounded-xl transition-all border", isActive ? "bg-primary/10 border-primary/20 text-primary" : "bg-surface/50 border-transparent text-foreground hover:bg-surface")}>
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-border/20", isActive ? "bg-primary/20 text-primary" : "bg-surface text-muted")}>
                    {Icon && <Icon className="w-4 h-4" />}
                  </div>
                  <span className="text-[14px] font-bold tracking-wider">{item.label}</span>
                </Link>
              );
            })}
          </div>

          {user && (
            <div className="p-4 border-t border-border bg-surface/20 mt-auto">
              <div className="space-y-1 mb-4">
                <button 
                  onClick={() => { 
                    setMobileNavOpen(false); 
                    window.dispatchEvent(new CustomEvent('open-help-guide'));
                  }} 
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface transition-all w-full text-left bg-transparent border-none cursor-pointer group"
                >
                  <HelpCircle className="w-4 h-4 text-muted group-hover:text-foreground transition-colors" />
                  <span className="text-sm font-medium text-foreground">User Guide</span>
                </button>
                <Link
                  href="/settings"
                  id="settings-nav-link-mobile"
                  onClick={() => setMobileNavOpen(false)}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-xl transition-all group",
                    pathname?.startsWith('/settings') ? "bg-primary/10 text-primary" : "hover:bg-surface text-foreground"
                  )}
                >
                  <Settings className={cn("w-4 h-4 transition-colors", pathname?.startsWith('/settings') ? "text-primary" : "text-muted group-hover:text-foreground")} />
                  <span className="text-sm font-medium">Settings</span>
                </Link>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-background border border-border/50 mb-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold shrink-0">
                  {userInitial}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground truncate m-0">{user?.name || user?.email?.split('@')[0]}</p>
                  <p className="text-[11px] text-muted truncate m-0">{user?.email}</p>
                </div>
              </div>

              <button
                onClick={() => { logout(); setMobileNavOpen(false); router.push('/'); }}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-red-500/5 text-red-500 font-bold text-sm border border-red-500/10 hover:bg-red-500/10 transition-all cursor-pointer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
      <div className="h-[54px]" />
      <HelpGuide customTrigger={() => null} />
    </>
  );
}