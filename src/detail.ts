import { isoDate } from "./parser.js";
import type {
  PassportCandidate,
  PassportOcrLine,
  PassportRecognition,
} from "./model.js";

export type PassportDetailRegion = {
  kind: "names" | "issue-date";
  left: number;
  top: number;
  width: number;
  height: number;
};

// Regions locate observed printed rows; they do not supply missing characters.
export function passportDetailRegions(
  observed: PassportOcrLine[],
  result: PassportRecognition,
  mrz: string[],
  width: number,
  height: number,
): PassportDetailRegion[] {
  if (
    !mrz.some((text) =>
      /^P<RUS[A-Z<]{39}$/.test(text.toUpperCase().replace(/\s/g, "")),
    )
  )
    return [];
  const regions: PassportDetailRegion[] = [];
  const region = (
    kind: PassportDetailRegion["kind"],
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) => {
    const left = Math.max(0, Math.floor(x0)),
      top = Math.max(0, Math.floor(y0));
    const w = Math.min(width, Math.ceil(x1)) - left,
      h = Math.min(height, Math.ceil(y1)) - top;
    if (w > 0 && h > 0) regions.push({ kind, left, top, width: w, height: h });
  };
  const uncertainName =
    (["last_name", "first_name", "middle_name"] as const).some((name) => {
      const field = result.fields[name];
      return !field || !!field.warning;
    }) || (result.fields.first_name?.value.length ?? 0) <= 3;
  if (uncertainName) {
    const surname = result.fields.passport_surname?.value;
    const anchor = observed
      .filter(
        (line) =>
          line.text
            .trim()
            .replace(/\s*\/$/, "")
            .toUpperCase() === surname,
      )
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (anchor) {
      const b = anchor.bbox,
        h = Math.max(12, b.y1 - b.y0);
      region("names", b.x0 - h, b.y0 - h * 3, b.x1 + h * 14, b.y1 + h * 8);
    }
  }
  const expiry = result.fields.passport_expires_on;
  if (!result.fields.passport_issued_on && expiry?.checked) {
    const anchor = observed
      .filter((line) => isoDate(line.text) === expiry.value)
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (anchor) {
      const b = anchor.bbox,
        h = Math.max(12, b.y1 - b.y0);
      const candidates = observed
        .filter((line) => {
          const date = isoDate(line.text),
            distance = b.y0 - line.bbox.y0;
          return (
            /\b\d{2}\s*[.\-/]\s*\d{2}\s*[.\-/]\s*[A-Z0-9]{3,5}\b/i.test(
              line.text,
            ) &&
            date !== result.fields.birth_date?.value &&
            distance > h * 1.5 &&
            distance < h * 5.5 &&
            Math.abs(line.bbox.x0 - b.x0) < h * 2
          );
        })
        .sort((a, b) => b.confidence - a.confidence);
      const candidate = candidates[0];
      // Disagreeing OCR on one physical row can be reread; two rows are ambiguous.
      if (
        candidate &&
        candidates.every(
          (line) => Math.abs(line.bbox.y0 - candidate.bbox.y0) < h,
        )
      ) {
        const row = candidate.bbox,
          rh = Math.max(12, row.y1 - row.y0);
        region(
          "issue-date",
          row.x0 - rh * 0.5,
          row.y0 - rh * 0.4,
          row.x1 + rh * 0.5,
          row.y1 + rh * 0.4,
        );
      }
    }
  }
  return regions;
}

export function mergePassportDetails(
  current: PassportRecognition,
  detail: PassportRecognition,
  issue?: PassportCandidate,
): PassportRecognition {
  const fields = { ...current.fields };
  for (const name of ["last_name", "first_name", "middle_name"] as const) {
    const before = fields[name],
      after = detail.fields[name];
    if (!after) continue;
    if (
      !before ||
      (after.value.length > before.value.length &&
        after.value.startsWith(before.value))
    )
      fields[name] = {
        ...after,
        checked: false,
        warning:
          "Перечитано на увеличенном фрагменте. Сверьте кириллицу целиком.",
      };
    else if (before.value !== after.value)
      fields[name] = {
        ...before,
        checked: false,
        warning:
          "Чтение увеличенного фрагмента отличается. Сверьте каждую букву.",
      };
  }
  if (!fields.passport_issued_on && issue) {
    const expiry = fields.passport_expires_on?.value,
      birth = fields.birth_date?.value;
    if ((!expiry || issue.value < expiry) && (!birth || issue.value >= birth))
      fields.passport_issued_on = issue;
  }
  return { ...current, fields };
}
