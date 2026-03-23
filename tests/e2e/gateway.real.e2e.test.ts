/**
 * Real-request end-to-end tests for the LLM Gateway.
 *
 * Focused on forwarding correctness and protocol compatibility.
 * Requires a running gateway and a reachable PostgreSQL database.
 *
 * Configuration (via .env.test or environment variables):
 *   TEST_BASE_URL        - Gateway base URL (default: http://localhost:3001)
 *   TEST_HTTP_TIMEOUT_MS - Per-request timeout in ms (default: 60000)
 *   DATABASE_URL         - Full Postgres connection URL (takes priority over TEST_DATABASE_URL)
 *   TEST_DATABASE_URL    - Full Postgres connection URL for tests
 *   TEST_USER_ID         - Optional: resolve test user by id
 *   TEST_USER_EMAIL      - Optional: resolve test user by email
 *   TEST_MODEL_PROVIDER  - Optional: filter models by backend_url substring
 *   TEST_MODEL_NAME      - Optional: filter models by alias
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3001";
const HTTP_TIMEOUT_MS = Number(process.env.TEST_HTTP_TIMEOUT_MS ?? 60_000);

function buildPoolConfig() {
  const connectionString =
    process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL or TEST_DATABASE_URL must be set for e2e tests"
    );
  }
  return { connectionString };
}

const pool = new Pool(buildPoolConfig());

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

interface TestUser {
  id: string;
  email: string;
  apiKey: string;
}

interface TestModel {
  id: string;
  alias: string;
  isActive: boolean;
}

async function getTestUser(): Promise<TestUser> {
  if (process.env.TEST_USER_ID) {
    const r = await pool.query<{ id: string; email: string; api_key: string }>(
      `SELECT id, email, api_key FROM users WHERE id = $1 LIMIT 1`,
      [process.env.TEST_USER_ID]
    );
    if (r.rows[0]?.api_key) {
      return {
        id: r.rows[0].id,
        email: r.rows[0].email,
        apiKey: r.rows[0].api_key,
      };
    }
  }

  if (process.env.TEST_USER_EMAIL) {
    const r = await pool.query<{ id: string; email: string; api_key: string }>(
      `SELECT id, email, api_key FROM users WHERE email = $1 LIMIT 1`,
      [process.env.TEST_USER_EMAIL]
    );
    if (r.rows[0]?.api_key) {
      return {
        id: r.rows[0].id,
        email: r.rows[0].email,
        apiKey: r.rows[0].api_key,
      };
    }
  }

  // Fallback: first row ordered by id
  const r = await pool.query<{ id: string; email: string; api_key: string }>(
    `SELECT id, email, api_key FROM users ORDER BY id ASC LIMIT 1`
  );
  if (!r.rows[0]?.api_key) {
    throw new Error("No usable api_key found in users table");
  }
  return {
    id: r.rows[0].id,
    email: r.rows[0].email,
    apiKey: r.rows[0].api_key,
  };
}

async function getTestModels(): Promise<TestModel[]> {
  const provider = process.env.TEST_MODEL_PROVIDER;
  const modelName = process.env.TEST_MODEL_NAME;

  const conditions: string[] = ["is_active = true"];
  const params: string[] = [];

  if (modelName) {
    params.push(modelName);
    conditions.push(`alias = $${params.length}`);
  }

  if (provider) {
    params.push(`%${provider}%`);
    conditions.push(`backend_url ILIKE $${params.length}`);
  }

  const sql = `
    SELECT id, alias, is_active
    FROM models
    WHERE ${conditions.join(" AND ")}
    ORDER BY id ASC
    LIMIT 2
  `;

  const r = await pool.query<{
    id: string;
    alias: string;
    is_active: boolean;
  }>(sql, params);

  if (!r.rows.length) {
    throw new Error(
      "No active test models found in models table. " +
        "Check TEST_MODEL_PROVIDER / TEST_MODEL_NAME filters."
    );
  }

  return r.rows.map((row) => ({
    id: row.id,
    alias: row.alias,
    isActive: row.is_active,
  }));
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

interface FetchResult {
  res: Response;
  text: string;
  json: unknown;
}

async function postJson(
  path: string,
  token: string | null,
  body: unknown
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // non-JSON response – leave json as null
    }

    return { res, text, json };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Gateway real-request e2e", () => {
  let user: TestUser;
  let models: TestModel[];

  beforeAll(async () => {
    user = await getTestUser();
    models = await getTestModels();
  });

  afterAll(async () => {
    await pool.end();
  });

  // -------------------------------------------------------------------------
  // a. Non-stream correctness
  // -------------------------------------------------------------------------
  it(
    "non-stream chat completion returns 200 with valid structure",
    async () => {
      const { res, json } = await postJson("/v1/chat/completions", user.apiKey, {
        model: models[0].alias,
        stream: false,
        temperature: 0.2,
        max_tokens: 64,
        messages: [{ role: "user", content: "Reply with: pong" }],
      });

      expect(res.status).toBe(200);
      expect(json).toBeTruthy();

      const body = json as Record<string, unknown>;
      expect(body.model).toBeTruthy();
      expect(Array.isArray(body.choices)).toBe(true);
      expect((body.choices as unknown[]).length).toBeGreaterThan(0);
    },
    HTTP_TIMEOUT_MS
  );

  // -------------------------------------------------------------------------
  // b. Stream protocol compatibility
  // -------------------------------------------------------------------------
  it(
    "stream=true returns SSE content-type and contains data: lines and [DONE]",
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

      try {
        const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${user.apiKey}`,
          },
          body: JSON.stringify({
            model: models[0].alias,
            stream: true,
            messages: [{ role: "user", content: "Count 1 to 3 briefly." }],
          }),
          signal: controller.signal,
        });

        expect(res.status).toBe(200);
        const ct = res.headers.get("content-type") ?? "";
        expect(ct.toLowerCase()).toContain("text/event-stream");

        const reader = res.body?.getReader();
        expect(reader).toBeTruthy();

        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader!.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          if (accumulated.includes("[DONE]")) break;
        }

        expect(accumulated).toContain("data:");
        expect(accumulated).toContain("[DONE]");
      } finally {
        clearTimeout(timer);
      }
    },
    HTTP_TIMEOUT_MS
  );

  // -------------------------------------------------------------------------
  // c. Stability: 10 sequential requests, success rate >= 90%
  // -------------------------------------------------------------------------
  it(
    "stability: 10 sequential requests have >= 90% success rate",
    async () => {
      let successCount = 0;

      for (let i = 0; i < 10; i++) {
        try {
          const { res } = await postJson(
            "/v1/chat/completions",
            user.apiKey,
            {
              model: models[0].alias,
              stream: false,
              max_tokens: 16,
              messages: [{ role: "user", content: `Say ok #${i}` }],
            }
          );
          if (res.status === 200) successCount++;
        } catch {
          // count as failure
        }
      }

      expect(successCount).toBeGreaterThanOrEqual(9);
    },
    HTTP_TIMEOUT_MS * 10
  );

  // -------------------------------------------------------------------------
  // d. Unauthorized request returns 401 or 403
  // -------------------------------------------------------------------------
  it("request without token returns 401 or 403", async () => {
    const { res } = await postJson("/v1/chat/completions", null, {
      model: models[0].alias,
      stream: false,
      messages: [{ role: "user", content: "hello" }],
    });

    expect([401, 403]).toContain(res.status);
  });

  // -------------------------------------------------------------------------
  // e. Invalid model returns 4xx
  // -------------------------------------------------------------------------
  it("invalid model name returns 4xx", async () => {
    const { res } = await postJson("/v1/chat/completions", user.apiKey, {
      model: "__invalid_model_that_does_not_exist__",
      stream: false,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // -------------------------------------------------------------------------
  // f. Invalid body (missing messages) returns 400
  // -------------------------------------------------------------------------
  it("request with missing messages field returns 400", async () => {
    const { res } = await postJson("/v1/chat/completions", user.apiKey, {
      model: models[0].alias,
      // messages intentionally omitted
    });

    expect(res.status).toBe(400);
  });
});
