"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Users, Gamepad2, Trophy, TrendingUp,
  CreditCard, AlertTriangle, Activity, DollarSign
} from "lucide-react";

interface DashboardStats {
  activePlayers: number;
  totalBets24h: number;
  jackpotPools: Array<{ tier: string; currentAmount: number }>;
  pendingWithdrawals: number;
  fraudAlerts: number;
  realtimeConnections: number;
  revenue24h: number;
  newRegistrations24h: number;
}

async function fetchDashboardStats(): Promise<DashboardStats> {
  // In production, call /api/v1/admin/dashboard
  // Mock data for scaffold
  return {
    activePlayers: 1247,
    totalBets24h: 2850000,
    jackpotPools: [
      { tier: "MINI", currentAmount: 4320 },
      { tier: "MAJOR", currentAmount: 78900 },
      { tier: "MEGA", currentAmount: 623000 },
      { tier: "PROGRESSIVE", currentAmount: 2145000 },
    ],
    pendingWithdrawals: 23,
    fraudAlerts: 5,
    realtimeConnections: 892,
    revenue24h: 142500,
    newRegistrations24h: 156,
  };
}

const STAT_CARDS = [
  {
    key: "activePlayers" as keyof DashboardStats,
    label: "Active Players",
    icon: Users,
    color: "from-blue-600 to-cyan-600",
    format: (v: number) => v.toLocaleString(),
  },
  {
    key: "totalBets24h" as keyof DashboardStats,
    label: "Total Bets (24h)",
    icon: Gamepad2,
    color: "from-purple-600 to-pink-600",
    format: (v: number) => `₱${(v / 1000).toFixed(0)}K`,
  },
  {
    key: "revenue24h" as keyof DashboardStats,
    label: "Revenue (24h)",
    icon: DollarSign,
    color: "from-green-600 to-emerald-600",
    format: (v: number) => `₱${(v / 1000).toFixed(0)}K`,
  },
  {
    key: "newRegistrations24h" as keyof DashboardStats,
    label: "New Players (24h)",
    icon: TrendingUp,
    color: "from-amber-600 to-orange-600",
    format: (v: number) => v.toLocaleString(),
  },
  {
    key: "pendingWithdrawals" as keyof DashboardStats,
    label: "Pending Withdrawals",
    icon: CreditCard,
    color: "from-yellow-600 to-amber-600",
    format: (v: number) => v.toLocaleString(),
  },
  {
    key: "fraudAlerts" as keyof DashboardStats,
    label: "Fraud Alerts",
    icon: AlertTriangle,
    color: "from-red-600 to-rose-600",
    format: (v: number) => v.toLocaleString(),
  },
  {
    key: "realtimeConnections" as keyof DashboardStats,
    label: "Live Connections",
    icon: Activity,
    color: "from-cyan-600 to-teal-600",
    format: (v: number) => v.toLocaleString(),
  },
];

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin:dashboard"],
    queryFn: fetchDashboardStats,
    refetchInterval: 15_000,
  });

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black text-white mb-1">
          Admin Dashboard
        </h1>
        <p className="text-gray-400 text-sm">
          ScatterX Enterprise Control Center · Real-time metrics
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STAT_CARDS.map(({ key, label, icon: Icon, color, format }, i) => (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="admin-card"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-400 font-medium">{label}</span>
              <div
                className={`w-8 h-8 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center`}
              >
                <Icon size={14} />
              </div>
            </div>
            <div className={`stat-value bg-gradient-to-r ${color} bg-clip-text text-transparent`}>
              {isLoading
                ? "…"
                : format((stats?.[key] as number) ?? 0)}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Jackpot Pools */}
      <div>
        <h2 className="text-lg font-bold mb-4 text-amber-400">
          🏆 Live Jackpot Pools
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(
            stats?.jackpotPools ?? [
              { tier: "MINI", currentAmount: 0 },
              { tier: "MAJOR", currentAmount: 0 },
              { tier: "MEGA", currentAmount: 0 },
              { tier: "PROGRESSIVE", currentAmount: 0 },
            ]
          ).map(({ tier, currentAmount }) => (
            <div key={tier} className="admin-card text-center">
              <div className="text-xs text-gray-400 mb-1">{tier}</div>
              <div className="text-2xl font-black text-amber-400">
                ₱{currentAmount.toLocaleString("en-PH")}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-bold mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          {[
            { label: "View Fraud Alerts", color: "bg-red-600 hover:bg-red-500", href: "/fraud" },
            { label: "Process Withdrawals", color: "bg-amber-600 hover:bg-amber-500", href: "/payments" },
            { label: "Manage Players", color: "bg-purple-600 hover:bg-purple-500", href: "/players" },
            { label: "AI Insights", color: "bg-cyan-600 hover:bg-cyan-500", href: "/ai" },
          ].map(({ label, color }) => (
            <button
              key={label}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${color}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
