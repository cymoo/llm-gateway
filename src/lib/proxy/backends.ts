import { db } from "@/lib/db";
import { modelBackends, type ModelBackend } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import type { RequestType } from "./handler";

// Cap on the serialized conversation head used as the cache-affinity key —
// purely a hashing-cost guard against pathological payloads. Must stay long
// enough to reach past a shared system prompt into the first user message,
// or every conversation hashes to the same backend. A non-numeric or
// non-positive override would truncate every key to "" (one hot backend),
// so such values fall back to the default.
const DEFAULT_AFFINITY_PREFIX_LENGTH = 16384;
const parsedAffinityLength = parseInt(process.env.AFFINITY_PREFIX_LENGTH || "");
const AFFINITY_PREFIX_LENGTH =
  Number.isFinite(parsedAffinityLength) && parsedAffinityLength > 0
    ? parsedAffinityLength
    : DEFAULT_AFFINITY_PREFIX_LENGTH;

export async function getActiveBackends(
  modelId: string,
): Promise<ModelBackend[]> {
  return db
    .select()
    .from(modelBackends)
    .where(
      and(eq(modelBackends.modelId, modelId), eq(modelBackends.isActive, true)),
    )
    .orderBy(asc(modelBackends.createdAt), asc(modelBackends.id));
}

/**
 * The stable head of a conversation: its first message, plus the second when
 * the first is a system prompt. Later turns append messages but never mutate
 * these, so serializing exactly this subset yields an identical key on every
 * turn. (Serializing the whole array would not: the closing `]` of turn one
 * becomes a `,` on turn two, shifting every "prefix" of the string.)
 */
function conversationHead(messages: unknown[]): unknown[] {
  const first = messages[0] as Record<string, unknown> | undefined;
  if (first?.role === "system" && messages.length > 1) {
    return [messages[0], messages[1]];
  }
  return [messages[0]];
}

/**
 * Cache-affinity key for OpenAI-style requests. Conversations share a stable
 * head (system prompt + first user message) across turns, so hashing it keeps
 * a conversation on one backend and lets vLLM's prefix cache hit. Returns
 * null for request types with no prefix-cache benefit (embeddings, rerank, audio) or
 * malformed bodies — callers fall back to round-robin.
 */
export function affinityKey(
  requestType: RequestType,
  body: Record<string, unknown>,
): string | null {
  if (requestType === "chat.completions") {
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return null;
    }
    return JSON.stringify(conversationHead(body.messages)).slice(
      0,
      AFFINITY_PREFIX_LENGTH,
    );
  }
  if (requestType === "completions") {
    const prompt = body.prompt;
    if (typeof prompt === "string" && prompt.length > 0) {
      return prompt.slice(0, AFFINITY_PREFIX_LENGTH);
    }
    if (Array.isArray(prompt) && prompt.length > 0) {
      return JSON.stringify(prompt).slice(0, AFFINITY_PREFIX_LENGTH);
    }
    return null;
  }
  return null;
}

/** Cache-affinity key for Anthropic-style requests (top-level system + the
 *  conversation's first message — both stable across turns). */
export function anthropicAffinityKey(
  body: Record<string, unknown>,
): string | null {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return null;
  }
  return JSON.stringify({
    system: body.system ?? null,
    first: body.messages[0],
  }).slice(0, AFFINITY_PREFIX_LENGTH);
}

// FNV-1a 32-bit — cheap, deterministic, good enough dispersion for routing.
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Per-process round-robin cursors keyed by modelId (same pattern as the
// in-memory rate limiter). Counters are per process; distribution is uniform
// in aggregate, which is all round-robin needs.
const rrCounters = new Map<string, number>();

/**
 * Orders active backends for one request; the order is also the failover
 * order. With an affinity key: rendezvous (HRW) hashing — the top pick is
 * stable per conversation and adding/removing a backend only remaps ~1/n of
 * conversations; lower ranks are stable too, so failover keeps affinity.
 * Without a key: round-robin rotation.
 */
export function orderBackendsForRequest(
  modelId: string,
  backends: ModelBackend[],
  key: string | null,
): ModelBackend[] {
  if (backends.length <= 1) return backends.slice();

  if (key !== null) {
    return backends
      .map((b) => ({ b, score: fnv1a(`${key}|${b.id}`) }))
      .sort((x, y) => y.score - x.score || (x.b.id < y.b.id ? -1 : 1))
      .map((x) => x.b);
  }

  const counter = rrCounters.get(modelId) ?? 0;
  rrCounters.set(modelId, (counter + 1) % 1_000_000);
  const start = counter % backends.length;
  return [...backends.slice(start), ...backends.slice(0, start)];
}

export function _resetRoundRobin(): void {
  rrCounters.clear();
}

/** Backend statuses worth retrying on another backend. Client errors are not. */
export function isFailoverEligibleStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

type BufferedResponse = {
  text: string;
  status: number;
  contentType: string | null;
};

export type ForwardOutcome =
  | { kind: "stream"; response: Response; backend: ModelBackend }
  | ({ kind: "ok"; backend: ModelBackend } & BufferedResponse)
  | ({ kind: "http_error" } & BufferedResponse)
  | { kind: "timeout" }
  | { kind: "network_error" };

/**
 * Retries transport failures and failover-eligible HTTP statuses (5xx/429).
 * For buffered responses the deadline covers the body, and a disconnect can
 * still fail over because the caller has yet to receive a response. Successful
 * streams are handed to the caller as soon as the headers arrive. A timeout
 * ends the request so that retrying cannot multiply a full timeout.
 */
export async function forwardWithFailover(opts: {
  backends: ModelBackend[];
  buildRequest: (backend: ModelBackend) => {
    url: string;
    init: Omit<RequestInit, "signal">;
  };
  timeoutMs: number;
  streamResponse?: boolean;
}): Promise<ForwardOutcome> {
  let lastHttpError: Extract<ForwardOutcome, { kind: "http_error" }> | null =
    null;

  for (const backend of opts.backends) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);
    let response: Response | undefined;

    try {
      const { url, init } = opts.buildRequest(backend);
      response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok && opts.streamResponse) {
        return { kind: "stream", response, backend };
      }

      const buffered = {
        text: await response.text(),
        status: response.status,
        contentType: response.headers.get("content-type"),
      };
      if (response.ok) {
        return { kind: "ok", ...buffered, backend };
      }

      const httpError = { kind: "http_error" as const, ...buffered };
      if (!isFailoverEligibleStatus(response.status)) return httpError;

      console.error(
        `[proxy] Backend ${backend.backendUrl} returned ${response.status}, trying next`,
      );
      lastHttpError = httpError;
    } catch (err: unknown) {
      if (
        controller.signal.aborted || (err instanceof Error && err.name === "AbortError")
      ) {
        return { kind: "timeout" };
      }
      console.error(`[proxy] Backend connection failed: ${backend.backendUrl}`, err);
      if (response && !response.ok && !isFailoverEligibleStatus(response.status)) {
        return {
          kind: "http_error",
          status: response.status,
          contentType: response.headers.get("content-type"),
          text: "",
        };
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return lastHttpError ?? { kind: "network_error" };
}
