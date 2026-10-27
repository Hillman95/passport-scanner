import { expect, test } from "@playwright/test";

test("reads an in-memory synthetic specimen using only same-origin GETs", async ({
  page,
  context,
}) => {
  const unexpected: string[] = [];
  context.on("request", (request) => {
    if (
      new URL(request.url()).origin !== "http://127.0.0.1:4173" ||
      request.method() !== "GET"
    )
      unexpected.push(request.method());
  });
  await page.goto("/examples/");
  await page.getByRole("button", { name: "Use synthetic specimen" }).click();
  await expect(
    page.getByRole("button", { name: "Scan", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Review every candidate against the photo",
    { timeout: 160_000 },
  );
  const result = JSON.parse(
    await page.getByLabel("Recognition candidates").innerText(),
  );
  for (const [name, value] of Object.entries({
    passport_surname: "PRIMEROV",
    passport_given_name: "TEST",
    passport_number: "760000001",
    birth_date: "1990-08-12",
    passport_issued_on: "2021-04-15",
    passport_expires_on: "2031-04-15",
    first_name: "ТЕСТ",
  }))
    expect(result.fields[name]?.value).toBe(value);
  expect(unexpected).toEqual([]);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByLabel("Recognition candidates")).toHaveText("");
  await expect(page.getByAltText("Selected document preview")).toBeHidden();
});

test("cancels while a local language model is pending and ignores its late response", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/lang/eng.traineddata.gz", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/examples/");
  await page.getByRole("button", { name: "Use synthetic specimen" }).click();
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Cancelled");
  release();
  await expect(page.getByLabel("Recognition candidates")).toHaveText("");
});
