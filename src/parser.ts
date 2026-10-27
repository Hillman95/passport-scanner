import { parse, states } from "mrz";
import {
  passportValueError,
  type PassportField,
  type PassportOcrLine,
  type PassportRecognition,
} from "./model.js";

export function isoDate(value: string) {
  const match = value.match(
    /\b(\d{2})\s*[./-]\s*(\d{2})(?:\s*[./-]\s*|\s+)(\d{4})\b/,
  );
  if (!match) return;
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  if (!passportValueError("birth_date", date)) return date;
}

// ICAO 9303, TD3. A successful digit checks this substring, never a person's identity.
export function mrzCheckDigit(text: string, digit: string) {
  if (!/^[A-Z0-9<]+$/.test(text) || !/^\d$/.test(digit)) return false;
  const sum = [...text].reduce((total, char, index) => {
    const value = char === "<" ? 0 : parseInt(char, 36);
    return total + value * [7, 3, 1][index % 3];
  }, 0);
  return sum % 10 === Number(digit);
}

export function extractPassport(
  english: PassportOcrLine[],
  russian: PassportOcrLine[],
  mrzText: string[],
  now = new Date(),
): PassportRecognition {
  const result: PassportRecognition = {
    fields: {},
    warnings: [],
    mrz: "unreadable",
  };
  const all = [...english, ...russian];
  const add = (
    name: PassportField,
    value: string | undefined,
    confidence = 0,
    source: "visual" | "mrz" = "visual",
    checked = false,
    warning?: string,
  ) => {
    if (!value || passportValueError(name, value)) return;
    if (
      source === "visual" &&
      (name.endsWith("_name") || name === "passport_surname") &&
      confidence < 40
    )
      return;
    // Isolated glyphs in a masked or damaged name are not a readable name.
    if (
      (name.endsWith("_name") || name === "passport_surname") &&
      value.replace(/[ '-]/g, "").length < 2
    )
      return;
    if (
      source === "visual" &&
      (name.endsWith("_name") || name === "passport_surname") &&
      value.replace(/[ '-]/g, "").length < 3
    )
      warning = "Короткий результат OCR. Проверьте, прочитано ли имя целиком.";
    const previous = result.fields[name];
    if (previous && previous.value !== value) {
      warning =
        "Чтение страницы и MRZ различается. Сверьте значение со снимком.";
      if (
        (name.endsWith("_name") || name === "passport_surname") &&
        (previous.value.startsWith(value) ||
          (previous.source === "mrz" &&
            source === "mrz" &&
            !value.startsWith(previous.value)))
      ) {
        result.fields[name] = { ...previous, checked: false, warning };
        return;
      }
    }
    result.fields[name] = {
      value,
      source,
      checked,
      warning:
        warning ??
        (confidence < 80 && !checked
          ? "Низкая уверенность. Проверьте каждый символ."
          : undefined),
    };
  };
  const anchor = (pattern: RegExp) =>
    all
      .filter((line) => pattern.test(line.text))
      .sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
  const below = (
    lines: PassportOcrLine[],
    label?: PassportOcrLine,
    end?: PassportOcrLine,
  ) => {
    if (!label) return [];
    const height = Math.max(15, label.bbox.y1 - label.bbox.y0);
    return lines
      .filter(
        (line) =>
          line.bbox.y0 >= label.bbox.y1 - height * 0.2 &&
          line.bbox.y0 < (end?.bbox.y0 ?? label.bbox.y1 + height * 5) &&
          Math.abs(line.bbox.x0 - label.bbox.x0) <
            Math.min(80, Math.max(30, height * 2)),
      )
      .sort((a, b) => a.bbox.y0 - b.bbox.y0);
  };
  const surname = anchor(/surname|Ф[ао][мл]илия/i);
  const given = anchor(/given\s*name|Имя\s*\//i);
  const nationality = anchor(/nationality|гражданство/i);
  const clean = (line: PassportOcrLine) =>
    line.text
      .trim()
      // A slash terminates the printed name. OCR may duplicate that divider
      // or read it as a bar; text beyond it is not part of the name.
      .split(/[/|]/, 1)[0]
      .trim()
      .toUpperCase();
  const cyrSurname = below(russian, surname, given).find(
    (line) => !passportValueError("last_name", clean(line)),
  );
  if (cyrSurname) add("last_name", clean(cyrSurname), cyrSurname.confidence);
  const cyrGiven = below(russian, given, nationality).find(
    (line) => !passportValueError("first_name", clean(line)),
  );
  if (cyrGiven) {
    const words = clean(cyrGiven).split(/\s+/);
    if (words.length <= 2) add("first_name", words[0], cyrGiven.confidence);
    if (words.length === 2) add("middle_name", words[1], cyrGiven.confidence);
    if (words.length > 2)
      result.warnings.push(
        "Имя и отчество содержат несколько слов. Заполните их вручную по снимку.",
      );
  }
  const latinSurname = below(english, surname, given)
    .filter((line) => !passportValueError("passport_surname", clean(line)))
    .at(-1);
  if (latinSurname)
    add("passport_surname", clean(latinSurname), latinSurname.confidence);
  const latinGiven = below(english, given, nationality)
    .filter((line) => !passportValueError("passport_given_name", clean(line)))
    .at(-1);
  if (latinGiven)
    add("passport_given_name", clean(latinGiven), latinGiven.confidence);

  const datePatterns = [
    ["birth_date", /date\s*of\s*birth|дата\s*рожд/i],
    ["passport_issued_on", /date\s*of\s*issue|дата\s*выдач/i],
    ["passport_expires_on", /(?:date\s*of\s*)?\w?xpiry|окончан|действия/i],
  ] as const;
  for (const [name, pattern] of datePatterns) {
    const label = anchor(pattern);
    const boundary =
      label &&
      all
        .filter(
          (line) =>
            line.bbox.y0 > label.bbox.y1 &&
            Math.abs(line.bbox.x0 - label.bbox.x0) < 80 &&
            !pattern.test(line.text) &&
            (datePatterns.some(([, next]) => next.test(line.text)) ||
              /\bsex\b|^пол\s*\//i.test(line.text)),
        )
        .sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
    const dates = [
      ...(label ? [label] : []),
      ...below(all, label, boundary),
    ].filter((line) => isoDate(line.text));
    const line = dates[0];
    if (line) add(name, isoDate(line.text), line.confidence);
  }
  const number = below(
    english,
    anchor(/passport\s*no\.?|номер\s*паспорта/i),
  ).find((line) => /^\d{9}$/.test(line.text.replace(/\s/g, "")));
  if (number)
    add("passport_number", number.text.replace(/\s/g, ""), number.confidence);

  const lines = [...mrzText, ...english.map((line) => line.text)]
    .flatMap((text) => text.split("\n"))
    .map((line) => line.toUpperCase().replace(/\s/g, ""));
  const firsts = [...new Set(lines)].filter(
    (line) =>
      line.length === 44 &&
      /^P<[A-Z]{3}[A-Z<]+$/.test(line) &&
      Object.hasOwn(states, line.slice(2, 5)) &&
      /^[A-Z]+(?:<[A-Z]+)*<<[A-Z]+(?:<[A-Z]+)*<*$/.test(line.slice(5)),
  );
  const first = firsts[0];
  const second = lines.find((line) =>
    /^[A-Z0-9<]{9}\d[A-Z]{3}[A-Z0-9<]{15}/.test(line),
  );
  if (second) {
    result.mrz = "partial";
    const number = second.slice(0, 9);
    if (mrzCheckDigit(number, second[9]))
      add("passport_number", number.replace(/<+$/, ""), 100, "mrz", true);
    const mrzDate = (
      name: "birth_date" | "passport_expires_on",
      raw: string,
    ) => {
      const visual = result.fields[name]?.value;
      // A full visible date can corroborate the century even if its caption is unreadable.
      const matchingDates = [
        ...new Set(
          all
            .map((line) => isoDate(line.text))
            .filter(
              (date): date is string =>
                !!date && date.slice(2).replace(/-/g, "") === raw,
            ),
        ),
      ];
      if (matchingDates.length === 1) {
        add(name, matchingDates[0], 100, "mrz", true);
        return;
      }
      // Six digits do not establish a century. Never invent the full year.
      if (visual) {
        result.fields[name] = {
          value: visual,
          source: "visual",
          checked: false,
          warning:
            "Дата на странице и в MRZ различается. Сверьте полный год и остальные цифры.",
        };
      } else {
        result.warnings.push(
          `${name === "birth_date" ? "Дата рождения" : "Срок действия"} в MRZ: ${raw.slice(4, 6)}.${raw.slice(2, 4)}.${raw.slice(0, 2)}. Полный год не прочитан; введите дату вручную.`,
        );
      }
    };
    if (mrzCheckDigit(second.slice(13, 19), second[19]))
      mrzDate("birth_date", second.slice(13, 19));
    if (mrzCheckDigit(second.slice(21, 27), second[27]))
      mrzDate("passport_expires_on", second.slice(21, 27));
    if (["M", "F"].includes(second[20]))
      add("sex", second[20] === "M" ? "male" : "female", 80, "mrz");
    if (first && second.length === 44) {
      try {
        const parsed = parse([first, second]);
        if (parsed.valid) {
          result.mrz = "valid";
        }
      } catch {
        // Partial OCR stays partial; never pad, trim or invent an MRZ character.
      }
    }
  }
  // TD3 name fields have no check digit. A damaged second line must not erase
  // a readable first line; every differing reading still requires review.
  for (const line of firsts) {
    if (result.mrz === "unreadable") result.mrz = "partial";
    const [surname, given] = line.slice(5).replace(/<+$/, "").split("<<");
    const warning =
      result.mrz !== "valid" || !line.endsWith("<")
        ? "Сверьте имя из MRZ со страницей: контрольные цифры не проверяют буквы имени."
        : undefined;
    add(
      "passport_surname",
      surname.replace(/</g, " "),
      80,
      "mrz",
      false,
      warning,
    );
    add(
      "passport_given_name",
      given.replace(/</g, " "),
      80,
      "mrz",
      false,
      warning,
    );
  }
  // Russian passports print Cyrillic directly above the same Latin name.
  // A readable MRZ and an exact visual Latin match can anchor that row when
  // small captions disappear. Never transliterate or reconstruct hidden text.
  if (first?.slice(2, 5) === "RUS") {
    for (const [latinField, cyrillicField] of [
      ["passport_surname", "last_name"],
      ["passport_given_name", "first_name"],
    ] as const) {
      if (result.fields[cyrillicField]) continue;
      const latin = result.fields[latinField]?.value;
      if (!latin) continue;
      const visual = english
        .filter((line) => clean(line) === latin)
        .sort((a, b) => b.confidence - a.confidence)[0];
      if (!visual) continue;
      const height = Math.max(10, visual.bbox.y1 - visual.bbox.y0);
      const above = russian
        .filter((line) => {
          const value = clean(line);
          return (
            !/[а-яё]/.test(line.text) &&
            !/^(?:ФАМИЛИЯ|ИМЯ|ГРАЖДАНСТВО)$/.test(value) &&
            !passportValueError(cyrillicField, value) &&
            line.bbox.y0 < visual.bbox.y0 &&
            line.bbox.y0 > visual.bbox.y0 - height * 2.5 &&
            line.bbox.y1 <= visual.bbox.y0 + height * 0.3 &&
            Math.abs(line.bbox.x0 - visual.bbox.x0) < height * 2 &&
            line.confidence >= 40
          );
        })
        .sort(
          (a, b) => b.bbox.y0 - a.bbox.y0 || b.confidence - a.confidence,
        )[0];
      if (!above) continue;
      const words = clean(above).split(/\s+/);
      const warning =
        "Подпись поля не прочитана. Сверьте кириллицу со снимком.";
      if (cyrillicField === "last_name")
        add(
          cyrillicField,
          clean(above),
          above.confidence,
          "visual",
          false,
          warning,
        );
      else if (words.length <= 2) {
        add("first_name", words[0], above.confidence, "visual", false, warning);
        if (words.length === 2)
          add(
            "middle_name",
            words[1],
            above.confidence,
            "visual",
            false,
            warning,
          );
      }
    }
    // Read the issue date only if two checksum-corroborated visible dates
    // bracket exactly one full date in the same printed column.
    const birth = result.fields.birth_date,
      expiry = result.fields.passport_expires_on;
    if (
      !result.fields.passport_issued_on &&
      birth?.checked &&
      expiry?.checked
    ) {
      const birthLine = all.find((line) => isoDate(line.text) === birth.value);
      const expiryLine = all.find(
        (line) => isoDate(line.text) === expiry.value,
      );
      if (birthLine && expiryLine && birthLine.bbox.y1 < expiryLine.bbox.y0) {
        const dates = all.filter((line) => {
          const value = isoDate(line.text);
          return (
            value &&
            value > birth.value &&
            value < expiry.value &&
            line.bbox.y0 > birthLine.bbox.y1 &&
            line.bbox.y1 < expiryLine.bbox.y0 &&
            Math.abs(line.bbox.x0 - birthLine.bbox.x0) <
              Math.max(40, (birthLine.bbox.y1 - birthLine.bbox.y0) * 3)
          );
        });
        if (new Set(dates.map((line) => isoDate(line.text))).size === 1)
          add(
            "passport_issued_on",
            isoDate(dates[0].text),
            dates[0].confidence,
            "visual",
            false,
            "Дата определена по расположению между датой рождения и сроком действия. Сверьте дату выдачи со снимком.",
          );
      }
    }
  }
  if (result.mrz === "unreadable")
    result.warnings.push(
      "MRZ не удалось прочитать. Сверьте данные страницы вручную.",
    );
  else if (result.mrz === "partial")
    result.warnings.push(
      "MRZ прочитана не полностью. Проверены только поля с доступными контрольными цифрами.",
    );
  const expiry = result.fields.passport_expires_on?.value;
  const issued = result.fields.passport_issued_on?.value;
  const birth = result.fields.birth_date?.value;
  if (issued && ((expiry && issued >= expiry) || (birth && birth > issued)))
    result.fields.passport_issued_on = {
      value: issued,
      source: "visual",
      checked: false,
      warning:
        "Порядок дат не сходится. Сверьте дату выдачи со страницей паспорта.",
    };
  if (expiry && expiry < now.toISOString().slice(0, 10))
    result.warnings.push(
      "Считанный срок действия паспорта истёк. Проверьте дату.",
    );
  return result;
}
