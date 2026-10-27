import { beforeEach, expect, it, vi } from "vitest";
const waitFor = vi.waitFor;
import { recognizePassport } from "../src/recognize.js";

const mocks = vi.hoisted(() => ({
  createWorker: vi.fn(),
  prepare: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
  setParameters: vi.fn(),
  reinitialize: vi.fn(),
}));
vi.mock("tesseract.js", () => ({
  createWorker: mocks.createWorker,
  PSM: { SPARSE_TEXT: "11", SINGLE_LINE: "7", SINGLE_BLOCK: "6", AUTO: "3" },
}));
vi.mock("../src/image.js", () => ({
  preparePassportImage: mocks.prepare,
}));
const file = new File(["fixture"], "passport.jpg", { type: "image/jpeg" });
const worker = {
  recognize: mocks.recognize,
  terminate: mocks.terminate,
  setParameters: mocks.setParameters,
  reinitialize: mocks.reinitialize,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createWorker.mockResolvedValue(worker);
  mocks.setParameters.mockResolvedValue({});
  mocks.reinitialize.mockResolvedValue({});
});

it("cancels the enhanced pass and releases both image copies", async () => {
  const original = document.createElement("canvas"),
    enhanced = document.createElement("canvas");
  original.width = enhanced.width = 100;
  mocks.prepare.mockResolvedValueOnce(original).mockResolvedValueOnce(enhanced);
  mocks.recognize
    .mockResolvedValueOnce({ data: { blocks: [] } })
    .mockResolvedValueOnce({ data: { blocks: [] } })
    .mockReturnValue(new Promise(() => {}));
  const controller = new AbortController();
  const pending = recognizePassport(file, 0, controller.signal, vi.fn());
  const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await waitFor(() => expect(mocks.recognize).toHaveBeenCalledTimes(3));
  expect(mocks.reinitialize).toHaveBeenCalledWith("eng", 1);
  controller.abort();
  await failure;
  expect(original.width).toBe(1);
  expect(enhanced.width).toBe(1);
});

it("reads MRZ found only after enhancement and releases the temporary line crop", async () => {
  const original = document.createElement("canvas"),
    enhanced = document.createElement("canvas");
  original.width = enhanced.width = 200;
  original.height = enhanced.height = 150;
  mocks.prepare.mockResolvedValueOnce(original).mockResolvedValueOnce(enhanced);
  const drawing = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  const first = "P<RUSPRIMEROV<<TEST".padEnd(44, "<");
  mocks.recognize
    .mockResolvedValueOnce({ data: { blocks: [] } })
    .mockResolvedValueOnce({ data: { blocks: [] } })
    .mockResolvedValueOnce({
      data: {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: first,
                    confidence: 50,
                    bbox: { x0: 10, y0: 110, x1: 190, y1: 125 },
                  },
                ],
              },
            ],
          },
        ],
      },
    })
    .mockResolvedValueOnce({ data: { text: first } })
    .mockResolvedValue({ data: { blocks: [] } });
  try {
    const result = await recognizePassport(
      file,
      0,
      new AbortController().signal,
      vi.fn(),
    );
    expect(result.fields.passport_given_name?.value).toBe("TEST");
    expect(result.fields.passport_surname?.value).toBe("PRIMEROV");
    expect(mocks.reinitialize).toHaveBeenCalledWith("mrz", 1);
    const crops = mocks.recognize.mock.calls
      .map(([input]) => input)
      .filter((input) => input !== original && input !== enhanced);
    expect(crops).toHaveLength(1);
    expect(crops[0].width).toBe(1);
    expect(crops[0].height).toBe(1);
  } finally {
    drawing.mockRestore();
  }
});

it("terminates a running worker and releases the image even when its recognition promise never resolves", async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  mocks.prepare.mockResolvedValue(canvas);
  mocks.recognize.mockReturnValue(new Promise(() => {}));
  const controller = new AbortController();
  const pending = recognizePassport(file, 0, controller.signal, vi.fn());
  const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await waitFor(() => expect(mocks.recognize).toHaveBeenCalled());
  controller.abort();
  await failure;
  expect(mocks.terminate).toHaveBeenCalled();
  expect(canvas.width).toBe(1);
});

it("cancels a localized reread and frees its crop and all three image copies", async () => {
  const images = Array.from({ length: 3 }, () =>
    document.createElement("canvas"),
  );
  for (const image of images) {
    image.width = 200;
    image.height = 150;
    mocks.prepare.mockResolvedValueOnce(image);
  }
  const drawing = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  const first = "P<RUSPRIMEROV<<TEST".padEnd(44, "<");
  const page = (lines: unknown[]) => ({
    data: { blocks: [{ paragraphs: [{ lines }] }] },
  });
  mocks.recognize
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(
      page([
        {
          text: "PRIMEROV",
          confidence: 90,
          bbox: { x0: 10, y0: 30, x1: 80, y1: 45 },
        },
        {
          text: first,
          confidence: 60,
          bbox: { x0: 10, y0: 110, x1: 190, y1: 125 },
        },
      ]),
    )
    .mockResolvedValueOnce({ data: { text: first } })
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(page([]))
    .mockReturnValue(new Promise(() => {}));
  try {
    const controller = new AbortController();
    const pending = recognizePassport(file, 0, controller.signal, vi.fn());
    const failure = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(mocks.recognize).toHaveBeenCalledTimes(7));
    controller.abort();
    await failure;
    for (const image of images) {
      expect(image.width).toBe(1);
      expect(image.height).toBe(1);
    }
    const crop = mocks.recognize.mock.calls.at(-1)?.[0];
    expect(crop.width).toBe(1);
    expect(crop.height).toBe(1);
  } finally {
    drawing.mockRestore();
  }
});
it("discards initialization after cancellation and terminates the worker when it eventually becomes available", async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  mocks.prepare.mockResolvedValue(canvas);
  let initialize!: (value: typeof worker) => void;
  mocks.createWorker.mockReturnValue(
    new Promise((resolve) => {
      initialize = resolve;
    }),
  );
  const controller = new AbortController();
  const pending = recognizePassport(file, 0, controller.signal, vi.fn());
  const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await waitFor(() => expect(mocks.createWorker).toHaveBeenCalled());
  controller.abort();
  await failure;
  initialize(worker);
  await waitFor(() => expect(mocks.terminate).toHaveBeenCalled());
  expect(mocks.recognize).not.toHaveBeenCalled();
  expect(canvas.width).toBe(1);
});
