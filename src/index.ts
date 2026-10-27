import { convertHeifPhoto, isHeifPhoto } from "./heif.js";
import { passportFileError } from "./model.js";
import { recognizePassport } from "./recognize.js";
import {
  createPassportWorkerPool,
  type PassportWorkerOptions,
} from "./worker.js";

export * from "./model.js";
export { extractPassport, isoDate, mrzCheckDigit } from "./parser.js";
export { isHeifPhoto } from "./heif.js";

export interface PassportScannerOptions extends PassportWorkerOptions {
  /** Self-hosted classic worker; the replaceable libheif bundle lives beside it. */
  heifWorkerPath?: string;
}
export interface RecognizeOptions {
  signal?: AbortSignal;
  quarterTurns?: number;
  /** Status only: callbacks never receive image bytes or raw OCR text. */
  onProgress?: (message: string) => void;
}

/** One scanner per form/tab. No network upload, telemetry or persistent image cache. */
export function createPassportScanner(options: PassportScannerOptions = {}) {
  const pool = createPassportWorkerPool(options);
  const lifecycle = new AbortController();
  let disposed = false;
  let active: AbortController | undefined;
  const assertOpen = () => {
    if (disposed) throw new Error("OCR scanner has been disposed");
  };
  return {
    warmup: async () => {
      assertOpen();
      await pool.warmup();
    },
    decode: async (
      file: File,
      signal: AbortSignal = new AbortController().signal,
    ) => {
      assertOpen();
      const invalid = passportFileError(file);
      if (invalid) throw new Error(invalid);
      const combined = AbortSignal.any([signal, lifecycle.signal]);
      combined.throwIfAborted();
      return isHeifPhoto(file)
        ? convertHeifPhoto(file, combined, options.heifWorkerPath)
        : file;
    },
    recognize: async (file: File, config: RecognizeOptions = {}) => {
      assertOpen();
      if (active) throw new Error("OCR is already running");
      const invalid = passportFileError(file);
      if (invalid) throw new Error(invalid);
      const controller = new AbortController();
      active = controller;
      const abort = () => controller.abort(config.signal?.reason);
      config.signal?.addEventListener("abort", abort, { once: true });
      if (config.signal?.aborted) abort();
      try {
        const prepared = isHeifPhoto(file)
          ? await convertHeifPhoto(
              file,
              controller.signal,
              options.heifWorkerPath,
            )
          : file;
        return await recognizePassport(
          prepared,
          config.quarterTurns ?? 0,
          controller.signal,
          config.onProgress ?? (() => {}),
          pool,
        );
      } finally {
        config.signal?.removeEventListener("abort", abort);
        active = undefined;
      }
    },
    dispose: async () => {
      disposed = true;
      lifecycle.abort();
      active?.abort();
      await pool.dispose();
    },
  };
}
export type PassportScanner = ReturnType<typeof createPassportScanner>;
