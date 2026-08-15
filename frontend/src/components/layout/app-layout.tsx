import { useState } from 'react';
import {
  Gavel,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { SubscriptionGate } from '@/components/layout/subscription-gate';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/painel', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/painel/grupos', label: 'Grupos', icon: Users, end: false },
  { to: '/painel/leiloes', label: 'Leilões', icon: Gavel, end: false },
  { to: '/painel/whatsapp', label: 'WhatsApp', icon: MessageCircle, end: false },
  { to: '/painel/seguranca', label: 'Segurança', icon: ShieldCheck, end: false },
];

function initials(name: string | undefined): string {
  if (!name) return 'U';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/**
 * Layout principal autenticado: sidebar + header + conteúdo.
 * Mobile-first: a sidebar vira um drawer.
 */
export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/');
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
          <Gavel className="size-5" />
        </div>
        <div className="leading-tight">
          <span className="block text-lg font-semibold tracking-tight">BotLeilão</span>
          <span className="block text-xs text-muted-foreground">Painel de leilões</span>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Visão geral
        </p>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary transition-opacity',
                    isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-40',
                  )}
                />
                <item.icon className="size-4" />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mx-3 mb-3 flex items-center gap-3 rounded-xl border bg-card/60 p-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {initials(user?.name)}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-card-foreground">{user?.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          onClick={() => void handleLogout()}
          aria-label="Sair"
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-64 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklch,var(--primary)_8%,transparent),transparent)]"
      />

      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar text-sidebar-foreground lg:block">
        {sidebar}
      </aside>

      {/* Sidebar mobile (drawer) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r bg-sidebar text-sidebar-foreground shadow-xl">
            <button
              aria-label="Fechar menu"
              className="absolute right-3 top-3 rounded-md p-1 hover:bg-sidebar-accent"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="relative lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-lg lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </Button>

          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
              <Gavel className="size-4" />
            </div>
            <span className="text-sm font-semibold">BotLeilão</span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <div className="ml-1 hidden items-center gap-2 border-l pl-3 sm:flex">
              <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initials(user?.name)}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => void handleLogout()}
              >
                <LogOut className="size-4" />
                Sair
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl p-4 lg:p-8">
          <SubscriptionGate>
            <Outlet />
          </SubscriptionGate>
        </main>
      </div>
    </div>
  );
}