"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  RefreshCw,
  Copy,
  SquareUser,
  Users,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { copyToClipboard } from "@/lib/utils/clipboard";

interface User {
  id: string;
  name: string;
  email: string;
  apiKey: string;
  remark?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: string;
  modelCount: number;
  todayTokens: number;
  todayRequests: number;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

export default function UsersPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);

  const limit = 20;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(search ? { search } : {}),
      });
      const res = await fetch(`/api/admin/users?${params}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(data?.error || "Failed to fetch users");
      }
      setUsers(data.data);
      setTotal(data.total);
    } catch (err) {
      setUsers([]);
      setTotal(0);
      toast({
        title: "Error",
        description:
          err instanceof Error ? err.message : "Failed to fetch users",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [page, search, toast]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete user "${name}"? This action cannot be undone.`))
      return;
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast({ title: "User deleted" });
      fetchUsers();
    } else {
      const d = await res.json();
      toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  };

  const handleRegenerateKey = async (id: string) => {
    if (
      !confirm("Regenerate API key? The old key will stop working immediately.")
    )
      return;
    const res = await fetch(`/api/admin/users/${id}/regenerate-key`, {
      method: "POST",
    });
    if (res.ok) {
      toast({ title: "API key regenerated" });
      fetchUsers();
    }
  };

  const handleCopyKey = async (apiKey: string) => {
    const ok = await copyToClipboard(apiKey);
    toast({
      title: ok ? "API key copied" : "Failed to copy API key",
      variant: ok ? "default" : "destructive",
    });
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm shadow-blue-200 dark:shadow-blue-900/30">
            <Users className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Users</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {total > 0 ? `${total} user${total !== 1 ? "s" : ""} total` : "Manage user accounts and API keys"}
            </p>
          </div>
        </div>
        <Link href="/admin/users/new">
          <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm shadow-blue-200 dark:shadow-blue-900/30 border-0">
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </Link>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            className="pl-9 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus-visible:ring-blue-500"
            placeholder="Search by name or email…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" className="border-slate-200 dark:border-slate-700">
          Search
        </Button>
      </form>

      {/* Table */}
      <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 overflow-hidden bg-white/80 dark:bg-slate-800/60 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50/80 dark:bg-slate-700/40 border-b border-slate-200/60 dark:border-slate-700/60">
              <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Name</th>
              <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Email</th>
              <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">API Key</th>
              <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Status</th>
              <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Models</th>
              <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Today</th>
              <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Group</th>
              <th className="text-right py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-16 text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm">Loading…</span>
                  </div>
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-16 text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <Bot className="h-10 w-10 opacity-30" />
                    <span className="text-sm">No users found</span>
                  </div>
                </td>
              </tr>
            ) : (
              users.map((user, i) => (
                <tr
                  key={user.id}
                  className={`border-b border-slate-100 dark:border-slate-700/40 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors ${
                    i % 2 !== 0 ? "bg-slate-50/30 dark:bg-slate-700/10" : ""
                  }`}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
                      {user.name}
                      {user.isAdmin && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 px-2 py-0.5 rounded-full">
                          <ShieldCheck className="h-3 w-3" /> Admin
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                    {user.email}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5">
                      <code className="text-xs bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 px-2 py-1 rounded-md font-mono max-w-[160px] truncate">
                        {user.apiKey.slice(0, 8) + "••••••••"}
                      </code>
                      <button
                        onClick={() => handleCopyKey(user.apiKey)}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                        title="Copy API key"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                        user.isActive
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-400"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          user.isActive ? "bg-emerald-500" : "bg-slate-400"
                        }`}
                      />
                      {user.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center justify-center min-w-[28px] h-6 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 text-xs font-semibold rounded-md px-2">
                      {user.modelCount}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{formatNum(user.todayRequests)}</span> req /{" "}
                    <span className="font-medium text-slate-700 dark:text-slate-300">{formatNum(user.todayTokens)}</span> tok
                  </td>
                  <td className="py-3 px-4 max-w-[140px] truncate text-xs">
                    {user.groupId ? (
                      <Link
                        href={`/admin/groups/${user.groupId}`}
                        className="text-violet-600 dark:text-violet-400 hover:underline"
                      >
                        {user.groupName || "—"}
                      </Link>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-0.5">
                      <Link href={`/admin/users/${user.id}`}>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Edit"
                          className="h-8 w-8 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      <a href={`/api/admin/users/${user.id}/view-as`}>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="View as user"
                          className="h-8 w-8 text-slate-500 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                        >
                          <SquareUser className="h-3.5 w-3.5" />
                        </Button>
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Regenerate key"
                        onClick={() => handleRegenerateKey(user.id)}
                        className="h-8 w-8 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        onClick={() => handleDelete(user.id, user.name)}
                        className="h-8 w-8 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Showing{" "}
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {(page - 1) * limit + 1}–{Math.min(page * limit, total)}
            </span>{" "}
            of{" "}
            <span className="font-medium text-slate-700 dark:text-slate-300">{total}</span>{" "}
            users
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="h-8 w-8 p-0 border-slate-200 dark:border-slate-700"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-slate-600 dark:text-slate-400 px-2">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="h-8 w-8 p-0 border-slate-200 dark:border-slate-700"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

