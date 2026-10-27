import { createWorker, type Worker } from "tesseract.js";

export interface PassportWorkerOptions {
  ocrPath?: string;
  idleMs?: number;
  prewarmAfterScan?: boolean;
}
export function createPassportWorkerPool(options: PassportWorkerOptions = {}) {
  const ocrPath = (options.ocrPath ?? "/ocr/tesseract-v7").replace(/\/$/, "");
  const idleMs = options.idleMs ?? 120_000;
  if (!Number.isFinite(idleMs) || idleMs < 0)
    throw new Error("Invalid idle timeout");
  let disposed = false;
  type Progress = (fraction: number) => void;
  type Entry = {
    ready: Promise<Worker>;
    claimed: boolean;
    closed: boolean;
    timer?: ReturnType<typeof setTimeout>;
    progress?: Progress;
  };
  let current: Entry | undefined;
  let disposing: Promise<unknown> = Promise.resolve();

  function discard(entry: Entry) {
    if (entry.closed) return;
    entry.closed = true;
    entry.progress = undefined;
    clearTimeout(entry.timer);
    if (current === entry) current = undefined;
    // Initialization has no abort handle. Queue its termination before allowing
    // another worker to start, including a retry after cancelling model loading.
    disposing = Promise.all([
      disposing,
      entry.ready.then(
        (worker) => worker.terminate(),
        () => {},
      ),
    ]).then(
      () => {},
      () => {},
    );
  }

  function entryForUse() {
    if (disposed) throw new Error("OCR scanner has been disposed");
    if (current) return current;
    const ready = disposing
      .then(() => {
        if (entry.closed) throw new Error("OCR initialization cancelled");
        return createWorker("eng+rus+mrz", 1, {
          workerPath: `${ocrPath}/worker.min.js`,
          corePath: ocrPath,
          langPath: `${ocrPath}/lang`,
          cacheMethod: "none",
          workerBlobURL: false,
          // Errors and progress must never log images or recognized text.
          errorHandler: () => {},
          logger: ({ status, progress }) => {
            if (!entry.closed && status === "recognizing text")
              entry.progress?.(progress);
          },
        });
      })
      .then(async (worker) => {
        try {
          if (!entry.closed) await worker.reinitialize("eng", 1);
        } catch (error) {
          await worker.terminate();
          throw error;
        }
        if (!entry.closed && !entry.claimed)
          entry.timer = setTimeout(() => discard(entry), idleMs);
        return worker;
      });
    const entry: Entry = { ready, claimed: false, closed: false };
    current = entry;
    void entry.ready.catch(() => discard(entry));
    return entry;
  }

  async function warmupPassportOcr() {
    await entryForUse().ready;
  }

  function reservePassportWorker(progress: Progress) {
    const entry = entryForUse();
    if (entry.claimed) throw new Error("OCR is already running");
    entry.claimed = true;
    entry.progress = progress;
    clearTimeout(entry.timer);
    return {
      ready: entry.ready,
      discard: () => discard(entry),
      release: async () => {
        // A used engine may retain its last image in WASM memory. Never pool it.
        discard(entry);
        await disposing;
        if (!disposed && options.prewarmAfterScan !== false)
          void warmupPassportOcr().catch(() => {});
      },
    };
  }

  return {
    warmup: warmupPassportOcr,
    reserve: reservePassportWorker,
    dispose: async () => {
      disposed = true;
      if (current) discard(current);
      await disposing;
    },
  };
}
export type PassportWorkerPool = ReturnType<typeof createPassportWorkerPool>;
export const defaultPassportWorkerPool = createPassportWorkerPool();
export const warmupPassportOcr = defaultPassportWorkerPool.warmup;
export const reservePassportWorker = defaultPassportWorkerPool.reserve;
