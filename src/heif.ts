import { z } from "zod";

export const HEIF_CONVERSION_ERROR =
  "Не удалось открыть HEIC/HEIF. Попробуйте другое фото или сохраните его в JPEG.";

export function isHeifPhoto(file: { type: string; name?: string }) {
  return (
    /^image\/hei[cf](?:-sequence)?$/i.test(file.type) ||
    ((!file.type || file.type === "application/octet-stream") &&
      /\.hei[cf]$/i.test(file.name ?? ""))
  );
}

const pixelsSchema = z
  .strictObject({
    width: z.number().int().min(300),
    height: z.number().int().min(300),
    pixels: z.instanceof(ArrayBuffer),
  })
  .refine(
    ({ width, height, pixels }) =>
      width * height <= 40_000_000 && pixels.byteLength === width * height * 4,
  );

export async function convertHeifPhoto(
  file: File,
  signal: AbortSignal,
  workerPath = "/ocr/heif-v1.23.5/worker.js",
) {
  signal.throwIfAborted();
  const payload = await new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(workerPath);
    const cleanup = () => {
      worker.terminate();
      worker.onmessage = null;
      worker.onerror = null;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(HEIF_CONVERSION_ERROR));
    }, 60_000);
    worker.onmessage = (event: MessageEvent<unknown>) => {
      cleanup();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      cleanup();
      reject(new Error(HEIF_CONVERSION_ERROR));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else worker.postMessage(file);
  });
  signal.throwIfAborted();
  const decoded = pixelsSchema.safeParse(payload);
  if (!decoded.success) throw new Error(HEIF_CONVERSION_ERROR);
  const { width, height, pixels } = decoded.data;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error(HEIF_CONVERSION_ERROR);
    context.putImageData(
      new ImageData(new Uint8ClampedArray(pixels), width, height),
      0,
      0,
    );
    const blob = await new Promise<Blob>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      canvas.toBlob(
        (blob) => {
          signal.removeEventListener("abort", abort);
          if (blob) resolve(blob);
          else reject(new Error(HEIF_CONVERSION_ERROR));
        },
        "image/jpeg",
        0.98,
      );
    });
    signal.throwIfAborted();
    return new File([blob], file.name.replace(/\.hei[cf]$/i, "") + ".jpg", {
      type: "image/jpeg",
    });
  } finally {
    canvas.width = canvas.height = 1;
  }
}
