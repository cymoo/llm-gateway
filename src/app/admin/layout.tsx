"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Users2,
  Cpu,
  BarChart3,
  ScrollText,
  LogOut,
  Bot,
  Languages,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToastContextProvider } from "@/components/ui/use-toast";
import { useLanguage } from "@/lib/i18n";

function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { t, lang, setLang } = useLanguage();

  const navItems = [
    { href: "/admin/dashboard", label: t("nav.dashboard"), icon: LayoutDashboard },
    { href: "/admin/users", label: t("nav.users"), icon: Users },
    { href: "/admin/groups", label: t("nav.groups"), icon: Users2 },
    { href: "/admin/models", label: t("nav.models"), icon: Cpu },
    { href: "/admin/usage", label: t("nav.usage"), icon: BarChart3 },
    { href: "/admin/audit", label: t("nav.audit"), icon: ScrollText },
  ];

  const handleLogout = async () => {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.push("/admin/login");
  };

  return (
    <div className="flex h-full w-64 flex-col bg-[hsl(var(--sidebar-background))] text-[hsl(var(--sidebar-foreground))]">
      <div className="flex items-center gap-2 px-6 py-5 border-b border-[hsl(var(--sidebar-border))]">
        <Bot className="h-6 w-6 text-[hsl(var(--sidebar-primary))]" />
        <span className="text-lg font-bold">LLM Gateway</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))]"
                  : "text-[hsl(var(--sidebar-foreground))]/80 hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-3 py-4 border-t border-[hsl(var(--sidebar-border))] space-y-1">
        <button
          onClick={() => setLang(lang === "en" ? "zh" : "en")}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[hsl(var(--sidebar-foreground))]/80 hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))] transition-colors"
        >
          <Languages className="h-4 w-4" />
          {t("nav.switchLang")}
        </button>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[hsl(var(--sidebar-foreground))]/80 hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))] transition-colors"
        >
          <LogOut className="h-4 w-4" />
          {t("nav.logout")}
        </button>
      </div>
    </div>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/admin/login";

  if (isLoginPage) {
    return (
      <ToastContextProvider>
        {children}
      </ToastContextProvider>
    );
  }

  return (
    <ToastContextProvider>
      <div className="flex h-screen overflow-hidden bg-[hsl(var(--background))]">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8">{children}</div>
        </main>
      </div>
    </ToastContextProvider>
  );
}
