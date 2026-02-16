export default async function handler(req, res) {
  try {
    const { symbol, q, limit } = req.query;

    const n = Math.max(1, Math.min(50, Number(limit || 20)));

    // Build a query:
    // - If user provides q, use that
    // - Else if symbol provided, search for it
    // - Else error
    const query = (q && String(q).trim()) || (symbol && String(symbol).trim());
    if (!query) {
      return res.status(400).json({ error: "Provide symbol or q" });
    }

    // GDELT Doc API (Articles)
    // mode=ArtList returns a list of articles
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

    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: "GDELT request failed", status: r.status, details: t.slice(0, 300) });
    }

    const data = await r.json();
    const articles = data?.articles || [];

    const items = articles.map((a) => ({
      publishedAt: a?.seendate || null,
      source: a?.sourceCountry || a?.sourceCollection || a?.domain || "unknown",
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
