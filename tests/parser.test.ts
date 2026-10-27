import { expect, it } from "vitest";
import { extractPassport, mrzCheckDigit } from "../src/parser.js";
import {
  mergePassportRecognition,
  type PassportOcrLine,
} from "../src/model.js";
const mrz = [
  "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
  "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
].map((value) => value.replace("UTO", "RUS")); // Same ICAO digits; the parser requires a real country code.
function line(text: string, y: number, confidence = 90): PassportOcrLine {
  return { text, confidence, bbox: { x0: 400, y0: y, x1: 600, y1: y + 15 } };
}

it("uses matching visible Latin rows and ignores duplicated printed name dividers", () => {
  const result = extractPassport(
    [line("ERIKSSON", 60), line("ANNA MARIA", 130)],
    [line("ЭРИКССОН / |", 40), line("АННА МАРИЯ / |", 110)],
    mrz,
  );
  expect(result.fields.last_name).toMatchObject({
    value: "ЭРИКССОН",
    checked: false,
    warning: expect.any(String),
  });
  expect(result.fields.first_name?.value).toBe("АННА");
  expect(result.fields.middle_name?.value).toBe("МАРИЯ");
});

it("does not mistake a Cyrillic caption for an obscured name or infer names without MRZ", () => {
  for (const rows of [mrz, []]) {
    const result = extractPassport(
      [line("ERIKSSON", 60)],
      [line("Фамилия", 40)],
      rows,
    );
    expect(result.fields.last_name).toBeUndefined();
  }
});

it("reads a visible issue date bracketed by checksum-corroborated dates, but leaves ambiguous dates empty", () => {
  const dates = [
    line("12.08.1974", 180),
    line("15.04.2002", 240),
    line("15.04.2012", 300),
  ];
  expect(
    extractPassport(dates, [], mrz).fields.passport_issued_on,
  ).toMatchObject({
    value: "2002-04-15",
    checked: false,
    warning: expect.any(String),
  });
  expect(
    extractPassport([...dates, line("16.04.2002", 265)], [], mrz).fields
      .passport_issued_on,
  ).toBeUndefined();
  expect(
    extractPassport(dates, [], []).fields.passport_issued_on,
  ).toBeUndefined();
});
it("checks the ICAO example and never accepts a changed number's check digit", () => {
  expect(mrzCheckDigit("L898902C3", "6")).toBe(true);
  expect(mrzCheckDigit("L898902C4", "6")).toBe(false);
  const result = extractPassport([], [], mrz);
  expect(result.mrz).toBe("valid");
  expect(result.fields.passport_number).toMatchObject({
    value: "L898902C3",
    checked: true,
  });
  expect(result.fields.passport_surname?.value).toBe("ERIKSSON");
  expect(result.fields.passport_given_name?.value).toBe("ANNA MARIA");
  expect(result.fields.sex).toMatchObject({ value: "female", checked: false });
  expect(result.fields.birth_date).toBeUndefined();
  expect(result.warnings.join(" ")).toMatch(/Полный год не прочитан/);
});

it("reads a date joined to its caption and accepts a visible four-digit year after whitespace", () => {
  const result = extractPassport(
    [
      line("Дата выдачи / Date of issue 15.04.2021", 30),
      line("Дата окончания действия / Date of expiry", 90),
      line("15.04 2031", 110),
    ],
    [],
    [],
  );
  expect(result.fields.passport_issued_on?.value).toBe("2021-04-15");
  expect(result.fields.passport_expires_on?.value).toBe("2031-04-15");
});

it("does not replace a complete observed name with an enhanced reading missing its last letter", () => {
  const result = mergePassportRecognition(
    {
      mrz: "partial",
      warnings: [],
      fields: {
        last_name: { value: "ПРИМЕРОВ", source: "visual", checked: false },
      },
    },
    {
      mrz: "partial",
      warnings: [],
      fields: {
        last_name: { value: "ПРИМЕРО", source: "visual", checked: false },
      },
    },
  );
  expect(result.fields.last_name).toMatchObject({
    value: "ПРИМЕРОВ",
    warning: expect.any(String),
  });
});
it("keeps separately checked fields when MRZ fillers are damaged, without inventing names or issue date", () => {
  const result = extractPassport([], [], [mrz[1].slice(0, 28) + "<<<<K<<"]);
  expect(result.mrz).toBe("partial");
  expect(result.fields.passport_number?.value).toBe("L898902C3");
  expect(result.fields.passport_surname).toBeUndefined();
  expect(result.fields.passport_issued_on).toBeUndefined();
  const invalid = extractPassport(
    [],
    [],
    [mrz[1].replace("L898902C3", "L898902C4")],
  );
  expect(invalid.fields.passport_number).toBeUndefined();
  const brokenBirth = extractPassport(
    [],
    [],
    [mrz[1].replace("740812", "74O812")],
  );
  expect(brokenBirth.fields.passport_number?.value).toBe("L898902C3");
  expect(brokenBirth.fields.birth_date).toBeUndefined();
});
it("reads Cyrillic from the visual page, not reverse transliteration, and validates the full year", () => {
  const russian = [
    line("Фамилия / Surname", 30),
    line("ПРИМЕРОВА", 50),
    line("Имя / Given names", 90),
    line("АННА МАРИЯ", 110, 55),
    line("Гражданство / Nationality", 160),
    line("Дата рождения / Date of birth", 200),
    line("12.08.1974", 220),
    line("Дата выдачи / Date of issue", 260),
    line("15.04.2002", 280),
    line("Дата окончания действия / Date of expiry", 320),
    line("15.04.2012", 340),
  ];
  const result = extractPassport([], russian, mrz);
  expect(result.fields.last_name?.value).toBe("ПРИМЕРОВА");
  expect(result.fields.first_name).toMatchObject({
    value: "АННА",
    warning: expect.stringContaining("уверенность"),
  });
  expect(result.fields.middle_name?.value).toBe("МАРИЯ");
  expect(result.fields.birth_date).toMatchObject({
    value: "1974-08-12",
    checked: true,
    warning: undefined,
  });
  expect(result.fields.passport_issued_on?.value).toBe("2002-04-15");
  expect(result.warnings.join(" ")).toMatch(/истёк/);
});
it("returns no invented fields for masked/unreadable text or impossible visual dates", () => {
  expect(
    extractPassport(
      [],
      [line("Фамилия / Surname", 20), line("НОА", 40, 20)],
      [],
    ).fields.last_name,
  ).toBeUndefined();
  const maskedBirth = extractPassport(
    [],
    [
      line("Дата рождения / Date of birth", 20),
      line("Дата выдачи / Date of issue", 60),
      line("05.02.2014", 80),
    ],
    [],
  );
  expect(maskedBirth.fields.birth_date).toBeUndefined();
  expect(maskedBirth.fields.passport_issued_on?.value).toBe("2014-02-05");
  expect(
    extractPassport([], [line("Фамилия / Surname", 20), line("А", 40)], [])
      .fields.last_name,
  ).toBeUndefined();
  expect(extractPassport([line("XXXXXXXXXXXX", 20)], [], []).fields).toEqual(
    {},
  );
  expect(
    extractPassport([], [line("Дата рождения", 20), line("31.02.1990", 40)], [])
      .fields.birth_date,
  ).toBeUndefined();
});
it("corroborates the full year using a visible date and the MRZ when a caption is unreadable", () => {
  const result = extractPassport(
    [line("12.08.1974", 50), line("15.04.2012", 100)],
    [],
    mrz,
  );
  expect(result.fields.birth_date).toMatchObject({
    value: "1974-08-12",
    checked: true,
  });
  expect(result.fields.passport_expires_on).toMatchObject({
    value: "2012-04-15",
    checked: true,
  });
});
it("reads the complete first-line name when unrelated second-line digits are unreadable", () => {
  const first = "P<RUSPRIMEROV<<TESTIN".padEnd(44, "<");
  const result = extractPassport(
    [line("Given names", 30), line("TESTI", 50), line("Nationality", 90)],
    [],
    [first],
  );
  expect(result.mrz).toBe("partial");
  expect(result.fields.passport_given_name).toMatchObject({
    value: "TESTIN",
    source: "mrz",
    checked: false,
    warning: expect.any(String),
  });
  expect(result.fields.passport_number).toBeUndefined();
});

it.each([true, false])(
  "retains the longer observed MRZ name regardless of read order: %s",
  (longFirst) => {
    const long = "P<RUSPRIMEROV<<TESTIN".padEnd(44, "<");
    const short = "P<RUSPRIMEROV<<TESTI".padEnd(44, "<");
    const result = extractPassport(
      [],
      [],
      longFirst ? [long, short] : [short, long],
    );
    expect(result.fields.passport_given_name).toMatchObject({
      value: "TESTIN",
      warning: expect.any(String),
    });
  },
);

it("does not replace a complete visible name with a shorter name in a checksum-valid MRZ", () => {
  const short = "P<RUSERIKSSON<<ANNA<MARI".padEnd(44, "<");
  const result = extractPassport(
    [line("Given names", 30), line("ANNA MARIA", 50), line("Nationality", 90)],
    [],
    [short, mrz[1]],
  );
  expect(result.mrz).toBe("valid");
  expect(result.fields.passport_given_name).toMatchObject({
    value: "ANNA MARIA",
    source: "visual",
    warning: expect.any(String),
  });
});

it.each([
  "P<ZZZPRIMEROV<<TESTIN".padEnd(44, "<"),
  "P<RUSPRIMEROV<TESTIN".padEnd(44, "<"),
  "P<RUSPRIMEROV<<TESTIN".padEnd(43, "<"),
])("rejects malformed standalone name rows", (row) => {
  expect(
    extractPassport([], [], [row]).fields.passport_given_name,
  ).toBeUndefined();
});
