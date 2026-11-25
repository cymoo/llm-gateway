import { makeProxyError } from "./errors";

export const AUDIO_TRANSCRIPTIONS_PATH = "audio/transcriptions";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_AUDIO_BYTES + 1024 * 1024;

export async function parseAudioTranscriptionForm(
  req: Request,
): Promise<FormData | Response> {
  const contentType = req.headers.get("content-type");
  if (
    !req.body || !contentType || !/^multipart\/form-data\s*;/i.test(contentType)
  ) {
    return makeProxyError(
      "Expected a multipart/form-data body",
      "invalid_request_error",
      "invalid_multipart",
      400,
    );
  }

  // FormData parsing buffers the upload. Count bytes before parsing so the
  // limit also covers chunked requests and oversized text fields.
  const tooLarge = new Error("Multipart request exceeds 26 MiB");
  let bytesRead = 0;
  const boundedBody = req.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesRead += chunk.byteLength;
        if (bytesRead > MAX_MULTIPART_BYTES) throw tooLarge;
        controller.enqueue(chunk);
      },
    }),
  );

  let form: FormData;
  try {
    form = await new Response(boundedBody, {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch (error) {
    if (error === tooLarge) {
      return makeProxyError(
        tooLarge.message,
        "invalid_request_error",
        "payload_too_large",
        413,
      );
    }
    return makeProxyError(
      "Invalid multipart body",
      "invalid_request_error",
      "invalid_multipart",
      400,
    );
  }

  const [file, ...extraFiles] = form.getAll("file");
  if (!file || typeof file === "string" || file.size === 0 || extraFiles.length) {
    return makeProxyError(
      "Expected one non-empty audio file",
      "invalid_request_error",
      "invalid_file",
      400,
    );
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return makeProxyError(
      "Audio file exceeds 25 MiB",
      "invalid_request_error",
      "payload_too_large",
      413,
    );
  }

  const stream = form.getAll("stream");
  if (stream.length > 1 || (stream.length === 1 && stream[0] !== "false")) {
    return makeProxyError(
      "Audio transcription requires stream=false",
      "invalid_request_error",
      "invalid_stream",
      400,
    );
  }

  return form;
}

export function audioTestForm(backendModel: string): FormData {
  // One second of silence in mono, 16-bit PCM at 16 kHz.
  const sampleRate = 16000;
  const dataBytes = sampleRate * 2;
  const wav = new Uint8Array(44 + dataBytes);
  const header = new DataView(wav.buffer);
  const encoder = new TextEncoder();
  wav.set(encoder.encode("RIFF"), 0);
  header.setUint32(4, wav.byteLength - 8, true);
  wav.set(encoder.encode("WAVEfmt "), 8);
  header.setUint32(16, 16, true); // PCM format chunk length
  header.setUint16(20, 1, true); // PCM format
  header.setUint16(22, 1, true); // channel count
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true); // byte rate
  header.setUint16(32, 2, true); // block alignment
  header.setUint16(34, 16, true); // bits per sample
  wav.set(encoder.encode("data"), 36);
  header.setUint32(40, dataBytes, true);

  const form = new FormData();
  form.set("model", backendModel);
  form.set("file", new Blob([wav], { type: "audio/wav" }), "gateway-test.wav");
  return form;
}
