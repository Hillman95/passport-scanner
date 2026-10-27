import { z } from "zod";
import { isHeifPhoto } from "./heif.js";

export const passportFieldNames = [
  "full_name",
  "last_name",
  "first_name",
  "middle_name",
  "birth_date",
  "sex",
  "passport_surname",
  "passport_given_name",
  "passport_number",
  "passport_issued_on",
  "passport_expires_on",
] as const;
export type PassportField = (typeof passportFieldNames)[number];
export type PassportImportValues = Partial<Record<PassportField, string>>;
export interface PassportCandidate {
  value: string;
  source: "visual" | "mrz";
  checked: boolean;
  warning?: string;
}
export interface PassportRecognition {
  fields: Partial<Record<PassportField, PassportCandidate>>;
  warnings: string[];
  mrz: "valid" | "partial" | "unreadable";
}
export interface PassportOcrLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export function mergePassportRecognition(
  primary: PassportRecognition,
  enhanced: PassportRecognition,
): PassportRecognition {
  const fields = { ...primary.fields, ...enhanced.fields };
  for (const name of passportFieldNames) {
    const before = primary.fields[name],
      after = enhanced.fields[name];
    if (before && after && !before.warning && after.warning)
      fields[name] = before;
    // An enhanced pass can drop the final letter. Keep the longer of two
    // actually observed name readings when one is an exact prefix of the other.
    if (
      before &&
      after &&
      (name.endsWith("_name") || name === "passport_surname") &&
      before.value.startsWith(after.value)
    )
      fields[name] = before;
    if (before?.checked && !after?.checked) fields[name] = before;
    const chosen = fields[name];
    if (chosen && before && after && before.value !== after.value)
      fields[name] = {
        ...chosen,
        warning:
          "Повторное чтение дало другой результат. Сверьте каждый символ со снимком.",
      };
  }
  return {
    ...enhanced,
    fields,
    warnings: enhanced.warnings.filter(
      (warning) =>
        !(warning.startsWith("Дата рождения в MRZ:") && fields.birth_date) &&
        !(
          warning.startsWith("Срок действия в MRZ:") &&
          fields.passport_expires_on
        ),
    ),
  };
}

const cyrillic = /^[А-ЯЁ]+(?:[ '-][А-ЯЁ]+)*$/i;
const latin = /^[A-Z]+(?:[ '-][A-Z]+)*$/i;
export function passportValueError(name: PassportField, value: string) {
  if (!value.trim()) return "Введите значение или снимите флажок переноса";
  if (name === "full_name")
    return value.length <= 300 &&
      /^[А-ЯЁA-Z]+(?:[ '-][А-ЯЁA-Z]+)*$/i.test(value)
      ? undefined
      : "Проверьте ФИО целиком";
  if (name.endsWith("_on") || name === "birth_date")
    return z.iso.date().safeParse(value).success
      ? undefined
      : "Введите существующую дату";
  if (name === "sex")
    return value === "male" || value === "female" ? undefined : "Выберите пол";
  if (name === "passport_number")
    return /^[A-Z0-9]{3,30}$/i.test(value)
      ? undefined
      : "Используйте от 3 до 30 латинских букв и цифр";
  return value.length <= 100 &&
    (name.startsWith("passport_") ? latin : cyrillic).test(value)
    ? undefined
    : name.startsWith("passport_")
      ? "Проверьте написание латиницей"
      : "Проверьте написание кириллицей";
}

export function passportFileError(
  file: Pick<File, "size" | "type"> & { name?: string },
) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) &&
    !isHeifPhoto(file)
  )
    return "Выберите фотографию JPEG, PNG, WebP или HEIC/HEIF. PDF сначала преобразуйте в изображение.";
  if (!file.size || file.size > 15 * 1024 * 1024)
    return "Размер фотографии должен быть от 1 байта до 15 МБ";
}
