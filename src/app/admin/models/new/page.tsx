"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useLanguage } from "@/lib/i18n";
import { ModelFormComponent, backendsPayload, type ModelForm } from "../model-form";

export default function NewModelPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

      const res = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast({ title: t("models.createdSuccess") });
        router.push("/admin/models");
      } else {
        const data = await res.json();
        setError(data.error || t("common.error"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/models">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("models.registerModel")}</h1>
          <p className="text-[hsl(var(--muted-foreground))]">
            {t("models.addVllmModel")}
          </p>
        </div>
      </div>
      <ModelFormComponent
        onSubmit={handleSubmit}
        loading={loading}
        error={error}
      />
    </div>
  );
}
