// One photo per worker. The caller always terminates this realm after decoding.
// libheif may log decoder errors; do not expose passport data through its logs.
console.log = console.warn = console.error = () => {};
importScripts(new URL("./libheif-bundle.js", self.location.href).href);

self.onmessage = async ({ data: file }) => {
  self.onmessage = null;
  let images = [];
  try {
    if (!(file instanceof Blob) || !file.size || file.size > 15 * 1024 * 1024)
      throw new Error();
    const module = await libheif({ print: () => {}, printErr: () => {} });
    const decoder = new module.HeifDecoder();
    images = decoder.decode(new Uint8Array(await file.arrayBuffer()));
    const image = images.find((image) => image.is_primary()) ?? images[0];
    if (!image) throw new Error();
    const width = image.get_width(),
      height = image.get_height();
    if (Math.min(width, height) < 300 || width * height > 40_000_000)
      throw new Error();
    const pixels = new Uint8ClampedArray(width * height * 4);
    await new Promise((resolve, reject) => {
      image.display({ width, height, data: pixels }, (result) => {
        if (result) resolve();
        else reject(new Error());
      });
    });
    self.postMessage({ width, height, pixels: pixels.buffer }, [pixels.buffer]);
  } catch {
    self.postMessage({ error: "HEIF_DECODE_FAILED" });
  } finally {
    for (const image of images) image.free();
  }
};
