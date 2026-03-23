/**
 * k6 smoke test for the LLM Gateway.
 *
 * Usage:
 *   k6 run \
 *     -e TEST_BASE_URL=http://localhost:3001 \
 *     -e TEST_TOKEN=<your-api-key> \
 *     -e TEST_MODEL_NAME=<model-alias> \
 *     k6/gateway-smoke.js
 */

import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 5,
  duration: "30s",
  thresholds: {
    // Failure rate must stay below 10%
    http_req_failed: ["rate<0.1"],
    // 95th-percentile response time must be under 5 s
    http_req_duration: ["p(95)<5000"],
  },
};

const baseUrl = __ENV.TEST_BASE_URL || "http://localhost:3001";
const token = __ENV.TEST_TOKEN;
const modelName = __ENV.TEST_MODEL_NAME || "gpt-4o-mini";

export default function () {
  const payload = JSON.stringify({
    model: modelName,
    stream: false,
    max_tokens: 16,
    messages: [{ role: "user", content: "reply: ok" }],
  });

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const res = http.post(`${baseUrl}/v1/chat/completions`, payload, {
    headers,
    timeout: "60s",
  });

  check(res, {
    "status is 200": (r) => r.status === 200,
    "has choices array": (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.choices) && body.choices.length > 0;
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}
