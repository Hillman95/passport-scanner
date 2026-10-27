import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock("tesseract.js", () => ({ createWorker: mocks.createWorker }));

function worker() {
  return {
    reinitialize: vi.fn().mockResolvedValue({}),
    terminate: vi.fn().mockResolvedValue({}),
  };
}
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it("warms all models once, shares a worker and expires an unused engine", async () => {
  const engine = worker();
  mocks.createWorker.mockResolvedValue(engine);
  const pool = await import("../src/worker.js");
  await Promise.all([pool.warmupPassportOcr(), pool.warmupPassportOcr()]);
  expect(mocks.createWorker).toHaveBeenCalledTimes(1);
  expect(mocks.createWorker).toHaveBeenCalledWith(
    "eng+rus+mrz",
    1,
    expect.objectContaining({
      cacheMethod: "none",
      langPath: "/ocr/tesseract-v7/lang",
    }),
  );
  expect(engine.reinitialize).toHaveBeenCalledWith("eng", 1);
  await vi.advanceTimersByTimeAsync(119_999);
  expect(engine.terminate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(engine.terminate).toHaveBeenCalledOnce();
});

it("leases the warmed engine exclusively and does not expire active recognition", async () => {
  const engine = worker();
  mocks.createWorker.mockResolvedValue(engine);
  const pool = await import("../src/worker.js");
  await pool.warmupPassportOcr();
  const lease = pool.reservePassportWorker(vi.fn());
  expect(await lease.ready).toBe(engine);
  expect(() => pool.reservePassportWorker(vi.fn())).toThrow(/already running/);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(engine.terminate).not.toHaveBeenCalled();
  lease.discard();
  await vi.runAllTimersAsync();
  expect(engine.terminate).toHaveBeenCalledOnce();
});

it("destroys a used engine before prewarming a clean replacement", async () => {
  const used = worker(),
    clean = worker();
  mocks.createWorker.mockResolvedValueOnce(used).mockResolvedValueOnce(clean);
  const pool = await import("../src/worker.js");
  const lease = pool.reservePassportWorker(vi.fn());
  await lease.ready;
  await lease.release();
  await pool.warmupPassportOcr();
  expect(used.terminate).toHaveBeenCalledOnce();
  expect(mocks.createWorker).toHaveBeenCalledTimes(2);
  const replacement = pool.reservePassportWorker(vi.fn());
  expect(await replacement.ready).toBe(clean);
  replacement.discard();
  await vi.runAllTimersAsync();
});

it("waits for late initialization to be disposed before starting a retry", async () => {
  const late = worker(),
    retry = worker();
  let finish!: (value: typeof late) => void;
  mocks.createWorker
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValueOnce(retry);
  const pool = await import("../src/worker.js");
  const first = pool.reservePassportWorker(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  first.discard();
  const second = pool.reservePassportWorker(vi.fn());
  expect(mocks.createWorker).toHaveBeenCalledTimes(1);
  finish(late);
  expect(await second.ready).toBe(retry);
  expect(late.terminate).toHaveBeenCalledOnce();
  expect(mocks.createWorker).toHaveBeenCalledTimes(2);
  second.discard();
  await vi.runAllTimersAsync();
});

it("allows explicit recognition to retry a failed background warmup", async () => {
  const engine = worker();
  mocks.createWorker
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(engine);
  const pool = await import("../src/worker.js");
  await expect(pool.warmupPassportOcr()).rejects.toThrow("offline");
  const lease = pool.reservePassportWorker(vi.fn());
  expect(await lease.ready).toBe(engine);
  lease.discard();
  await vi.runAllTimersAsync();
});

it("keeps asset configuration and disposal isolated between scanner instances", async () => {
  const first = worker(),
    second = worker();
  mocks.createWorker.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const { createPassportWorkerPool } = await import("../src/worker.js");
  const one = createPassportWorkerPool({
    ocrPath: "/one/",
    prewarmAfterScan: false,
  });
  const two = createPassportWorkerPool({
    ocrPath: "/two",
    prewarmAfterScan: false,
  });
  await one.warmup();
  await two.warmup();
  expect(mocks.createWorker.mock.calls[0][2]).toMatchObject({
    workerPath: "/one/worker.min.js",
    corePath: "/one",
    langPath: "/one/lang",
  });
  expect(mocks.createWorker.mock.calls[1][2]).toMatchObject({
    workerPath: "/two/worker.min.js",
    corePath: "/two",
    langPath: "/two/lang",
  });
  await one.dispose();
  expect(first.terminate).toHaveBeenCalledOnce();
  expect(second.terminate).not.toHaveBeenCalled();
  await expect(one.warmup()).rejects.toThrow(/disposed/);
  await two.dispose();
  expect(second.terminate).toHaveBeenCalledOnce();
});

it("does not warm a replacement after disposal races a successful scan", async () => {
  const engine = worker();
  mocks.createWorker.mockResolvedValue(engine);
  const { createPassportWorkerPool } = await import("../src/worker.js");
  const pool = createPassportWorkerPool();
  const lease = pool.reserve(vi.fn());
  await lease.ready;
  await Promise.all([lease.release(), pool.dispose()]);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.createWorker).toHaveBeenCalledOnce();
});
