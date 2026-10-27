import { expect, it } from "vitest";
import { passportPaperBounds, passportSkew } from "../src/image.js";

function photo(width: number, height: number, light = 30) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = pixels[i + 1] = pixels[i + 2] = light;
    pixels[i + 3] = 255;
  }
  const rectangle = (
    x: number,
    y: number,
    w: number,
    h: number,
    value: number,
  ) => {
    for (let row = y; row < y + h; row++)
      for (let col = x; col < x + w; col++) {
        const i = (row * width + col) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
      }
  };
  return { pixels, rectangle };
}

it("keeps both pages across a dark fold and excludes isolated background highlights", () => {
  const { pixels, rectangle } = photo(300, 400);
  rectangle(40, 30, 210, 150, 210);
  rectangle(40, 185, 210, 150, 210);
  for (let y = 350; y < 390; y += 8)
    for (let x = 0; x < 300; x += 8) rectangle(x, y, 3, 3, 240);
  const bounds = passportPaperBounds(pixels, 300, 400);
  expect(bounds.left).toBeLessThanOrEqual(40);
  expect(bounds.top).toBeLessThanOrEqual(30);
  expect(bounds.left + bounds.width).toBeGreaterThanOrEqual(250);
  expect(bounds.top + bounds.height).toBeGreaterThanOrEqual(335);
  expect(bounds.top + bounds.height).toBeLessThan(350);
});

it("leaves an uncertain dark photograph intact", () => {
  const { pixels } = photo(300, 400);
  expect(passportPaperBounds(pixels, 300, 400)).toEqual({
    left: 0,
    top: 0,
    width: 300,
    height: 400,
  });
});

it.each([-28, -4, 0, 26])(
  "straightens text tilted by %s degrees without a quarter turn",
  (angle) => {
    const width = 600,
      height = 700;
    const { pixels, rectangle } = photo(width, height, 240);
    for (let row = 330; row < 610; row += 35)
      for (let x = 55; x < 545; x += 12) {
        const y = Math.round(
          row + (x - width / 2) * Math.tan((angle * Math.PI) / 180),
        );
        rectangle(x, y, 7, 9, 25);
      }
    expect(passportSkew(pixels, width, height)).toBeCloseTo(-angle, 0);
  },
);
