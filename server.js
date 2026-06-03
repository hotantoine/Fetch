const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const root = __dirname;
const port = Number(process.env.PORT || 4273);
const host = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();

  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }

    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/api" || requestUrl.pathname === "/api/") {
      response.writeHead(302, { Location: "/", ...corsHeaders() });
      response.end();
      return;
    }

    if (requestUrl.pathname === "/api/profile") {
      await handleProfile(requestUrl, response);
      logRequest(request, requestUrl, Date.now() - startedAt);
      return;
    }

    if (requestUrl.pathname === "/api/image") {
      await handleMediaProxy(requestUrl, response, false);
      logRequest(request, requestUrl, Date.now() - startedAt);
      return;
    }

    if (requestUrl.pathname === "/api/download") {
      await handleMediaProxy(requestUrl, response, true);
      logRequest(request, requestUrl, Date.now() - startedAt);
      return;
    }

    serveStatic(requestUrl, response);
    logRequest(request, requestUrl, Date.now() - startedAt);
  } catch (error) {
    console.error(`${request.method} ${request.url} failed:`, error);
    sendJson(response, 500, {
      message: error.message || "Unexpected server error.",
    });
  }
});

server.listen(port, host, () => {
  console.log(`Profile Media Downloader running at http://${host}:${port}`);
});

async function handleProfile(requestUrl, response) {
  const profileInput = requestUrl.searchParams.get("profile") || "";
  const { status, payload } = await profilePayload(profileInput);
  sendJson(response, status, payload);
}

async function profilePayload(profileInput) {
  const username = parseInstagramUsername(profileInput);

  if (!username) {
    return {
      status: 400,
      payload: { ok: false, message: "Enter a valid Instagram profile URL or username." },
    };
  }

  const data = await fetchPublicProfile(username);

  if (data.profile?.isPrivate) {
    return {
      status: 403,
      payload: { ok: false, message: "This profile appears to be private. Only public profiles are supported." },
    };
  }

  if (!data.assets.length) {
    return {
      status: 404,
      payload: { ok: false, message: "No public profile picture, thumbnails, or images were found." },
    };
  }

  return {
    status: 200,
    payload: {
      ok: true,
      message: `Loaded ${data.assets.length} public media item${data.assets.length === 1 ? "" : "s"}.`,
      profile: data.profile,
      assets: data.assets,
      highlights: data.highlights || [],
    },
  };
}

async function fetchPublicProfile(username) {
  const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const headers = instagramHeaders(username);

  try {
    const apiResponse = await fetchWithTimeout(apiUrl, { headers }, 18000);
    const text = await apiResponse.text();

    if (apiResponse.ok) {
      const json = JSON.parse(text);
      const extracted = extractFromWebProfileJson(json, username);
      extracted.highlights = await fetchProfileHighlights(extracted.profile.id, username, headers);
      return extracted;
    }
  } catch {
    // The HTML fallback below handles the common cases where the public endpoint is blocked.
  }

  const pageUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  const pageResponse = await fetchWithTimeout(pageUrl, { headers }, 18000);
  const html = await pageResponse.text();

  if (!pageResponse.ok) {
    throw new Error(`Instagram returned HTTP ${pageResponse.status}.`);
  }

  const extracted = extractFromText(html, username);
  if (!extracted.assets.length) {
    throw new Error("Instagram did not expose downloadable public media for this profile.");
  }

  return extracted;
}

function extractFromWebProfileJson(json, username) {
  const user = json?.data?.user;
  if (!user) {
    throw new Error("The public profile response did not include profile data.");
  }

  const profile = {
    id: user.id || "",
    username: user.username || username,
    fullName: user.full_name || user.username || username,
    avatarUrl: decodeEntities(user.profile_pic_url_hd || user.profile_pic_url || ""),
    biography: user.biography || "",
    isPrivate: Boolean(user.is_private),
    source: "Live public profile fetch",
  };

  const assets = [];
  if (profile.avatarUrl) {
    assets.push({
      id: `avatar-${hashString(profile.avatarUrl)}`,
      kind: "avatar",
      title: "Profile picture",
      detail: profile.fullName || `@${username}`,
      url: profile.avatarUrl,
      filename: cleanFilename(`${profile.username || username}-profile-picture.jpg`),
    });
  }

  const edges = user.edge_owner_to_timeline_media?.edges || [];
  edges.forEach((edge, postIndex) => {
    const node = edge?.node;
    if (!node) return;
    addNodeAssets(assets, node, username, postIndex);

    const children = node.edge_sidecar_to_children?.edges || [];
    children.forEach((childEdge, childIndex) => {
      if (childEdge?.node) {
        addNodeAssets(assets, childEdge.node, username, postIndex, childIndex + 1);
      }
    });
  });

  return {
    profile,
    assets: dedupeAssets(assets),
    highlights: extractHighlights(user.edge_highlight_reels),
  };
}

async function fetchProfileHighlights(userId, username, headers) {
  if (!userId) return [];

  const params = new URLSearchParams({
    query_id: "9957820854288654",
    user_id: userId,
    include_chaining: "false",
    include_reel: "true",
    include_suggested_users: "false",
    include_logged_out_extras: "true",
    include_live_status: "false",
    include_highlight_reels: "true",
  });

  try {
    const response = await fetchWithTimeout(
      `https://www.instagram.com/graphql/query/?${params}`,
      { headers: { ...headers, Referer: `https://www.instagram.com/${username}/` } },
      18000,
    );

    if (!response.ok) return [];
    const json = await response.json();
    return extractHighlights(json?.data?.user?.edge_highlight_reels);
  } catch {
    return [];
  }
}

function extractHighlights(edgeHighlightReels) {
  const edges = edgeHighlightReels?.edges || [];
  const highlights = edges
    .map((edge, index) => {
      const node = edge?.node || {};
      const fullUrl = decodeEntities(
        node.cover_media?.thumbnail_src ||
          node.cover_media_cropped_thumbnail?.url ||
          "",
      );
      const previewUrl = decodeEntities(
        node.cover_media_cropped_thumbnail?.url ||
          node.cover_media?.thumbnail_src ||
          "",
      );
      if (!fullUrl && !previewUrl) return null;

      return {
        id: String(node.id || `highlight-${index + 1}`),
        title: node.title || `Story ${index + 1}`,
        url: fullUrl || previewUrl,
        previewUrl: previewUrl || fullUrl,
        filename: cleanFilename(`story-cover-${node.title || index + 1}.jpg`),
      };
    })
    .filter(Boolean);

  return dedupeBy(highlights, (highlight) => highlight.url);
}

function addNodeAssets(assets, node, username, postIndex, childIndex = 0) {
  const shortcode = node.shortcode || `post-${postIndex + 1}`;
  const suffix = childIndex ? `${postIndex + 1}-${childIndex}` : `${postIndex + 1}`;
  const caption = firstCaption(node) || `Post ${postIndex + 1}`;
  const postLink = shortcode.startsWith("post-") ? "" : `instagram.com/p/${shortcode}`;

  if (node.thumbnail_src) {
    assets.push({
      id: `thumb-${hashString(node.thumbnail_src)}-${suffix}`,
      kind: "thumbnail",
      title: `Thumbnail ${suffix}`,
      detail: postLink || caption,
      url: decodeEntities(node.thumbnail_src),
      filename: cleanFilename(`${username}-${shortcode}-thumbnail-${childIndex || 1}.jpg`),
    });
  }

  const imageUrl = node.display_url || node.image_versions2?.candidates?.[0]?.url || "";
  if (imageUrl && imageUrl !== node.thumbnail_src) {
    assets.push({
      id: `image-${hashString(imageUrl)}-${suffix}`,
      kind: "image",
      title: `Image ${suffix}`,
      detail: postLink || caption,
      url: decodeEntities(imageUrl),
      filename: cleanFilename(`${username}-${shortcode}-image-${childIndex || 1}.jpg`),
    });
  }
}

function firstCaption(node) {
  const edges = node.edge_media_to_caption?.edges || [];
  return edges[0]?.node?.text || node.accessibility_caption || "";
}

function extractFromText(text, username) {
  const decoded = decodeEntities(text);
  const profile = {
    id: "",
    username,
    fullName: username,
    avatarUrl: "",
    source: "Fallback HTML extraction",
  };

  const assets = [];
  const patterns = [
    { kind: "avatar", regex: /"profile_pic_url_hd"\s*:\s*"([^"]+)"/gi },
    { kind: "avatar", regex: /"profile_pic_url"\s*:\s*"([^"]+)"/gi },
    { kind: "image", regex: /"display_url"\s*:\s*"([^"]+)"/gi },
    { kind: "thumbnail", regex: /"thumbnail_src"\s*:\s*"([^"]+)"/gi },
    { kind: "thumbnail", regex: /"thumbnail_url"\s*:\s*"([^"]+)"/gi },
    { kind: "image", regex: /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/gi },
  ];

  patterns.forEach(({ kind, regex }) => {
    let match;
    while ((match = regex.exec(decoded))) {
      const url = decodeEntities(match[1]);
      if (!looksLikeInstagramMediaUrl(url)) continue;
      if (kind === "avatar" && !profile.avatarUrl) profile.avatarUrl = url;
      assets.push({
        id: `${kind}-${hashString(url)}`,
        kind,
        title: kind === "avatar" ? "Profile picture" : `${kind === "thumbnail" ? "Thumbnail" : "Image"} ${assets.length + 1}`,
        detail: "Extracted from public profile HTML",
        url,
        filename: cleanFilename(`${username}-${kind}-${assets.length + 1}.jpg`),
      });
    }
  });

  return {
    profile,
    assets: dedupeAssets(assets),
    highlights: extractHighlightsFromText(decoded, username),
  };
}

function extractHighlightsFromText(text, username) {
  const highlights = [];
  const regex =
    /"title"\s*:\s*"([^"]+)"[\s\S]{0,1600}?"cover_media(?:_cropped_thumbnail)?"\s*:\s*\{[^}]*?(?:"thumbnail_src"|"url")\s*:\s*"([^"]+)"/gi;
  let match;

  while ((match = regex.exec(text))) {
    const title = decodeEntities(match[1]);
    const url = decodeEntities(match[2]);
    if (!looksLikeInstagramMediaUrl(url)) continue;
    highlights.push({
      id: `highlight-${hashString(`${title}-${url}`)}`,
      title,
      url,
      previewUrl: url,
      filename: cleanFilename(`${username}-story-cover-${title}.jpg`),
    });
  }

  return dedupeBy(highlights, (highlight) => highlight.url);
}

async function handleMediaProxy(requestUrl, response, asDownload) {
  const mediaUrl = requestUrl.searchParams.get("url") || "";
  const filename = cleanFilename(requestUrl.searchParams.get("name") || "instagram-media.jpg");

  if (!looksLikeInstagramMediaUrl(mediaUrl)) {
    sendJson(response, 400, { message: "Only Instagram media URLs can be proxied." });
    return;
  }

  const media = await fetchBinary(mediaUrl);
  const name = ensureExtension(filename, media.contentType);

  response.writeHead(200, {
    "Content-Type": media.contentType,
    "Content-Length": media.buffer.length,
    "Cache-Control": "public, max-age=3600",
    ...corsHeaders(),
    ...(asDownload ? { "Content-Disposition": `attachment; filename="${name}"` } : {}),
  });
  response.end(media.buffer);
}

async function fetchBinary(url) {
  const mediaResponse = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        Referer: "https://www.instagram.com/",
      },
    },
    18000,
  );

  if (!mediaResponse.ok) {
    throw new Error(`Image request returned HTTP ${mediaResponse.status}.`);
  }

  const contentType = mediaResponse.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await mediaResponse.arrayBuffer());
  return { buffer, contentType };
}

function serveStatic(requestUrl, response) {
  const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.normalize(path.join(root, requestedPath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType, ...corsHeaders() });
    response.end(content);
  });
}

function parseInstagramUsername(input) {
  const raw = String(input).trim();
  if (!raw) return "";

  try {
    const asUrl = raw.startsWith("http") ? new URL(raw) : null;
    if (asUrl) {
      const host = asUrl.hostname.toLowerCase();
      if (!host.endsWith("instagram.com")) return "";
      const firstSegment = asUrl.pathname.split("/").filter(Boolean)[0] || "";
      if (["p", "reel", "reels", "stories", "tv", "explore"].includes(firstSegment.toLowerCase())) {
        return "";
      }
      return validUsername(firstSegment) ? firstSegment : "";
    }
  } catch {
    return "";
  }

  const username = raw.replace(/^@/, "").split(/[/?#\s]/)[0];
  return validUsername(username) ? username : "";
}

function validUsername(username) {
  return /^[A-Za-z0-9._]{1,30}$/.test(username);
}

function instagramHeaders(username) {
  return {
    Accept: "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    Referer: `https://www.instagram.com/${username}/`,
    "X-IG-App-ID": "936619743392459",
  };
}

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeInstagramMediaUrl(input) {
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) return false;

    const host = url.hostname.toLowerCase();
    return (
      host.includes("instagram") ||
      host.endsWith("fbcdn.net") ||
      host.includes("cdninstagram") ||
      host.startsWith("scontent") ||
      host.includes(".scontent")
    );
  } catch {
    return false;
  }
}

function dedupeAssets(assets) {
  return dedupeBy(assets, (asset) => asset.url);
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decodeEntities(value) {
  return String(value)
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
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

function ensureExtension(filename, contentType) {
  if (/\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) return filename;
  if (contentType.includes("png")) return `${filename}.png`;
  if (contentType.includes("webp")) return `${filename}.webp`;
  if (contentType.includes("gif")) return `${filename}.gif`;
  return `${filename}.jpg`;
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() });
  response.end(JSON.stringify(payload));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function logRequest(request, requestUrl, ms) {
  console.log(`${request.method} ${requestUrl.pathname} finished in ${ms}ms`);
}
