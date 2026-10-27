import { expect, it } from "vitest";
import { passportDetailRegions, mergePassportDetails } from "../src/detail.js";
import type { PassportOcrLine, PassportRecognition } from "../src/model.js";

const mrz = ["P<RUSPRIMEROV<<TEST".padEnd(44, "<")];
const line = (text: string, y: number): PassportOcrLine => ({
  text,
  confidence: 90,
  bbox: { x0: 400, y0: y, x1: 550, y1: y + 15 },
});
const current: PassportRecognition = {
  mrz: "partial",
  warnings: [],
  fields: {
    passport_expires_on: { value: "2031-04-15", source: "mrz", checked: true },
    passport_surname: { value: "PRIMEROV", source: "mrz", checked: false },
    first_name: { value: "ТЕС", source: "visual", checked: false },
  },
};

it("locates an issue row above verified expiry even when birth is obscured", () => {
  const regions = passportDetailRegions(
    [line("15.04.2021", 240), line("15.04.2031", 300)],
    current,
    mrz,
    1000,
    750,
  );
  expect(regions).toHaveLength(1);
  expect(regions[0]).toMatchObject({ kind: "issue-date" });
  expect(regions[0].top).toBeLessThanOrEqual(240);
  expect(regions[0].top + regions[0].height).toBeGreaterThanOrEqual(255);
});

it("does not classify birth, a different column, two date rows, or unverified expiry as an issue row", () => {
  const expiry = line("15.04.2031", 300);
  for (const observed of [
    [line("12.08.1990", 180), expiry],
    [
      {
        ...line("15.04.2021", 240),
        bbox: { x0: 700, y0: 240, x1: 850, y1: 255 },
      },
      expiry,
    ],
    [line("15.04.2021", 240), line("16.04.2021", 265), expiry],
  ])
    expect(passportDetailRegions(observed, current, mrz, 1000, 750)).toEqual(
      [],
    );
  expect(
    passportDetailRegions(
      [line("15.04.2021", 240), expiry],
      {
        ...current,
        fields: {
          ...current.fields,
          passport_expires_on: {
            value: "2031-04-15",
            source: "visual",
            checked: false,
          },
        },
      },
      mrz,
      1000,
      750,
    ),
  ).toEqual([]);
  expect(
    passportDetailRegions(
      [line("15.04.2021", 240), expiry],
      current,
      [],
      1000,
      750,
    ),
  ).toEqual([]);
});

it("uses a corrupted date only to locate pixels, never to fill the date", () => {
  const regions = passportDetailRegions(
    [line("15.04.2071", 240), line("15.04.2031", 300)],
    current,
    mrz,
    1000,
    750,
  );
  expect(regions[0].kind).toBe("issue-date");
  expect(current.fields.passport_issued_on).toBeUndefined();
});

it("rereads the printed name block around an observed Latin surname", () => {
  const regions = passportDetailRegions(
    [line("PRIMEROV", 60)],
    current,
    mrz,
    1000,
    750,
  );
  expect(regions[0]).toMatchObject({ kind: "names" });
  expect(regions[0].left).toBeLessThan(400);
  expect(regions[0].top).toBeLessThan(60);
  expect(regions[0].top + regions[0].height).toBeGreaterThan(150);
});

it("upgrades an observed name prefix while preserving Latin fields and requiring Cyrillic review", () => {
  const result = mergePassportDetails(current, {
    mrz: "unreadable",
    warnings: [],
    fields: {
      first_name: { value: "ТЕСТ", source: "visual", checked: false },
      passport_surname: { value: "WRONG", source: "visual", checked: false },
    },
  });
  expect(result.fields.first_name).toMatchObject({
    value: "ТЕСТ",
    checked: false,
    warning: expect.any(String),
  });
  expect(result.fields.passport_surname).toEqual(
    current.fields.passport_surname,
  );
  expect(result.mrz).toBe("partial");
});

it("does not shorten names, choose unrelated letters, overwrite an existing issue date, or accept bad chronology", () => {
  const full = {
    ...current,
    fields: {
      ...current.fields,
      first_name: { value: "ТЕСТ", source: "visual" as const, checked: false },
    },
  };
  for (const value of ["ТЕС", "ТЕКСТ"])
    expect(
      mergePassportDetails(full, {
        mrz: "partial",
        warnings: [],
        fields: { first_name: { value, source: "visual", checked: false } },
      }).fields.first_name?.value,
    ).toBe("ТЕСТ");
  const issue = {
    value: "2021-04-15",
    source: "visual" as const,
    checked: false,
    warning: "Сверьте дату",
  };
  expect(
    mergePassportDetails(current, current, issue).fields.passport_issued_on,
  ).toEqual(issue);
  expect(
    mergePassportDetails(current, current, { ...issue, value: "2031-04-15" })
      .fields.passport_issued_on,
  ).toBeUndefined();
  const existing = {
    ...current,
    fields: { ...current.fields, passport_issued_on: issue },
  };
  expect(
    mergePassportDetails(existing, existing, { ...issue, value: "2022-04-15" })
      .fields.passport_issued_on,
  ).toEqual(issue);
});
