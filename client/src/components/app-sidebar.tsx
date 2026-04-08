import { Camera, LayoutDashboard, Users, MapPin, Video, Settings, LogOut, UserCog } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";

const navItems = [
  { title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard },
  { title: "Cameras", url: "/admin/cameras", icon: Camera },
  { title: "Time-lapses", url: "/admin/timelapses", icon: Video },
  { title: "Clientes", url: "/admin/clientes", icon: Users },
  { title: "Contas", url: "/admin/contas", icon: UserCog },
  { title: "Localidades", url: "/admin/localidades", icon: MapPin },
];

export function AppSidebar({ collapsed, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const getInitials = (name?: string | null) => {
    if (!name) return "A";
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  };

  return (
    <aside className={`fixed inset-y-0 left-0 z-30 flex flex-col bg-zinc-950 border-r border-zinc-800/50 transition-all duration-200 ${collapsed ? "w-16" : "w-56"}`}>
      {/* Logo */}
      <div className="h-14 flex items-center px-4 shrink-0">
        <Link href="/admin/dashboard" className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <Camera className="h-4 w-4 text-white" />
          </div>
          {!collapsed && (
            <span className="text-base font-bold text-white tracking-tight truncate">
              Sky<span className="text-blue-400">Lapse</span>
            </span>
          )}
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location === item.url || location.startsWith(item.url + "/");
          return (
            <Link
              key={item.url}
              href={item.url}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-900"
              } ${collapsed ? "justify-center" : ""}`}
              data-testid={`nav-${item.title.toLowerCase()}`}
              title={collapsed ? item.title : undefined}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.title}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer — user */}
      <div className="px-2 pb-3 space-y-1">
        <Link
          href="/admin/configuracoes"
          className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-zinc-900 transition-all ${collapsed ? "justify-center" : ""}`}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Configuracoes</span>}
        </Link>
        <div className={`flex items-center gap-2.5 px-2.5 py-2 ${collapsed ? "justify-center" : ""}`}>
          <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-semibold text-zinc-300 shrink-0">
            {getInitials(user?.nome)}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-300 truncate">{user?.nome || "Admin"}</p>
              <p className="text-[10px] text-zinc-600 truncate">{user?.email}</p>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={() => logout()}
              className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
              data-testid="button-logout"
              title="Sair"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
