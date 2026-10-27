import { afterEach, expect, it, vi } from "vitest";
import { convertHeifPhoto, isHeifPhoto } from "../src/heif.js";
import { passportFileError } from "../src/model.js";

class Decoder {
  static latest: Decoder;
  terminate = vi.fn();
  postMessage = vi.fn();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  constructor(readonly path: string) {
    Decoder.latest = this;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("accepts HEIC variants and rejects unsupported or excessive inputs", () => {
  expect(isHeifPhoto({ type: "image/heif-sequence" })).toBe(true);
  expect(
    isHeifPhoto({ type: "application/octet-stream", name: "synthetic.HEIC" }),
  ).toBe(true);
  expect(isHeifPhoto({ type: "image/jpeg", name: "synthetic.heic" })).toBe(
    false,
  );
  expect(passportFileError({ type: "image/heic", size: 100 })).toBeUndefined();
  expect(
    passportFileError({ type: "image/jpeg", size: 16 * 1024 * 1024 }),
  ).toBeTruthy();
  expect(
    passportFileError({ type: "application/pdf", size: 100 }),
  ).toBeTruthy();
});
it("terminates the configured decoder on cancellation and removes late callbacks", async () => {
  vi.stubGlobal("Worker", Decoder);
  const controller = new AbortController();
  const pending = convertHeifPhoto(
    new File(["synthetic"], "synthetic.heic"),
    controller.signal,
    "/custom/worker.js",
  );
  const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(Decoder.latest.path).toBe("/custom/worker.js");
  controller.abort();
  await failure;
  expect(Decoder.latest.terminate).toHaveBeenCalledOnce();
  expect(Decoder.latest.onmessage).toBeNull();
  expect(Decoder.latest.onerror).toBeNull();
});
it("rejects inconsistent pixel payloads and terminates a stalled decoder", async () => {
  vi.stubGlobal("Worker", Decoder);
  const file = new File(["synthetic"], "synthetic.heic");
  const pending = convertHeifPhoto(file, new AbortController().signal);
  const failure = expect(pending).rejects.toThrow(/HEIC/);
  Decoder.latest.onmessage?.({
    data: { width: 300, height: 300, pixels: new ArrayBuffer(4) },
  });
  await failure;
  expect(Decoder.latest.terminate).toHaveBeenCalledOnce();
  vi.useFakeTimers();
  const stalled = convertHeifPhoto(file, new AbortController().signal);
  const timeout = expect(stalled).rejects.toThrow(/HEIC/);
  await vi.advanceTimersByTimeAsync(60_000);
  await timeout;
  expect(Decoder.latest.terminate).toHaveBeenCalledOnce();
});
