export default async function handler(req, res) {
  try {
    const { symbol, interval } = req.query;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    const allowed = new Set(["1m", "5m", "15m", "30m", "60m"]);
    const iv = interval || "5m";
    if (!allowed.has(iv)) return res.status(400).json({ error: "Invalid interval. Use 1m,5m,15m,30m,60m" });

    const API_KEY = process.env.ALPHA_VANTAGE_KEY;
    if (!API_KEY) return res.status(500).json({ error: "Missing ALPHA_VANTAGE_KEY on server" });

    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(
      symbol
    )}&interval=${encodeURIComponent(iv)}&outputsize=compact&apikey=${encodeURIComponent(API_KEY)}`;

    const r = await fetch(url);
    const data = await r.json();

    if (data?.Note) return res.status(429).json({ error: "Alpha Vantage rate limit", details: data.Note });
    if (data?.Information) return res.status(502).json({ error: "Alpha Vantage error", details: data.Information });

    const key = `Time Series (${iv})`;
    const series = data?.[key];
    if (!series) return res.status(502).json({ error: "Unexpected response", details: JSON.stringify(data).slice(0, 400) });

    const candles = Object.entries(series)
      .slice(0, 200)
      .map(([t, v]) => ({
        t: new Date(t + "Z").toISOString(),
        o: Number(v["1. open"]),
        h: Number(v["2. high"]),
        l: Number(v["3. low"]),
        c: Number(v["4. close"]),
        v: Number(v["5. volume"])
      }))
      .reverse();

    return res.status(200).json({
      symbol: symbol.toUpperCase(),
      interval: iv,
      asOf: new Date().toISOString(),
      candles,
      source: "Alpha Vantage"
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
