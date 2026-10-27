import { createPassportScanner } from "../dist/index.js";
import { syntheticPassport } from "./synthetic.js";

const scanner = createPassportScanner({
  ocrPath: "/examples/ocr/tesseract-v7",
  heifWorkerPath: "/examples/ocr/heif-v1.23.5/worker.js",
});
const element = (id) => document.getElementById(id);
let file, objectUrl, controller;
let selection = 0;
function reset() {
  selection++;
  controller?.abort();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
  file = undefined;
  element("preview").removeAttribute("src");
  element("preview").hidden = true;
  element("photo").value = "";
  element("result").textContent = "";
  element("scan").disabled = true;
  element("status").textContent = "Ready";
}
async function select(selected) {
  reset();
  if (!selected) return;
  const generation = selection;
  const abort = new AbortController();
  controller = abort;
  element("cancel").disabled = false;
  try {
    const decoded = await scanner.decode(selected, abort.signal);
    if (generation !== selection || abort.signal.aborted) return;
    file = decoded;
    objectUrl = URL.createObjectURL(decoded);
    element("preview").src = objectUrl;
    element("preview").hidden = false;
    element("scan").disabled = false;
    element("status").textContent = "Photo ready";
    void scanner.warmup().catch(() => {});
  } catch (error) {
    element("status").textContent = abort.signal.aborted
      ? "Cancelled"
      : error.message;
  } finally {
    if (controller === abort) {
      controller = undefined;
      element("cancel").disabled = true;
    }
  }
}
element("photo").addEventListener(
  "change",
  (event) => void select(event.target.files[0]),
);
element("synthetic").addEventListener("click", async () =>
  select(await syntheticPassport()),
);
element("clear").addEventListener("click", reset);
element("cancel").addEventListener("click", () => controller?.abort());
element("scan").addEventListener("click", async () => {
  if (!file || controller) return;
  const abort = new AbortController();
  controller = abort;
  const generation = selection;
  element("scan").disabled = true;
  element("cancel").disabled = false;
  try {
    const result = await scanner.recognize(file, {
      signal: abort.signal,
      onProgress: (message) => {
        if (!abort.signal.aborted && generation === selection)
          element("status").textContent = message;
      },
    });
    if (abort.signal.aborted || generation !== selection) return;
    element("result").textContent = JSON.stringify(result, null, 2);
    element("status").textContent = "Review every candidate against the photo";
  } catch (error) {
    if (generation === selection)
      element("status").textContent = abort.signal.aborted
        ? "Cancelled"
        : error.message;
  } finally {
    if (controller === abort) {
      controller = undefined;
      element("scan").disabled = !file;
      element("cancel").disabled = true;
    }
  }
});
window.addEventListener("pagehide", () => {
  reset();
  void scanner.dispose();
});
