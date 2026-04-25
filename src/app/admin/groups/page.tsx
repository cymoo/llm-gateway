"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, Trash2, Pencil, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useLanguage } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Group {
  id: string;
  name: string;
  remark: string | null;
  isDefault: boolean;
  memberCount: number;
  createdAt: string;
}

interface GroupMember {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

export default function GroupsPage() {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRemark, setNewRemark] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<{ id: string; name: string } | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

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

  const openMembersDialog = async (group: Group) => {
    setSelectedGroup({ id: group.id, name: group.name });
    setLoadingMembers(true);
    try {
      const res = await fetch(`/api/admin/groups/${group.id}/members`);
      setGroupMembers(res.ok ? await res.json() : []);
    } finally {
      setLoadingMembers(false);
    }
  };

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
        toast({ title: t("groups.created") });
        setNewName("");
        setNewRemark("");
        setShowCreate(false);
        fetchGroups();
      } else {
        toast({ title: t("common.error"), description: data.error, variant: "destructive" });
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (group: Group) => {
    if (group.isDefault) {
      toast({ title: t("groups.cannotDeleteDefault"), variant: "destructive" });
      return;
    }
    const msg = group.memberCount > 0
      ? t("groups.deleteConfirmWithMembers", { name: group.name, count: group.memberCount })
      : t("groups.deleteConfirm", { name: group.name });
    if (!confirm(msg)) return;
    const res = await fetch(`/api/admin/groups/${group.id}`, { method: "DELETE" });
    if (res.ok || res.status === 204) {
      toast({ title: t("groups.deleted") });
      fetchGroups();
    } else {
      const data = await res.json().catch(() => ({}));
      toast({ title: t("common.error"), description: data.error, variant: "destructive" });
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
            <h1 className="text-2xl font-bold tracking-tight">{t("groups.title")}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t("groups.subtitle")}
            </p>
          </div>
        </div>
        <Button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white border-0"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          {t("groups.newGroup")}
        </Button>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-800/60 shadow-sm p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">{t("groups.createGroup")}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("common.name")}</Label>
              <Input
                placeholder="e.g. Engineering"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("groups.remarkOptional")}</Label>
              <Input
                placeholder={t("groups.descriptionPlaceholder")}
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
              {creating ? t("groups.creating") : t("common.create")}
            </Button>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              {t("common.cancel")}
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
          <div className="text-center py-12 text-slate-400 dark:text-slate-500">{t("groups.noGroups")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-700/40 border-b border-slate-200/60 dark:border-slate-700/60">
                <th className="text-left py-3 px-5 font-semibold text-slate-600 dark:text-slate-300">{t("common.name")}</th>
                <th className="text-left py-3 px-5 font-semibold text-slate-600 dark:text-slate-300">{t("common.remark")}</th>
                <th className="text-left py-3 px-5 font-semibold text-slate-600 dark:text-slate-300">{t("groups.members")}</th>
                <th className="text-right py-3 px-5 font-semibold text-slate-600 dark:text-slate-300">{t("common.actions")}</th>
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
                          {t("common.default")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-5 text-slate-500 dark:text-slate-400">
                    {g.remark || "—"}
                  </td>
                  <td className="py-3 px-5 text-slate-500 dark:text-slate-400">
                    <button
                      type="button"
                      className="text-violet-600 hover:underline dark:text-violet-400"
                      onClick={() => openMembersDialog(g)}
                    >
                      {g.memberCount}
                    </button>
                  </td>
                  <td className="py-3 px-5">
                    <div className="flex gap-1 justify-end">
                      <Link href={`/admin/groups/${g.id}`}>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Edit"
                          className="h-7 w-7 text-slate-500 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      {!g.isDefault && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
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

      <Dialog
        open={selectedGroup !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedGroup(null);
            setGroupMembers([]);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("groups.groupMembers")}</DialogTitle>
            <DialogDescription>
              {selectedGroup ? t("groups.groupLabel", { name: selectedGroup.name }) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("common.email")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingMembers ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-slate-400">
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                ) : groupMembers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-slate-400">
                      {t("groups.noMembers")}
                    </TableCell>
                  </TableRow>
                ) : (
                  groupMembers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell className="text-slate-500">{user.email}</TableCell>
                      <TableCell>
                        <span className={user.isActive ? "text-green-600" : "text-slate-400"}>
                          {user.isActive ? t("common.active") : t("common.inactive")}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
