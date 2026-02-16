// Simple in-memory cache (works well enough for hobby use; may reset between cold starts)
const CACHE_TTL_MS = 30 * 1000;
const MIN_UPSTREAM_INTERVAL_MS = 5 * 1000;

const cache = new Map(); // key -> { expiresAt, payload }
let lastUpstreamFetchAt = 0;

function cacheKey(query, limit) {
  return `${query}::${limit}`;
}

export default async function handler(req, res) {
  try {
    const { symbol, q, limit } = req.query;
    const n = Math.max(1, Math.min(50, Number(limit || 20)));

    const query = (q && String(q).trim()) || (symbol && String(symbol).trim());
    if (!query) return res.status(400).json({ error: "Provide symbol or q" });

    const key = cacheKey(query, n);
    const now = Date.now();

    // Serve cached if fresh
    const hit = cache.get(key);
    if (hit && now < hit.expiresAt) {
      return res.status(200).json({ ...hit.payload, cached: true });
    }

    // Throttle upstream calls to respect GDELT 5s guidance
    if (now - lastUpstreamFetchAt < MIN_UPSTREAM_INTERVAL_MS) {
      // If we have any stale cache, serve it rather than failing
      if (hit) return res.status(200).json({ ...hit.payload, cached: true, stale: true });

      return res.status(429).json({
        error: "Rate limited (gateway throttle)",
        details: "Please retry in a few seconds. Provider requires ~1 request per 5 seconds."
      });
    }

    const url =
      "https://api.gdeltproject.org/api/v2/doc/doc" +
      `?query=${encodeURIComponent(query)}` +
      `&mode=ArtList` +
      `&format=json` +
      `&maxrecords=${encodeURIComponent(n)}` +
      `&sort=HybridRel`;

    lastUpstreamFetchAt = now;

    const r = await fetch(url, { headers: { "User-Agent": "TromMarketGateway" } });
    const text = await r.text();

    // If upstream rate-limits us, serve stale cache if possible
    if (r.status === 429) {
      if (hit) return res.status(200).json({ ...hit.payload, cached: true, stale: true });
      return res.status(429).json({ error: "Upstream rate limited", upstream: "GDELT", details: text.slice(0, 200) });
    }

    // Upstream returned non-JSON
    const firstChar = text.trim().slice(0, 1);
    if (firstChar !== "{" && firstChar !== "[") {
      return res.status(502).json({
        error: "Upstream did not return JSON",
        upstream: "GDELT",
        status: r.status,
        details: text.trim().slice(0, 300)
      });
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

    const payload = {
      query,
      asOf: new Date().toISOString(),
      items,
      source: "GDELT (free)"
    };

    cache.set(key, { expiresAt: now + CACHE_TTL_MS, payload });

    return res.status(200).json({ ...payload, cached: false });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
