// Entirely fictional specimen generated in memory; no external photos or fonts.
export function syntheticPassport() {
  const canvas = document.createElement("canvas");
  canvas.width = 1400;
  canvas.height = 1050;
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  const text = (value, x, y, size = 26) => {
    context.font = `${size}px Arial`;
    context.fillText(value, x, y);
  };
  text("TEST SPECIMEN — NOT A TRAVEL DOCUMENT", 60, 50, 28);
  text("ПАСПОРТ / PASSPORT", 60, 100);
  text("Фамилия / Surname", 430, 150);
  text("ПРИМЕРОВ", 430, 192, 32);
  text("PRIMEROV", 430, 235, 32);
  text("Имя / Given names", 430, 280);
  text("ТЕСТ ТЕСТОВИЧ", 430, 322, 32);
  text("TEST", 430, 365, 32);
  text("Гражданство / Nationality", 430, 410);
  text("RUSSIAN FEDERATION", 430, 452, 32);
  text("Дата рождения / Date of birth", 430, 497);
  text("12.08.1990", 430, 539, 32);
  text("Дата выдачи / Date of issue", 430, 584);
  text("15.04.2021", 430, 626, 32);
  text("Дата окончания действия / Date of expiry", 430, 671);
  text("15.04.2031", 430, 713, 32);
  text("Номер паспорта / Passport No.", 940, 150, 22);
  text("76 0000001", 940, 192, 32);
  const digit = (value) =>
    [...value].reduce(
      (sum, char, i) =>
        sum + (char === "<" ? 0 : parseInt(char, 36)) * [7, 3, 1][i % 3],
      0,
    ) % 10;
  const a = "760000001" + digit("760000001");
  const b = "900812" + digit("900812");
  const c = "310415" + digit("310415");
  const d = "<<<<<<<<<<<<<<0";
  context.font = "40px monospace";
  context.fillText("P<RUSPRIMEROV<<TEST".padEnd(44, "<"), 45, 880);
  context.fillText(a + "RUS" + b + "M" + c + d + digit(a + b + c + d), 45, 960);
  return new Promise((resolve) =>
    canvas.toBlob(
      (blob) =>
        resolve(new File([blob], "synthetic.png", { type: "image/png" })),
      "image/png",
    ),
  );
}
