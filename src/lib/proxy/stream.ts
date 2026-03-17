export interface UsageFromStream {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Creates a TransformStream that transparently passes through SSE data chunks
 * and extracts usage info from the final chunk if available.
 */
export function createStreamTransformer(
  onComplete: (usage: UsageFromStream) => void
): TransformStream<Uint8Array, Uint8Array> {
  let buffer = "";
  let lastUsage: UsageFromStream = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      // Parse SSE chunks to extract usage info
      const text = new TextDecoder().decode(chunk);
      buffer += text;

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.usage) {
              lastUsage = {
                promptTokens: parsed.usage.prompt_tokens || 0,
                completionTokens: parsed.usage.completion_tokens || 0,
                totalTokens: parsed.usage.total_tokens || 0,
              };
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    },
    flush() {
      // Process remaining buffer
      if (buffer) {
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.usage) {
                lastUsage = {
                  promptTokens: parsed.usage.prompt_tokens || 0,
                  completionTokens: parsed.usage.completion_tokens || 0,
                  totalTokens: parsed.usage.total_tokens || 0,
                };
              }
            } catch {
              // Ignore
            }
          }
        }
      }
      onComplete(lastUsage);
    },
  });
}
