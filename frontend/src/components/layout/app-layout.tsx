import { useState } from 'react';
import {
  Gavel,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/components/layout/theme-provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/grupos', label: 'Grupos', icon: Users, end: false },
  { to: '/leiloes', label: 'Leilões', icon: Gavel, end: false },
  { to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, end: false },
];

/**
 * Layout principal autenticado: sidebar + header + conteúdo.
 * Mobile-first: a sidebar vira um drawer.
 */
export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/login');
  }

  const sidebar = (
    <div className="flex h-full flex-col gap-2 p-4">
      <div className="mb-4 flex items-center gap-2 px-2">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Gavel className="size-5" />
        </div>
        <span className="text-lg font-semibold tracking-tight">BotLeilão</span>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              )
            }
          >
            <item.icon className="size-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto rounded-lg border bg-card p-3 text-xs">
        <p className="font-medium text-card-foreground">{user?.name}</p>
        <p className="truncate text-muted-foreground">{user?.email}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar text-sidebar-foreground lg:block">
        {sidebar}
      </aside>

      {/* Sidebar mobile (drawer) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
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

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </Button>

          <h1 className="text-sm font-medium lg:text-base">Painel de Leilões</h1>

          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Alternar tema">
              {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void handleLogout()}
              aria-label="Sair"
            >
              <LogOut className="size-5" />
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
