import { validateUrl } from "@/lib/utils/validators";

export interface BackendInput {
  id?: string;
  backendUrl: string;
  backendModel: string;
  backendApiKey: string | null;
  isActive: boolean;
}

/**
 * Validate an explicit `backends` array from an admin request body.
 * Entries carrying an `id` refer to existing model_backends rows (kept stable
 * so per-backend test results and audit diffs stay meaningful).
 */
export function parseBackendsArray(
  raw: unknown
): { backends: BackendInput[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "backends must be a non-empty array" };
  }
  const backends: BackendInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return { error: "Each backend must be an object" };
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.backendUrl !== "string" || !validateUrl(e.backendUrl)) {
      return { error: "Each backend requires a valid backendUrl" };
    }
    if (
      typeof e.backendModel !== "string" ||
      e.backendModel.length === 0 ||
      e.backendModel.length > 200
    ) {
      return { error: "Each backend requires a backendModel (1-200 chars)" };
    }
    if (e.isActive !== undefined && typeof e.isActive !== "boolean") {
      return { error: "Backend isActive must be a boolean" };
    }
    backends.push({
      id: typeof e.id === "string" ? e.id : undefined,
      backendUrl: e.backendUrl,
      backendModel: e.backendModel,
      backendApiKey:
        typeof e.backendApiKey === "string" && e.backendApiKey !== ""
          ? e.backendApiKey
          : null,
      isActive: e.isActive ?? true,
    });
  }
  return { backends };
}
