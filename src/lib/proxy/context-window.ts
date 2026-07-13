// Discovers a model's context window from an upstream OpenAI-compatible
// `GET {backendUrl}/models` response and caches it per backend. Used to enrich
// the gateway's own `/v1/models` output, which is otherwise built purely from
// the local DB and carries no window. Enrichment is best-effort: any failure
// (unreachable backend, missing field, bad payload) degrades to no window.

// Fields that carry a context window on a `GET /models` entry, most specific
// first. The *served* window beats the model's theoretical maximum: vLLM's
// `max_model_len` already reflects `--max-model-len`, and OpenRouter's
// `top_provider.context_length` reflects the provider it actually routes to,
// which can be lower than the model-level number.
export const WINDOW_FIELDS = [
  "max_model_len", // vLLM, SGLang
  "context_window", // Groq
  "max_input_tokens", // Anthropic Models API (since 2026-03), LiteLLM proxies
  "loaded_context_length", // LM Studio (/api/v0 only; harmless to accept)
  "context_length", // OpenRouter (model-level), Together
  "max_context_length", // LM Studio (theoretical max)
] as const;

const CACHE_TTL_MS = parseInt(
  process.env.MODELS_WINDOW_CACHE_TTL_MS || "300000"
);
const FETCH_TIMEOUT_MS = parseInt(
  process.env.MODELS_WINDOW_FETCH_TIMEOUT_MS || "10000"
);

/**
 * Read the first present, positive context-window value from an upstream
 * `GET /models` entry, scanning {@link WINDOW_FIELDS} most-specific first.
 * Accepts a number or a numeric string; returns `undefined` when no field
 * holds a usable value.
 */
export function extractContextWindow(
  entry: Record<string, unknown>
): number | undefined {
  for (const field of WINDOW_FIELDS) {
    const value = coercePositiveInt(entry[field]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function coercePositiveInt(raw: unknown): number | undefined {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n === "number" && Number.isFinite(n) && n > 0) {
    return Math.floor(n);
  }
  return undefined;
}

type WindowMap = Map<string, number>;

// Keyed by normalized backendUrl. The stored value is the in-flight/settled
// promise so concurrent callers share a single probe. `fetchWindows` never
// rejects, so a cached promise never carries a rejection.
const cache = new Map<string, { expires: number; promise: Promise<WindowMap> }>();

/**
 * Return a map of backend model id -> context window for `{backendUrl}/models`,
 * for every entry that advertises one. Results (including the empty maps of
 * unreachable or window-less backends) are cached per backend for
 * `MODELS_WINDOW_CACHE_TTL_MS`; concurrent callers share one in-flight request.
 * Never throws — a missing/empty `backendUrl` or a failed probe yields an empty
 * map, so callers can treat "no window" and "probe failed" identically.
 */
export function getBackendContextWindows(
  backendUrl: string | null | undefined,
  backendApiKey?: string | null
): Promise<WindowMap> {
  if (!backendUrl) return Promise.resolve(new Map());
  const key = backendUrl.replace(/\/$/, "");
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.promise;

  const promise = fetchWindows(key, backendApiKey);
  cache.set(key, { expires: now + CACHE_TTL_MS, promise });
  return promise;
}

async function fetchWindows(
  backendUrl: string,
  backendApiKey?: string | null
): Promise<WindowMap> {
  const map: WindowMap = new Map();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    if (backendApiKey) headers["Authorization"] = `Bearer ${backendApiKey}`;

    const res = await fetch(`${backendUrl}/models`, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) return map;

    const json = (await res.json()) as { data?: unknown };
    const entries = Array.isArray(json?.data) ? json.data : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.id !== "string") continue;
      const window = extractContextWindow(record);
      if (window !== undefined) map.set(record.id, window);
    }
  } catch {
    // Best-effort: unreachable backend, timeout, or invalid JSON -> no windows.
  } finally {
    clearTimeout(timeoutId);
  }
  return map;
}

/** Test-only: clears the per-backend window cache between cases. */
export function _resetContextWindowCache(): void {
  cache.clear();
}
