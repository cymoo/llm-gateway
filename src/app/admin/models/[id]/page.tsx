"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  ModelFormComponent,
  backendsPayload,
  type ModelForm,
  type BackendForm,
} from "../new/page";
import { useLanguage } from "@/lib/i18n";

export default function ModelDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useLanguage();
  const modelId = params.id as string;

  const [initialForm, setInitialForm] = useState<ModelForm | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [testingBackendId, setTestingBackendId] = useState<string | null>(null);

  useEffect(() => {
    setFetchLoading(true);
    setLoadError("");
    fetch(`/api/admin/models/${modelId}`)
      .then(async (r) => {
        // Without this guard an error body (e.g. `{ error: "..." }` from a 404,
        // a 401, or a 500 when a migration has not been applied) parses fine,
        // leaving every field undefined — the form would then render blank and
        // look like the model simply had no backends configured.
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(body?.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data) => {
        const backends: BackendForm[] = Array.isArray(data.backends)
          ? data.backends.map(
              (b: {
                id: string;
                backendUrl: string;
                backendModel: string;
                backendApiKey: string | null;
                isActive: boolean | null;
              }) => ({
                id: b.id,
                backendUrl: b.backendUrl || "",
                backendModel: b.backendModel || "",
                backendApiKey: b.backendApiKey || "",
                isActive: b.isActive ?? true,
              })
            )
          : [];
        setInitialForm({
          alias: data.alias || "",
          type: data.type || "chat",
          backends:
            backends.length > 0
              ? backends
              : [
                  {
                    backendUrl: "",
                    backendModel: "",
                    backendApiKey: "",
                    isActive: true,
                  },
                ],
          remark: data.remark || "",
          isActive: data.isActive ?? true,
          defaultMaxTokensPerDay: data.defaultMaxTokensPerDay?.toString() || "",
          defaultMaxRequestsPerDay: data.defaultMaxRequestsPerDay?.toString() || "",
          defaultMaxRequestsPerMin: data.defaultMaxRequestsPerMin?.toString() || "",
          defaultAllowedTimeStart: data.defaultAllowedTimeStart || "",
          defaultAllowedTimeEnd: data.defaultAllowedTimeEnd || "",
        });
      })
      .catch((err: unknown) => {
        setInitialForm(null);
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setFetchLoading(false));
  }, [modelId]);

  const handleSubmit = async (form: ModelForm) => {
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        alias: form.alias,
        type: form.type,
        backends: backendsPayload(form.backends),
        remark: form.remark || null,
        isActive: form.isActive,
        defaultMaxTokensPerDay: form.defaultMaxTokensPerDay
          ? parseInt(form.defaultMaxTokensPerDay)
          : null,
        defaultMaxRequestsPerDay: form.defaultMaxRequestsPerDay
          ? parseInt(form.defaultMaxRequestsPerDay)
          : null,
        defaultMaxRequestsPerMin: form.defaultMaxRequestsPerMin
          ? parseInt(form.defaultMaxRequestsPerMin)
          : null,
        defaultAllowedTimeStart: form.defaultAllowedTimeStart || null,
        defaultAllowedTimeEnd: form.defaultAllowedTimeEnd || null,
      };

      const res = await fetch(`/api/admin/models/${modelId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast({ title: "Model updated successfully" });
        router.push("/admin/models");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to update model");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTestBackend = async (backendId: string) => {
    setTestingBackendId(backendId);
    try {
      const res = await fetch(`/api/admin/models/${modelId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backendId }),
      });
      const data = await res.json();
      const result = data.results?.[0];
      if (result?.status === "ok") {
        toast({ title: t("models.connected", { ms: result.latency_ms }) });
      } else {
        toast({
          title: t("models.connectionFailed"),
          description: result?.message ?? data.error,
          variant: "destructive",
        });
      }
    } finally {
      setTestingBackendId(null);
    }
  };

  if (fetchLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[hsl(var(--muted-foreground))]">{t("common.loading")}</div>
      </div>
    );
  }

  if (!initialForm) {
    return (
      <div className="space-y-4 max-w-2xl">
        <div className="flex items-center gap-4">
          <Link href="/admin/models">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">{t("models.editModel")}</h1>
        </div>
        <p className="text-sm text-[hsl(var(--destructive))]">
          {t("models.loadFailed")}
          {loadError ? `: ${loadError}` : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/models">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("models.editModel")}</h1>
          <p className="text-[hsl(var(--muted-foreground))]">{initialForm.alias}</p>
        </div>
      </div>
      <ModelFormComponent
        initialForm={initialForm}
        onSubmit={handleSubmit}
        loading={loading}
        error={error}
        modelId={modelId}
        onTestBackend={handleTestBackend}
        testingBackendId={testingBackendId}
      />
    </div>
  );
}
