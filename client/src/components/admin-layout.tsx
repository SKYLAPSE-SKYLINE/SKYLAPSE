import { useState } from "react";
import { useLocation } from "wouter";
import { AppSidebar } from "@/components/app-sidebar";
import { Menu } from "lucide-react";

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
  breadcrumbs?: { label: string; href?: string }[];
}

export function AdminLayout({ children, title }: AdminLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-zinc-950 dark">
      <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />

      <div className={`transition-all duration-200 ${collapsed ? "ml-16" : "ml-56"}`}>
        {/* Top bar */}
        <header className="sticky top-0 z-20 h-14 flex items-center gap-4 px-6 backdrop-blur-xl bg-zinc-950/80 border-b border-zinc-800/50">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-zinc-500 hover:text-white transition-colors"
            data-testid="button-sidebar-toggle"
          >
            <Menu className="h-5 w-5" />
          </button>
          {title && (
            <h1 className="text-sm font-semibold text-white">{title}</h1>
          )}
        </header>

        <main
          key={location}
          className="p-6 lg:p-8 2xl:p-10 animate-in fade-in-0 slide-in-from-bottom-2 duration-500 ease-out"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
