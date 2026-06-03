const state = {
  assets: [],
  profile: null,
  highlights: [],
  palette: [],
  selected: new Set(),
  filter: "all",
};

const els = {
  profileForm: document.querySelector("#profileForm"),
  profileInput: document.querySelector("#profileInput"),
  status: document.querySelector("#status"),
  resultTitle: document.querySelector("#resultTitle"),
  accountDetails: document.querySelector("#accountDetails"),
  accountCopyButton: document.querySelector("#accountCopyButton"),
  accountName: document.querySelector("#accountName"),
  paletteCard: document.querySelector("#paletteCard"),
  paletteGrid: document.querySelector("#paletteGrid"),
  highlightSection: document.querySelector("#highlightSection"),
  highlightRail: document.querySelector("#highlightRail"),
  toolbar: document.querySelector(".toolbar"),
  assetGrid: document.querySelector("#assetGrid"),
  filters: document.querySelectorAll(".filter"),
  selectAllButton: document.querySelector("#selectAllButton"),
  clearButton: document.querySelector("#clearButton"),
  downloadSelectedButton: document.querySelector("#downloadSelectedButton"),
  cardTemplate: document.querySelector("#assetCardTemplate"),
};

const apiBase = window.location.protocol === "file:" ? "http://127.0.0.1:4273" : "";

const startupProfile = new URLSearchParams(window.location.search).get("profile");
if (startupProfile) {
  els.profileInput.value = startupProfile;
  requestAnimationFrame(() => els.profileForm.requestSubmit());
}

els.profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const profile = els.profileInput.value.trim();
  if (!profile) {
    setStatus("Enter a username or URL.", "error");
    return;
  }

  resetResults();
  setStatus("Fetching...");

  try {
    const data = await requestJson(
      `${apiBase}/api/profile?profile=${encodeURIComponent(profile)}`,
      26000,
    );

    loadProfile(data);
  } catch {
    setStatus(apiBase ? "Open IG Fetch.command, leave Terminal open, then try again." : "Load failed.", "error");
  }
});

els.filters.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    els.filters.forEach((filter) => filter.classList.toggle("is-active", filter === button));
    renderAssets();
  });
});

els.selectAllButton.addEventListener("click", () => {
  getVisibleAssets().forEach((asset) => state.selected.add(asset.id));
  renderAssets();
});

els.clearButton.addEventListener("click", () => {
  state.selected.clear();
  renderAssets();
});

els.downloadSelectedButton.addEventListener("click", async () => {
  const selected = state.assets.filter((asset) => state.selected.has(asset.id));
  if (!selected.length) return;

  await downloadIndividually(selected);

  setStatus("Download started.", "success");
});

els.accountCopyButton.addEventListener("click", () => {
  const name = state.profile?.fullName || state.profile?.username || "";
  copyText(name, els.accountCopyButton);
});

function resetResults() {
  state.assets = [];
  state.profile = null;
  state.highlights = [];
  state.palette = [];
  state.selected = new Set();
  state.filter = "all";
  els.filters.forEach((filter) => filter.classList.toggle("is-active", filter.dataset.filter === "all"));
  renderAccountDetails();
  renderHighlights();
  renderAssets();
}

function loadProfile(data) {
  const assets = normalizeAssets(data.assets || []);

  state.assets = assets;
  state.profile = data.profile || null;
  state.highlights = normalizeHighlights(data.highlights || []);
  state.palette = [];
  state.selected = new Set();
  state.filter = "all";
  els.filters.forEach((filter) => filter.classList.toggle("is-active", filter.dataset.filter === "all"));

  renderAccountDetails();
  renderHighlights();
  renderAssets();
  extractAndRenderPalette();

  if (!assets.length) {
    setStatus("No media found.", "error");
    return;
  }

  setStatus(`${assets.length} loaded.`, "success");
}

function normalizeAssets(rawAssets) {
  const seen = new Set();
  return rawAssets
    .filter((asset) => asset && asset.url)
    .map((asset, index) => {
      const kind = asset.kind || "image";
      const url = decodeHtml(String(asset.url));
      return {
        id: asset.id || `${kind}-${hashString(url)}-${index}`,
        kind,
        url,
        title: asset.title || titleForKind(kind, index),
        detail: asset.detail || "",
        filename: cleanFilename(asset.filename || `${kind}-${index + 1}.jpg`),
      };
    })
    .filter((asset) => {
      if (seen.has(asset.url)) return false;
      seen.add(asset.url);
      return true;
    });
}

function normalizeHighlights(rawHighlights) {
  const seen = new Set();
  return rawHighlights
    .filter((highlight) => highlight && (highlight.url || highlight.previewUrl))
    .map((highlight, index) => {
      const url = decodeHtml(String(highlight.url || highlight.previewUrl));
      const preview = decodeHtml(String(highlight.previewUrl || highlight.url));
      return {
        id: highlight.id || `highlight-${hashString(url)}-${index}`,
        title: highlight.title || `Story ${index + 1}`,
        url,
        previewUrl: preview,
        filename: cleanFilename(highlight.filename || `story-cover-${index + 1}.jpg`),
      };
    })
    .filter((highlight) => {
      if (seen.has(highlight.url)) return false;
      seen.add(highlight.url);
      return true;
    });
}

function renderAccountDetails() {
  if (!state.profile) {
    els.accountDetails.hidden = true;
    els.accountName.textContent = "";
    els.paletteCard.hidden = true;
    els.paletteGrid.innerHTML = "";
    return;
  }

  els.accountName.textContent = state.profile.fullName || state.profile.username || "Instagram";
  els.accountDetails.hidden = false;
}

function renderPalette() {
  els.paletteGrid.innerHTML = "";
  els.paletteCard.hidden = !state.palette.length;

  state.palette.forEach((hex) => {
    const button = document.createElement("button");
    button.className = "swatch";
    button.type = "button";
    button.style.setProperty("--swatch", hex);
    button.setAttribute("aria-label", `Copy ${hex}`);
    button.innerHTML = `<span></span><strong>${escapeHtml(hex)}</strong>`;
    button.addEventListener("click", () => copyText(hex, button));
    els.paletteGrid.append(button);
  });
}

function renderHighlights() {
  els.highlightRail.innerHTML = "";
  els.highlightSection.hidden = !state.highlights.length;

  state.highlights.forEach((highlight) => {
    const button = document.createElement("button");
    button.className = "highlight-cover";
    button.type = "button";
    button.innerHTML = `
      <span class="highlight-image">
        <img src="${escapeAttr(previewUrl(highlight.previewUrl))}" alt="" loading="lazy" />
      </span>
      <strong>${escapeHtml(highlight.title)}</strong>
    `;
    button.addEventListener("click", () => {
      triggerDownload(
        downloadUrl({ ...highlight, url: highlight.previewUrl || highlight.url }),
        highlight.filename,
      );
    });
    els.highlightRail.append(button);
  });
}

function renderAssets() {
  const visibleAssets = getVisibleAssets();
  const total = state.assets.length;
  const selectedCount = state.assets.filter((asset) => state.selected.has(asset.id)).length;

  els.toolbar.hidden = total === 0;
  els.resultTitle.textContent = titleText(total, selectedCount);
  els.downloadSelectedButton.disabled = selectedCount === 0;
  els.assetGrid.innerHTML = "";

  visibleAssets.forEach((asset) => {
    const card = els.cardTemplate.content.firstElementChild.cloneNode(true);
    const checkbox = card.querySelector("input[type='checkbox']");
    const selectBox = card.querySelector(".select-box");
    const selectLabel = card.querySelector(".select-box span");
    const img = card.querySelector("img");
    const badge = card.querySelector(".badge");
    const heading = card.querySelector("h3");
    const detail = card.querySelector("p");
    const downloadLink = card.querySelector(".download-link");

    const selected = state.selected.has(asset.id);
    checkbox.checked = selected;
    card.classList.toggle("is-selected", selected);
    selectLabel.textContent = selected ? "Selected" : "Select";

    checkbox.addEventListener("change", () => toggleAsset(asset.id));
    selectBox.addEventListener("click", (event) => event.stopPropagation());
    card.addEventListener("click", () => toggleAsset(asset.id));

    img.src = previewUrl(asset.url);
    img.alt = asset.title;
    badge.textContent = labelForKind(asset.kind);
    badge.classList.add(asset.kind);
    heading.textContent = asset.title;
    detail.textContent = asset.detail;
    downloadLink.href = downloadUrl(asset);
    downloadLink.download = asset.filename;
    downloadLink.addEventListener("click", (event) => event.stopPropagation());

    els.assetGrid.append(card);
  });
}

function toggleAsset(id) {
  if (state.selected.has(id)) {
    state.selected.delete(id);
  } else {
    state.selected.add(id);
  }
  renderAssets();
}

function titleText(total, selectedCount) {
  if (!total) return "Ready";
  if (!selectedCount) return `${total} item${total === 1 ? "" : "s"}`;
  return `${total} item${total === 1 ? "" : "s"} • ${selectedCount} selected`;
}

function getVisibleAssets() {
  return state.assets.filter((asset) => state.filter === "all" || asset.kind === state.filter);
}

function setStatus(text, type = "") {
  els.status.textContent = text;
  els.status.hidden = !text;
  els.status.classList.toggle("is-error", type === "error");
  els.status.classList.toggle("is-success", type === "success");
}

function requestJson(url, ms) {
  return fetchWithTimeout(url, ms).then(async (response) => {
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.message || "Could not fetch.");
    return data;
  });
}

function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

async function downloadIndividually(assets) {
  for (const asset of assets) {
    triggerDownload(downloadUrl(asset), asset.filename);
    await wait(260);
  }
}

async function extractAndRenderPalette() {
  const avatar = state.profile?.avatarUrl || state.assets.find((asset) => asset.kind === "avatar")?.url;
  if (!avatar) {
    state.palette = [];
    renderPalette();
    return;
  }

  try {
    state.palette = await dominantColors(previewUrl(avatar), 3);
  } catch {
    state.palette = [];
  }
  renderPalette();
}

function dominantColors(src, limit) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const size = 72;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.width = size;
      canvas.height = size;
      context.drawImage(image, 0, 0, size, size);

      const { data } = context.getImageData(0, 0, size, size);
      const buckets = new Map();

      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3];
        if (alpha < 180) continue;

        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max < 18 || max > 248 && max - min < 18) continue;

        const key = [r, g, b].map((value) => Math.round(value / 12) * 12).join(",");
        const current = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        current.count += 1;
        current.r += r;
        current.g += g;
        current.b += b;
        buckets.set(key, current);
      }

      const colors = Array.from(buckets.values())
        .map((bucket) => ({
          count: bucket.count,
          r: Math.round(bucket.r / bucket.count),
          g: Math.round(bucket.g / bucket.count),
          b: Math.round(bucket.b / bucket.count),
        }))
        .sort((a, b) => b.count - a.count);

      const picked = [];
      for (const color of colors) {
        if (picked.every((existing) => colorDistance(existing, color) > 54)) {
          picked.push(color);
        }
        if (picked.length === limit) break;
      }

      resolve(picked.map(rgbToHex));
    };
    image.onerror = reject;
    image.src = src;
  });
}

function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function rgbToHex(color) {
  return `#${[color.r, color.g, color.b]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function copyText(text, target) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  flashCopied(target);
  setStatus("Copied.", "success");
}

function flashCopied(target) {
  target.classList.add("is-copied");
  setTimeout(() => target.classList.remove("is-copied"), 900);
}

function previewUrl(url) {
  if (!/^https?:\/\//i.test(url)) return url;
  return `${apiBase}/api/image?url=${encodeURIComponent(url)}`;
}

function downloadUrl(asset) {
  if (!/^https?:\/\//i.test(asset.url)) return asset.url;
  return `${apiBase}/api/download?url=${encodeURIComponent(asset.url)}&name=${encodeURIComponent(asset.filename)}`;
}

function triggerDownload(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  if (url.startsWith("blob:")) {
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
}

function decodeHtml(value) {
  return String(value)
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function labelForKind(kind) {
  if (kind === "avatar") return "Avatar";
  if (kind === "thumbnail") return "Thumb";
  return "Image";
}

function titleForKind(kind, index) {
  if (kind === "avatar") return "Avatar";
  if (kind === "thumbnail") return `Thumb ${index + 1}`;
  return `Image ${index + 1}`;
}

function cleanFilename(value) {
  const filename = String(value)
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);

  return filename || `instagram-media-${Date.now()}.jpg`;
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
