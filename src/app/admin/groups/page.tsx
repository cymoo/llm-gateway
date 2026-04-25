"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, Trash2, Pencil, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

interface Group {
  id: string;
  name: string;
  remark: string | null;
  isDefault: boolean;
  memberCount: number;
  createdAt: string;
}

export default function GroupsPage() {
  const { toast } = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRemark, setNewRemark] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/groups");
      if (res.ok) setGroups(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), remark: newRemark || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Group created" });
        setNewName("");
        setNewRemark("");
        setShowCreate(false);
        fetchGroups();
      } else {
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (group: Group) => {
    if (group.isDefault) {
      toast({ title: "Cannot delete the Default group", variant: "destructive" });
      return;
    }
    if (group.memberCount > 0) {
      toast({
        title: "Cannot delete",
        description: `This group has ${group.memberCount} member(s). Reassign them first.`,
        variant: "destructive",
      });
      return;
    }
    if (!confirm(`Delete group "${group.name}"?`)) return;
    const res = await fetch(`/api/admin/groups/${group.id}`, { method: "DELETE" });
    if (res.ok || res.status === 204) {
      toast({ title: "Group deleted" });
      fetchGroups();
    } else {
      const data = await res.json().catch(() => ({}));
      toast({ title: "Error", description: data.error, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm shadow-violet-200 dark:shadow-violet-900/30">
            <Users2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Groups</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Manage user groups and per-model quotas
            </p>
          </div>
        </div>
        <Button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white border-0"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New Group
        </Button>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-800/60 shadow-sm p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">Create Group</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="e.g. Engineering"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="space-y-2">
              <Label>Remark (optional)</Label>
              <Input
                placeholder="Description"
                value={newRemark}
                onChange={(e) => setNewRemark(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white border-0"
            >
              {creating ? "Creating…" : "Create"}
            </Button>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-800/60 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-12 text-slate-400 dark:text-slate-500">No groups yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-700/40 border-b border-slate-200/60 dark:border-slate-700/60">
                <th className="text-left py-3 px-5 font-semibold text-slate-600 dark:text-slate-300">Name</th>
                <th className="text-left py-3 px-5 font-semibold text-slate-600 dark:text-slate-300">Remark</th>
                <th className="text-left py-3 px-5 font-semibold text-slate-600 dark:text-slate-300">Members</th>
                <th className="text-right py-3 px-5 font-semibold text-slate-600 dark:text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr
                  key={g.id}
                  className="border-b border-slate-100 dark:border-slate-700/40 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors"
                >
                  <td className="py-3 px-5 font-medium text-slate-800 dark:text-slate-200">
                    <div className="flex items-center gap-2">
                      {g.name}
                      {g.isDefault && (
                        <span className="text-xs bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 rounded-full px-2 py-0.5 font-medium">
                          Default
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-5 text-slate-500 dark:text-slate-400">
                    {g.remark || "—"}
                  </td>
                  <td className="py-3 px-5 text-slate-500 dark:text-slate-400">
                    {g.memberCount}
                  </td>
                  <td className="py-3 px-5">
                    <div className="flex gap-1 justify-end">
                      <Link href={`/admin/groups/${g.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-slate-500 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Edit
                        </Button>
                      </Link>
                      {!g.isDefault && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(g)}
                          className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
