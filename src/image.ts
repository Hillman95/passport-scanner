// Score horizontal text edges after removing the surrounding background.
// quarter-turn orientation remains an explicit user control.
export function passportSkew(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  lightPaperOnly = false,
): number {
  const points: [number, number][] = [];
  for (let y = Math.max(1, Math.floor(height * 0.35)); y < height - 1; y += 2) {
    for (let x = Math.floor(width * 0.08); x < width * 0.96; x += 2) {
      const i = (y * width + x) * 4;
      const light = lightPaperOnly
        ? pixels[i]
        : (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      const above = i - width * 4;
      const previous = lightPaperOnly
        ? pixels[above]
        : (pixels[above] + pixels[above + 1] + pixels[above + 2]) / 3;
      if (
        (!lightPaperOnly || previous > 180) &&
        light < 160 &&
        previous - light > 25
      )
        points.push([x, y]);
    }
  }
  if (points.length < 100)
    return lightPaperOnly ? 0 : passportSkew(pixels, width, height, true);
  const score = (angle: number) => {
    const radians = (angle * Math.PI) / 180;
    const rows = new Float64Array(height + width * 2);
    for (const [x, y] of points) {
      const row = Math.round(
        y * Math.cos(radians) + (x - width / 2) * Math.sin(radians) + width,
      );
      if (row >= 0 && row < rows.length) rows[row]++;
    }
    return rows.reduce((sum, count) => sum + count * count, 0);
  };
  const baseline = score(0);
  let best = baseline;
  let angle = 0;
  for (let degrees = -40; degrees <= 40; degrees += 0.5) {
    const candidate = score(degrees);
    if (candidate > best) {
      best = candidate;
      angle = degrees;
    }
  }
  if (best > baseline * 1.15) return angle;
  // A regular background can dominate grayscale projections. In that case,
  // retry only black text with light paper above it, suppressing coloured lines.
  return lightPaperOnly ? 0 : passportSkew(pixels, width, height, true);
}

function canvas(width: number, height: number) {
  const image = document.createElement("canvas");
  image.width = Math.max(1, Math.round(width));
  image.height = Math.max(1, Math.round(height));
  const context = image.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("В этом браузере недоступна обработка снимка");
  return { image, context };
}

// Remove fine coloured security patterns only on the optional second pass.
export function passportContrast(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const red = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < red.length; i++) {
    red[i] = pixels[i * 4];
    histogram[red[i]]++;
  }
  const percentile = (fraction: number) => {
    let count = 0;
    for (let value = 0; value < 256; value++) {
      count += histogram[value];
      if (count >= red.length * fraction) return value;
    }
    return 255;
  };
  const low = percentile(0.03),
    high = percentile(0.9);
  if (high - low < 16) return;
  const neighbours = new Uint8Array(9);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          neighbours[n++] = red[i + dy * width + dx];
      neighbours.sort();
      const value = Math.max(
        0,
        Math.min(255, ((neighbours[4] - low) * 255) / (high - low)),
      );
      pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = value;
    }
  }
}

// Find connected light paper, ignoring isolated highlights in the background.
// Conservative bounds retain padding; uncertain detection leaves the image intact.
export function passportPaperBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const r = pixels[i * 4],
      g = pixels[i * 4 + 1],
      b = pixels[i * 4 + 2];
    if (
      pixels[i * 4 + 3] > 128 &&
      r > 145 &&
      g > 105 &&
      b > 90 &&
      Math.max(r, g, b) - Math.min(r, g, b) < 120
    )
      mask[i] = 1;
  }
  const queue = new Int32Array(mask.length);
  const regions: {
    count: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  }[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    let head = 0,
      tail = 1;
    queue[0] = i;
    mask[i] = 0;
    const region = { count: 0, left: width, top: height, right: 0, bottom: 0 };
    while (head < tail) {
      const point = queue[head++],
        x = point % width,
        y = Math.floor(point / width);
      region.count++;
      region.left = Math.min(region.left, x);
      region.right = Math.max(region.right, x);
      region.top = Math.min(region.top, y);
      region.bottom = Math.max(region.bottom, y);
      for (const next of [
        x > 0 ? point - 1 : -1,
        x + 1 < width ? point + 1 : -1,
        point - width,
        point + width,
      ]) {
        if (next >= 0 && next < mask.length && mask[next]) {
          mask[next] = 0;
          queue[tail++] = next;
        }
      }
    }
    if (region.count > mask.length * 0.02) regions.push(region);
  }
  regions.sort((a, b) => b.count - a.count);
  const largest = regions[0];
  const full = { left: 0, top: 0, width, height };
  if (!largest || largest.count < mask.length * 0.12) return full;
  const bounds = { ...largest };
  const gap = Math.max(width, height) * 0.06;
  for (const region of regions.slice(1)) {
    if (
      region.count < largest.count * 0.15 ||
      region.left > bounds.right + gap ||
      region.right < bounds.left - gap ||
      region.top > bounds.bottom + gap ||
      region.bottom < bounds.top - gap
    )
      continue;
    bounds.left = Math.min(bounds.left, region.left);
    bounds.right = Math.max(bounds.right, region.right);
    bounds.top = Math.min(bounds.top, region.top);
    bounds.bottom = Math.max(bounds.bottom, region.bottom);
  }
  const padding = Math.ceil(Math.max(width, height) * 0.025);
  const left = Math.max(0, bounds.left - padding),
    top = Math.max(0, bounds.top - padding);
  return {
    left,
    top,
    width: Math.min(width, bounds.right + padding + 1) - left,
    height: Math.min(height, bounds.bottom + padding + 1) - top,
  };
}

function paperCrop(source: HTMLCanvasElement) {
  const sampleScale = Math.min(1, 600 / source.width, 800 / source.height);
  const sample = canvas(
    source.width * sampleScale,
    source.height * sampleScale,
  );
  sample.context.imageSmoothingQuality = "high";
  sample.context.drawImage(
    source,
    0,
    0,
    sample.image.width,
    sample.image.height,
  );
  const bounds = passportPaperBounds(
    sample.context.getImageData(0, 0, sample.image.width, sample.image.height)
      .data,
    sample.image.width,
    sample.image.height,
  );
  const scale = source.width / sample.image.width;
  sample.image.width = sample.image.height = 1;
  const crop = canvas(bounds.width * scale, bounds.height * scale);
  crop.context.drawImage(
    source,
    bounds.left * scale,
    bounds.top * scale,
    bounds.width * scale,
    bounds.height * scale,
    0,
    0,
    crop.image.width,
    crop.image.height,
  );
  return crop.image;
}

export async function preparePassportImage(
  file: File,
  quarterTurns: number,
  {
    enhanced = false,
    detail = false,
  }: { enhanced?: boolean; detail?: boolean } = {},
) {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const temporary: HTMLCanvasElement[] = [];
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error(
        "Слишком большое разрешение. Уменьшите снимок до 40 мегапикселей.",
      );
    if (Math.min(bitmap.width, bitmap.height) < 300)
      throw new Error(
        "Снимок слишком маленький. Выберите фотографию не меньше 300 × 300 пикселей.",
      );
    const turn = ((quarterTurns % 4) + 4) % 4;
    const width = turn % 2 ? bitmap.height : bitmap.width;
    const height = turn % 2 ? bitmap.width : bitmap.height;
    // Preserve useful text resolution until background removal and straightening.
    const scale = Math.min(1, 3000 / Math.max(width, height));
    const oriented = canvas(width * scale, height * scale);
    temporary.push(oriented.image);
    oriented.context.translate(
      oriented.image.width / 2,
      oriented.image.height / 2,
    );
    oriented.context.rotate((turn * Math.PI) / 2);
    oriented.context.drawImage(
      bitmap,
      (-bitmap.width * scale) / 2,
      (-bitmap.height * scale) / 2,
      bitmap.width * scale,
      bitmap.height * scale,
    );
    bitmap.close();
    let page = paperCrop(oriented.image);
    oriented.image.width = oriented.image.height = 1;
    temporary.push(page);
    const sampleScale = Math.min(1, 900 / page.width, 1400 / page.height);
    const sample = canvas(page.width * sampleScale, page.height * sampleScale);
    temporary.push(sample.image);
    sample.context.imageSmoothingQuality = "high";
    sample.context.drawImage(
      page,
      0,
      0,
      sample.image.width,
      sample.image.height,
    );
    const angle = passportSkew(
      sample.context.getImageData(0, 0, sample.image.width, sample.image.height)
        .data,
      sample.image.width,
      sample.image.height,
    );
    sample.image.width = sample.image.height = 1;
    if (angle) {
      const radians = (angle * Math.PI) / 180,
        w = page.width,
        h = page.height;
      const straight = canvas(
        Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians)),
        Math.abs(w * Math.sin(radians)) + Math.abs(h * Math.cos(radians)),
      );
      temporary.push(straight.image);
      straight.context.translate(
        straight.image.width / 2,
        straight.image.height / 2,
      );
      straight.context.rotate(radians);
      straight.context.drawImage(page, -w / 2, -h / 2);
      page.width = page.height = 1;
      page = paperCrop(straight.image);
      straight.image.width = straight.image.height = 1;
      temporary.push(page);
    }
    // Crop the signature page only AFTER deskewing, so tilted MRZ is not clipped.
    const dataHeight =
      enhanced && page.height > page.width
        ? Math.min(page.height, page.width * 0.75)
        : page.height;
    const outputScale = Math.min(
      2,
      (detail ? 3000 : enhanced ? 2200 : 1800) /
        Math.max(page.width, dataHeight),
    );
    const prepared = canvas(page.width * outputScale, dataHeight * outputScale);
    prepared.context.fillStyle = "white";
    prepared.context.fillRect(
      0,
      0,
      prepared.image.width,
      prepared.image.height,
    );
    prepared.context.imageSmoothingQuality = "high";
    prepared.context.drawImage(
      page,
      0,
      page.height - dataHeight,
      page.width,
      dataHeight,
      0,
      0,
      prepared.image.width,
      prepared.image.height,
    );
    page.width = page.height = 1;
    if (enhanced && !detail) {
      const data = prepared.context.getImageData(
        0,
        0,
        prepared.image.width,
        prepared.image.height,
      );
      passportContrast(data.data, prepared.image.width, prepared.image.height);
      prepared.context.putImageData(data, 0, 0);
    }
    return prepared.image;
  } finally {
    bitmap.close();
    for (const image of temporary) image.width = image.height = 1;
  }
}
