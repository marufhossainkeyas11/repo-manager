import { extOf } from "../utils/format.js";

export function renderLoading(body) {
  body.innerHTML = `<div class="no-preview">Loading…</div>`;
}

export function renderImagePreview(body, path, base64content) {
  const ext = extOf(path);
  const mime = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
  body.innerHTML = `<div class="img-preview"><img src="data:${mime};base64,${base64content}" /></div>`;
}

export function renderNoPreview(body, iconSvg) {
  body.innerHTML = `<div class="no-preview">${iconSvg}<div>No inline preview for this file type.<br/>Download it from GitHub directly, or drag a replacement in to overwrite it.</div></div>`;
}
