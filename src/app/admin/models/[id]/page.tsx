"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { ModelFormComponent } from "../new/page";

export default function ModelDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const modelId = params.id as string;

  const [initialForm, setInitialForm] = useState<{
    alias: string;
    backendUrl: string;
    backendModel: string;
    backendApiKey: string;
    isActive: boolean;
    defaultMaxTokensPerDay: string;
    defaultMaxRequestsPerDay: string;
    defaultMaxRequestsPerMin: string;
    defaultAllowedTimeStart: string;
    defaultAllowedTimeEnd: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [error, setError] = useState("");
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/models/${modelId}`)
      .then((r) => r.json())
      .then((data) => {
        setInitialForm({
          alias: data.alias || "",
          backendUrl: data.backendUrl || "",
          backendModel: data.backendModel || "",
          backendApiKey: "",
          isActive: data.isActive ?? true,
          defaultMaxTokensPerDay: data.defaultMaxTokensPerDay?.toString() || "",
          defaultMaxRequestsPerDay: data.defaultMaxRequestsPerDay?.toString() || "",
          defaultMaxRequestsPerMin: data.defaultMaxRequestsPerMin?.toString() || "",
          defaultAllowedTimeStart: data.defaultAllowedTimeStart || "",
          defaultAllowedTimeEnd: data.defaultAllowedTimeEnd || "",
        });
      })
      .finally(() => setFetchLoading(false));
  }, [modelId]);

  const handleSubmit = async (form: typeof initialForm) => {
    if (!form) return;
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        alias: form.alias,
        backendUrl: form.backendUrl,
        backendModel: form.backendModel,
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
      if (form.backendApiKey) body.backendApiKey = form.backendApiKey;

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

  const handleTest = async () => {
    setTestLoading(true);
    try {
      const res = await fetch(`/api/admin/models/${modelId}/test`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.status === "ok") {
        toast({ title: `Connected (${data.latency_ms}ms)` });
      } else {
        toast({
          title: "Connection failed",
          description: data.message,
          variant: "destructive",
        });
      }
    } finally {
      setTestLoading(false);
    }
  };

  if (fetchLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[hsl(var(--muted-foreground))]">Loading...</div>
      </div>
    );
  }

  if (!initialForm) return <div>Model not found</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/models">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Edit Model</h1>
          <p className="text-[hsl(var(--muted-foreground))]">{initialForm.alias}</p>
        </div>
      </div>
      <ModelFormComponent
        initialForm={initialForm}
        onSubmit={handleSubmit}
        loading={loading}
        error={error}
        modelId={modelId}
        onTest={handleTest}
        testLoading={testLoading}
      />
    </div>
  );
}
