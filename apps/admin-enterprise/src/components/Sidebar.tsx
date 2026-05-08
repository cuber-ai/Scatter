"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users, Gamepad2, Trophy, AlertTriangle,
  CreditCard, Activity, Share2, BarChart3,
  Settings, Shield, Bell, LogOut
} from "lucide-react";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: BarChart3 },
  { label: "Players", href: "/players", icon: Users },
  { label: "Game Engine", href: "/game", icon: Gamepad2 },
  { label: "Jackpots", href: "/jackpot", icon: Trophy },
  { label: "Payments", href: "/payments", icon: CreditCard },
  { label: "Fraud Center", href: "/fraud", icon: AlertTriangle },
  { label: "Affiliates", href: "/affiliates", icon: Share2 },
  { label: "Realtime", href: "/realtime", icon: Activity },
  { label: "AI Insights", href: "/ai", icon: Bell },
  { label: "Security", href: "/security", icon: Shield },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 flex-shrink-0 glass border-r border-white/10 flex flex-col h-full">
      {/* Logo */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center font-black text-lg neon-glow-purple">
            X
          </div>
          <div>
            <div className="font-black text-white">ScatterX</div>
            <div className="text-xs text-purple-400">Admin Console</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`nav-item ${pathname === href ? "active" : ""}`}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-white/10">
        <button className="nav-item w-full text-red-400 hover:text-red-300 hover:bg-red-500/10">
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
