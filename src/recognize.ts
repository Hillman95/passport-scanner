import { PSM, type Page } from "tesseract.js";
import {
  defaultPassportWorkerPool,
  type PassportWorkerPool,
} from "./worker.js";
import { extractPassport, isoDate } from "./parser.js";
import { preparePassportImage } from "./image.js";
import { passportDetailRegions, mergePassportDetails } from "./detail.js";
import {
  mergePassportRecognition,
  passportFileError,
  type PassportOcrLine,
  type PassportCandidate,
} from "./model.js";

function lines(page: Page): PassportOcrLine[] {
  return (page.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.map(({ text, confidence, bbox }) => ({
        text,
        confidence,
        bbox,
      })),
    ),
  );
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function recognizePassport(
  file: File,
  quarterTurns: number,
  signal: AbortSignal,
  progress: (message: string) => void,
  pool: PassportWorkerPool = defaultPassportWorkerPool,
) {
  const invalid = passportFileError(file);
  if (invalid) throw new Error(invalid);
  signal.throwIfAborted();
  progress("Подготовка и выравнивание снимка…");
  const image = await preparePassportImage(file, quarterTurns);
  let lease: ReturnType<PassportWorkerPool["reserve"]> | undefined;
  let healthy = false;
  let enhancedImage: HTMLCanvasElement | undefined;
  let stage = "Загрузка локального OCR…";
  const abort = () => {
    lease?.discard();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    progress(stage);
    lease = pool.reserve((fraction) => {
      if (!signal.aborted) progress(`${stage} ${Math.round(fraction * 100)}%`);
    });
    const worker = await abortable(lease.ready, signal);
    signal.throwIfAborted();
    stage = "Чтение паспортных полей…";
    progress(stage);
    await abortable(
      worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "",
        thresholding_method: "0",
        user_defined_dpi: "0",
      }),
      signal,
    );
    const english = lines(
      (
        await abortable(
          worker.recognize(image, {}, { text: true, blocks: true }),
          signal,
        )
      ).data,
    );
    signal.throwIfAborted();
    const mrz: string[] = [];
    const readMrz = async (
      source: HTMLCanvasElement,
      observed: PassportOcrLine[],
    ) => {
      const zones = observed.filter((line) => {
        const text = line.text.replace(/\s/g, "");
        return (
          text.length >= 30 &&
          (text.startsWith("P<") ||
            /^[A-Z0-9<]{9}\d[A-Z]{3}/.test(text) ||
            (line.bbox.y0 > source.height * 0.55 &&
              line.bbox.x1 - line.bbox.x0 > source.width * 0.55 &&
              text.includes("<")))
        );
      });
      stage = "Проверка машиночитаемых строк…";
      progress(stage);
      if (zones.length) await abortable(worker.reinitialize("mrz", 1), signal);
      await abortable(
        worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        }),
        signal,
      );
      for (const zone of zones.slice(-2)) {
        signal.throwIfAborted();
        const padding = Math.max(10, (zone.bbox.y1 - zone.bbox.y0) * 0.4);
        const left = Math.max(0, Math.floor(zone.bbox.x0 - padding));
        const top = Math.max(0, Math.floor(zone.bbox.y0 - padding));
        const width = Math.min(
          source.width - left,
          Math.ceil(zone.bbox.x1 - left + padding),
        );
        const height = Math.min(
          source.height - top,
          Math.ceil(zone.bbox.y1 - top + padding),
        );
        const crop = document.createElement("canvas");
        crop.width = width;
        crop.height = height;
        const context = crop.getContext("2d");
        if (!context) continue;
        context.drawImage(
          source,
          left,
          top,
          width,
          height,
          0,
          0,
          width,
          height,
        );
        try {
          mrz.push((await abortable(worker.recognize(crop), signal)).data.text);
        } finally {
          crop.width = crop.height = 1;
        }
      }
    };
    await readMrz(image, english);
    signal.throwIfAborted();
    stage = "Чтение ФИО кириллицей…";
    progress(stage);
    await abortable(worker.reinitialize("rus", 1), signal);
    await abortable(
      worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "",
      }),
      signal,
    );
    const russian = lines(
      (
        await abortable(
          worker.recognize(image, {}, { text: true, blocks: true }),
          signal,
        )
      ).data,
    );
    signal.throwIfAborted();
    const primary = extractPassport(english, russian, mrz);
    const complete = [
      "last_name",
      "first_name",
      "passport_surname",
      "passport_given_name",
      "birth_date",
      "passport_number",
      "passport_issued_on",
      "passport_expires_on",
    ] as const;
    if (
      complete.every(
        (name) => primary.fields[name] && !primary.fields[name]?.warning,
      ) &&
      (primary.fields.first_name?.value.length ?? 0) > 3
    ) {
      healthy = true;
      return primary;
    }

    stage = "Улучшение контраста и повторное чтение…";
    progress(stage);
    enhancedImage = await preparePassportImage(file, quarterTurns, {
      enhanced: true,
    });
    signal.throwIfAborted();
    await abortable(worker.reinitialize("eng", 1), signal);
    await abortable(
      worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "",
        thresholding_method: "2",
        user_defined_dpi: "300",
      }),
      signal,
    );
    const sparse = lines(
      (
        await abortable(
          worker.recognize(enhancedImage, {}, { text: true, blocks: true }),
          signal,
        )
      ).data,
    );
    signal.throwIfAborted();
    await readMrz(enhancedImage, sparse);
    await abortable(worker.reinitialize("rus", 1), signal);
    await abortable(
      worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "",
        thresholding_method: "2",
        user_defined_dpi: "300",
      }),
      signal,
    );
    const enhancedRussian = lines(
      (
        await abortable(
          worker.recognize(enhancedImage, {}, { text: true, blocks: true }),
          signal,
        )
      ).data,
    );
    signal.throwIfAborted();
    await abortable(worker.reinitialize("eng+rus", 1), signal);
    stage = "Уточнение расположения полей…";
    progress(stage);
    await abortable(
      worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO }),
      signal,
    );
    const automatic = lines(
      (
        await abortable(
          worker.recognize(enhancedImage, {}, { text: true, blocks: true }),
          signal,
        )
      ).data,
    );
    signal.throwIfAborted();
    const result = mergePassportRecognition(
      primary,
      extractPassport(
        [...sparse, ...automatic],
        [...enhancedRussian, ...automatic],
        mrz,
      ),
    );
    const regions = passportDetailRegions(
      sparse,
      result,
      mrz,
      enhancedImage.width,
      enhancedImage.height,
    );
    if (!regions.length) {
      healthy = true;
      return result;
    }
    stage = "Уточнение кириллицы и даты выдачи…";
    progress(stage);
    const detailBaseWidth = enhancedImage.width;
    image.width = image.height = 1;
    enhancedImage.width = enhancedImage.height = 1;
    const detailed = await preparePassportImage(file, quarterTurns, {
      enhanced: true,
      detail: true,
    });
    try {
      signal.throwIfAborted();
      const scale = detailed.width / detailBaseWidth;
      const detailEnglish: PassportOcrLine[] = [],
        detailRussian: PassportOcrLine[] = [];
      let issue: PassportCandidate | undefined;
      for (const region of regions) {
        signal.throwIfAborted();
        const crop = document.createElement("canvas");
        const left = Math.floor(region.left * scale),
          top = Math.floor(region.top * scale);
        crop.width = Math.min(
          detailed.width - left,
          Math.ceil(region.width * scale),
        );
        crop.height = Math.min(
          detailed.height - top,
          Math.ceil(region.height * scale),
        );
        try {
          const context = crop.getContext("2d");
          if (!context) continue;
          context.drawImage(
            detailed,
            left,
            top,
            crop.width,
            crop.height,
            0,
            0,
            crop.width,
            crop.height,
          );
          const positioned = (page: Page) =>
            lines(page).map((line) => ({
              ...line,
              bbox: {
                x0: region.left + line.bbox.x0 / scale,
                y0: region.top + line.bbox.y0 / scale,
                x1: region.left + line.bbox.x1 / scale,
                y1: region.top + line.bbox.y1 / scale,
              },
            }));
          await abortable(worker.reinitialize("eng", 1), signal);
          await abortable(
            worker.setParameters({
              tessedit_pageseg_mode:
                region.kind === "names" ? PSM.SINGLE_BLOCK : PSM.SINGLE_LINE,
              tessedit_char_whitelist:
                region.kind === "names" ? "" : "0123456789./-",
              thresholding_method: region.kind === "names" ? "2" : "0",
              user_defined_dpi: "300",
            }),
            signal,
          );
          const english = (
            await abortable(
              worker.recognize(crop, {}, { text: true, blocks: true }),
              signal,
            )
          ).data;
          if (region.kind === "issue-date") {
            const text = english.text.trim().replace(/\s/g, "");
            const value = /^\d{2}[.\-/]\d{2}[.\-/]\d{4}$/.test(text)
              ? isoDate(text)
              : undefined;
            if (value)
              issue = {
                value,
                source: "visual",
                checked: false,
                warning:
                  "Дата выдачи прочитана отдельно по расположению строки. Сверьте все цифры со снимком.",
              };
          } else {
            detailEnglish.push(...positioned(english));
            await abortable(worker.reinitialize("rus", 1), signal);
            await abortable(
              worker.setParameters({
                tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
                tessedit_char_whitelist: "",
                thresholding_method: "2",
                user_defined_dpi: "300",
              }),
              signal,
            );
            const russian = (
              await abortable(
                worker.recognize(crop, {}, { text: true, blocks: true }),
                signal,
              )
            ).data;
            detailRussian.push(...positioned(russian));
          }
        } finally {
          crop.width = crop.height = 1;
        }
      }
      signal.throwIfAborted();
      healthy = true;
      return mergePassportDetails(
        result,
        extractPassport(detailEnglish, detailRussian, mrz),
        issue,
      );
    } finally {
      detailed.width = detailed.height = 1;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    if (healthy && !signal.aborted) await lease?.release();
    else lease?.discard();
    image.width = 1;
    image.height = 1;
    if (enhancedImage) {
      enhancedImage.width = 1;
      enhancedImage.height = 1;
    }
  }
}
