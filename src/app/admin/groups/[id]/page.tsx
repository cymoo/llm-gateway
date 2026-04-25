"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Users2,
  Plus,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useLanguage } from "@/lib/i18n";

interface Group {
  id: string;
  name: string;
  remark: string | null;
  isDefault: boolean;
  memberCount: number;
}

interface GroupModelRow {
  model: {
    id: string;
    alias: string;
    isActive: boolean;
  };
  quota: {
    maxTokensPerDay: number | null;
    maxRequestsPerDay: number | null;
    maxRequestsPerMin: number | null;
    allowedTimeStart: string | null;
    allowedTimeEnd: string | null;
  } | null;
}

interface AvailableModel {
  id: string;
  alias: string;
}

interface Member {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

interface AllUser {
  id: string;
  name: string;
  email: string;
}

function SectionCard({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-800/60 shadow-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/60">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />}
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">{title}</h2>
        </div>
        {action}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

export default function GroupDetailPage() {
  const params = useParams();
  const { toast } = useToast();
  const { t } = useLanguage();
  const groupId = params.id as string;

  const [group, setGroup] = useState<Group | null>(null);
  const [groupModels, setGroupModels] = useState<GroupModelRow[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [allUsers, setAllUsers] = useState<AllUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [remark, setRemark] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [editingQuota, setEditingQuota] = useState<string | null>(null);
  const [quotaForm, setQuotaForm] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [groupRes, modelsRes, allModelsRes, membersRes, allUsersRes] = await Promise.all([
        fetch(`/api/admin/groups/${groupId}`),
        fetch(`/api/admin/groups/${groupId}/models`),
        fetch("/api/admin/models"),
        fetch(`/api/admin/groups/${groupId}/members`),
        fetch("/api/admin/users?limit=1000"),
      ]);
      if (groupRes.ok) {
        const g = await groupRes.json();
        setGroup(g);
        setName(g.name);
        setRemark(g.remark || "");
      }
      if (modelsRes.ok) setGroupModels(await modelsRes.json());
      if (allModelsRes.ok) setAvailableModels(await allModelsRes.json());
      if (membersRes.ok) setMembers(await membersRes.json());
      if (allUsersRes.ok) {
        const data = await allUsersRes.json();
        setAllUsers(data.data ?? data);
      }
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!group) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/groups/${groupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, remark: remark || null }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("groups.updated") });
        setGroup({ ...group, name: data.name, remark: data.remark });
      } else {
        toast({ title: t("common.error"), description: data.error, variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAddModel = async () => {
    if (!selectedModelId) return;
    const res = await fetch(`/api/admin/groups/${groupId}/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: selectedModelId }),
    });
    if (res.ok) {
      toast({ title: t("groups.modelAddedToGroup") });
      setSelectedModelId("");
      fetchData();
    } else {
      const d = await res.json();
      toast({ title: t("common.error"), description: d.error, variant: "destructive" });
    }
  };

  const handleRemoveModel = async (modelId: string, alias: string) => {
    if (!confirm(t("groups.removeModelConfirm", { alias }))) return;
    const res = await fetch(`/api/admin/groups/${groupId}/models/${modelId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast({ title: t("groups.modelRemovedFromGroup") });
      fetchData();
    }
  };

  const handleAddMember = async () => {
    if (!selectedUserId) return;
    const res = await fetch(`/api/admin/groups/${groupId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selectedUserId }),
    });
    if (res.ok) {
      toast({ title: t("groups.addedToGroup") });
      setSelectedUserId("");
      fetchData();
    } else {
      const d = await res.json();
      toast({ title: t("common.error"), description: d.error, variant: "destructive" });
    }
  };

  const handleRemoveMember = async (userId: string, userName: string) => {
    if (!confirm(t("groups.removeMemberConfirm", { name: userName }))) return;
    const res = await fetch(`/api/admin/groups/${groupId}/members/${userId}`, {
      method: "DELETE",
    });
    if (res.ok || res.status === 204) {
      toast({ title: t("groups.removedFromGroup") });
      fetchData();
    } else {
      const d = await res.json().catch(() => ({}));
      toast({ title: t("common.error"), description: d.error, variant: "destructive" });
    }
  };

  const handleStartEditQuota = (modelId: string, quota: GroupModelRow["quota"]) => {
    setEditingQuota(modelId);
    setQuotaForm({
      maxTokensPerDay: quota?.maxTokensPerDay?.toString() || "",
      maxRequestsPerDay: quota?.maxRequestsPerDay?.toString() || "",
      maxRequestsPerMin: quota?.maxRequestsPerMin?.toString() || "",
      allowedTimeStart: quota?.allowedTimeStart || "",
      allowedTimeEnd: quota?.allowedTimeEnd || "",
    });
  };

  const handleSaveQuota = async (modelId: string) => {
    const body: Record<string, unknown> = {
      maxTokensPerDay: quotaForm.maxTokensPerDay ? parseInt(quotaForm.maxTokensPerDay) : null,
      maxRequestsPerDay: quotaForm.maxRequestsPerDay ? parseInt(quotaForm.maxRequestsPerDay) : null,
      maxRequestsPerMin: quotaForm.maxRequestsPerMin ? parseInt(quotaForm.maxRequestsPerMin) : null,
      allowedTimeStart: quotaForm.allowedTimeStart || null,
      allowedTimeEnd: quotaForm.allowedTimeEnd || null,
    };
    const res = await fetch(`/api/admin/groups/${groupId}/models/${modelId}/quota`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      toast({ title: t("groups.quotaUpdated") });
      setEditingQuota(null);
      fetchData();
    } else {
      const d = await res.json();
      toast({ title: t("common.error"), description: d.error, variant: "destructive" });
    }
  };

  const authorizedModelIds = new Set(groupModels.map((gm) => gm.model.id));
  const unauthorizedModels = availableModels.filter((m) => !authorizedModelIds.has(m.id));

  const memberIds = new Set(members.map((m) => m.id));
  const nonMembers = allUsers.filter((u) => !memberIds.has(u.id));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-2 text-slate-400">
          <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">
            {t("common.loading")}
          </span>
        </div>
      </div>
    );
  }

  if (!group) return <div>Group not found</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/groups">
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm shadow-violet-200 dark:shadow-violet-900/30">
            <Users2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{group.name}</h1>
            <div className="flex items-center gap-2">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {group.memberCount} member{group.memberCount !== 1 ? "s" : ""}
              </p>
              {group.isDefault && (
                <span className="text-xs bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 rounded-full px-2 py-0.5 font-medium">
                  Default
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Group Info */}
      <SectionCard title={t("groups.groupInformation")} icon={Users2}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("common.name")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={group.isDefault}
                placeholder={t("groups.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("groups.remarkOptional")}</Label>
              <Input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder={t("groups.descriptionPlaceholder")}
              />
            </div>
          </div>
          {group.isDefault && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t("groups.defaultNameCannotChange")}
            </p>
          )}
          <Button
            onClick={handleSave}
            disabled={saving || group.isDefault}
            className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white border-0"
          >
            {saving ? t("groups.saving") : t("groups.saveChanges")}
          </Button>
        </div>
      </SectionCard>

      {/* Members */}
      <SectionCard
        title={`${t("groups.members")} (${members.length})`}
        icon={UserPlus}
        action={
          <div className="flex items-center gap-2">
            <SearchableSelect
              value={selectedUserId}
              onChange={setSelectedUserId}
              options={nonMembers.map((u) => ({ value: u.id, label: `${u.name} (${u.email})`, searchText: `${u.name} ${u.email}` }))}
              placeholder={t("groups.selectUser")}
              className="min-w-[200px]"
            />
            <Button
              size="sm"
              onClick={handleAddMember}
              disabled={!selectedUserId}
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white border-0"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              {t("groups.addMember")}
            </Button>
          </div>
        }
      >
        {members.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">{t("groups.noMembers")}</p>
        ) : (
          <div className="rounded-lg border border-slate-200/60 dark:border-slate-700/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-700/40 border-b border-slate-200/60 dark:border-slate-700/60">
                  <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">{t("common.name")}</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">{t("common.email")}</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">{t("common.status")}</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-slate-100 dark:border-slate-700/40 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-medium text-slate-800 dark:text-slate-200">{m.name}</td>
                    <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">{m.email}</td>
                    <td className="py-2.5 px-4">
                      <span className={m.isActive ? "text-green-600 dark:text-green-400" : "text-slate-400"}>
                        {m.isActive ? t("common.active") : t("common.inactive")}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex justify-end">
                        {!group.isDefault && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t("common.remove")}
                            onClick={() => handleRemoveMember(m.id, m.name)}
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
          </div>
        )}
      </SectionCard>

      {/* Model Access */}
      <SectionCard
        title={t("groups.authorizedModels")}
        action={
          group.isDefault ? undefined :
          <div className="flex items-center gap-2">
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500 min-w-[160px]"
            >
              <option value="">{t("groups.selectModel")}</option>
              {unauthorizedModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.alias}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={handleAddModel}
              disabled={!selectedModelId}
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white border-0"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              {t("common.add")}
            </Button>
          </div>
        }
      >
        {group.isDefault && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <span className="mt-0.5 shrink-0">⚠️</span>
            <span>
              Users in the <strong>Default</strong> group use their own individual model access and quota settings, not these group-level settings. The configuration below has no effect.
            </span>
          </div>
        )}
        {groupModels.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">{t("groups.noMembers")}</p>
        ) : (
          <div className="rounded-lg border border-slate-200/60 dark:border-slate-700/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-700/40 border-b border-slate-200/60 dark:border-slate-700/60">
                  <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">{t("models.alias")}</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">{t("groups.tokensDay")}</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">{t("groups.reqDay")}</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">{t("groups.reqMin")}</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">{t("groups.timeWindow")}</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {groupModels.map((gm) => (
                  <React.Fragment key={gm.model.id}>
                    <tr className="border-b border-slate-100 dark:border-slate-700/40 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors">
                      <td className="py-2.5 px-4 font-medium text-slate-800 dark:text-slate-200">
                        {gm.model.alias}
                      </td>
                      {editingQuota === gm.model.id ? (
                        <>
                          <td className="py-2.5 px-4">
                            <Input
                              className="h-7 w-24 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                              placeholder="Unlimited"
                              value={quotaForm.maxTokensPerDay}
                              onChange={(e) => setQuotaForm({ ...quotaForm, maxTokensPerDay: e.target.value })}
                            />
                          </td>
                          <td className="py-2.5 px-4">
                            <Input
                              className="h-7 w-20 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                              placeholder="Unlimited"
                              value={quotaForm.maxRequestsPerDay}
                              onChange={(e) => setQuotaForm({ ...quotaForm, maxRequestsPerDay: e.target.value })}
                            />
                          </td>
                          <td className="py-2.5 px-4">
                            <Input
                              className="h-7 w-16 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                              placeholder="Unlimited"
                              value={quotaForm.maxRequestsPerMin}
                              onChange={(e) => setQuotaForm({ ...quotaForm, maxRequestsPerMin: e.target.value })}
                            />
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="flex gap-1 items-center">
                              <Input
                                className="h-7 w-20 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                                placeholder="HH:MM"
                                value={quotaForm.allowedTimeStart}
                                onChange={(e) => setQuotaForm({ ...quotaForm, allowedTimeStart: e.target.value })}
                              />
                              <span className="text-xs text-slate-400">–</span>
                              <Input
                                className="h-7 w-20 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                                placeholder="HH:MM"
                                value={quotaForm.allowedTimeEnd}
                                onChange={(e) => setQuotaForm({ ...quotaForm, allowedTimeEnd: e.target.value })}
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="flex gap-1 justify-end">
                              <Button
                                size="sm"
                                onClick={() => handleSaveQuota(gm.model.id)}
                                className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white border-0 h-7"
                              >
                                {t("common.save")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingQuota(null)}
                                className="border-slate-200 dark:border-slate-700 h-7"
                              >
                                {t("common.cancel")}
                              </Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">
                            {gm.quota?.maxTokensPerDay?.toLocaleString() || "—"}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">
                            {gm.quota?.maxRequestsPerDay || "—"}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">
                            {gm.quota?.maxRequestsPerMin || "—"}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">
                            {gm.quota?.allowedTimeStart && gm.quota?.allowedTimeEnd
                              ? `${gm.quota.allowedTimeStart}–${gm.quota.allowedTimeEnd}`
                              : "—"}
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="flex gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleStartEditQuota(gm.model.id, gm.quota)}
                                className="h-7 text-slate-500 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                              >
                                {t("common.edit")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveModel(gm.model.id, gm.model.alias)}
                                className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
