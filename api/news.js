export default async function handler(req, res) {
  try {
    const { symbol, q, limit } = req.query;
    const n = Math.max(1, Math.min(50, Number(limit || 20)));

    const query = (q && String(q).trim()) || (symbol && String(symbol).trim());
    if (!query) return res.status(400).json({ error: "Provide symbol or q" });

    const url =
      "https://api.gdeltproject.org/api/v2/doc/doc" +
      `?query=${encodeURIComponent(query)}` +
      `&mode=ArtList` +
      `&format=json` +
      `&maxrecords=${encodeURIComponent(n)}` +
      `&sort=HybridRel`;

    const r = await fetch(url, {
      headers: { "User-Agent": "TromMarketGateway" }
    });

    const text = await r.text();

    // If upstream didn’t return JSON, return a helpful JSON error instead of crashing.
    const firstChar = text.trim().slice(0, 1);
    if (firstChar !== "{" && firstChar !== "[") {
      return res.status(502).json({
        error: "Upstream did not return JSON",
        upstream: "GDELT",
        status: r.status,
        details: text.trim().slice(0, 300),
        requestUrl: url
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

    return res.status(200).json({
      query,
      asOf: new Date().toISOString(),
      items,
      source: "GDELT (free)"
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
