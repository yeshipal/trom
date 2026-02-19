// /api/news.js
const CACHE_TTL_MS = 60 * 1000;
const MIN_UPSTREAM_INTERVAL_MS = 5 * 1000;

const cache = new Map(); // key -> { expiresAt, payload }
let lastUpstreamFetchAt = 0;

function keyFor(query, limit) {
  return `${query}::${limit}`;
}

async function fetchWithTimeout(url, { headers = {}, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: controller.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function gdeltNews(query, limit) {
  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc" +
    `?query=${encodeURIComponent(query)}` +
    `&mode=ArtList` +
    `&format=json` +
    `&maxrecords=${encodeURIComponent(limit)}` +
    `&sort=HybridRel`;

  // One retry on transient failures
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchWithTimeout(url, {
        headers: { "User-Agent": "TromMarketGateway" },
        timeoutMs: 8000
      });

      const text = await r.text();

      if (r.status === 429) {
        return { ok: false, reason: "rate_limited", details: text.slice(0, 200) };
      }

      const first = text.trim().slice(0, 1);
      if (first !== "{" && first !== "[") {
        return { ok: false, reason: "not_json", details: text.trim().slice(0, 200) };
      }

      const data = JSON.parse(text);
      const articles = data?.articles || [];

      const items = articles.map((a) => ({
        publishedAt: a?.seendate || null,
        source: a?.domain || a?.sourceCountry || "unknown",
        title: a?.title || "",
        url: a?.url || "",
        snippet: a?.summary || a?.description || null
      }));

      return { ok: true, items, provider: "GDELT (free)" };
    } catch (e) {
      // fetch failed / timeout / abort: retry once
      if (attempt === 0) {
        await sleep(400);
        continue;
      }
      return { ok: false, reason: "fetch_failed", details: String(e) };
    }
  }
  return { ok: false, reason: "unknown", details: "Unknown error" };
}

// Very lightweight RSS parsing (good enough for hobby use)
function parseGoogleNewsRss(xml, limit) {
  const items = [];
  const blocks = xml.split("<item>").slice(1);
  for (const b of blocks) {
    if (items.length >= limit) break;

    const title = (b.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || b.match(/<title>(.*?)<\/title>/))?.[1] || "";
    const link = (b.match(/<link>(.*?)<\/link>/)?.[1]) || "";
    const pubDate = (b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]) || null;
    const source = (b.match(/<source.*?>(.*?)<\/source>/)?.[1]) || "Google News";

    if (!title || !link) continue;

    items.push({
      publishedAt: pubDate,
      source,
      title: title.replace(/&amp;/g, "&"),
      url: link,
      snippet: null
    });
  }
  return items;
}

async function googleNewsRss(query, limit) {
  // US English Google News RSS search
  const url =
    "https://news.google.com/rss/search" +
    `?q=${encodeURIComponent(query)}` +
    `&hl=en-US&gl=US&ceid=US:en`;

  try {
    const r = await fetchWithTimeout(url, {
      headers: { "User-Agent": "TromMarketGateway" },
      timeoutMs: 8000
    });

    const text = await r.text();
    const trimmed = text.trim();
    if (!trimmed.startsWith("<?xml") && !trimmed.startsWith("<rss")) {
      return { ok: false, reason: "not_xml", details: trimmed.slice(0, 200) };
    }

    const items = parseGoogleNewsRss(text, limit);
    return { ok: true, items, provider: "Google News RSS (free)" };
  } catch (e) {
    return { ok: false, reason: "fetch_failed", details: String(e) };
  }
}

export default async function handler(req, res) {
  try {
    const { symbol, q, limit } = req.query;
    const n = Math.max(1, Math.min(50, Number(limit || 20)));

    const query = (q && String(q).trim()) || (symbol && String(symbol).trim());
    if (!query) return res.status(400).json({ error: "Provide symbol or q" });

    const cacheKey = keyFor(query, n);
    const now = Date.now();

    const hit = cache.get(cacheKey);
    if (hit && now < hit.expiresAt) {
      return res.status(200).json({ ...hit.payload, cached: true });
    }

    // Throttle upstream to avoid GDELT guidance + Actions double-calls
    if (now - lastUpstreamFetchAt < MIN_UPSTREAM_INTERVAL_MS) {
      if (hit) return res.status(200).json({ ...hit.payload, cached: true, stale: true });
      // brief soft-limit response
      return res.status(429).json({
        error: "Gateway throttle",
        details: "Please retry in a few seconds (provider requires ~1 request per 5 seconds)."
      });
    }

    lastUpstreamFetchAt = now;

    // 1) Try GDELT
    let r1 = await gdeltNews(query, n);

    // 2) Fallback to Google News RSS if GDELT fails for any reason
    let providerResult = r1;
    if (!r1.ok) {
      const r2 = await googleNewsRss(query, n);
      providerResult = r2.ok ? r2 : r1; // if both fail, keep gdelt error
      if (!r2.ok && hit) {
        // serve stale cache if both upstreams failed
        return res.status(200).json({ ...hit.payload, cached: true, stale: true });
      }
    }

    if (!providerResult.ok) {
      return res.status(502).json({
        error: "Upstream failure",
        details: providerResult.details,
        provider: providerResult.reason
      });
    }

    const payload = {
      query,
      asOf: new Date().toISOString(),
      items: providerResult.items,
      source: providerResult.provider
    };

    cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, payload });

    return res.status(200).json({ ...payload, cached: false });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
