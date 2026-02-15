export default async function handler(req, res) {
  try {
    const { symbol, interval } = req.query;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    // Yahoo supports: 1m,2m,5m,15m,30m,60m,90m,1h,1d...
    const iv = (interval || "5m").toString();

    // Pick a reasonable range based on interval
    const range = ["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h"].includes(iv) ? "1d" : "1mo";

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?interval=${encodeURIComponent(iv)}&range=${encodeURIComponent(range)}&includePrePost=false`;

    // Set a UA header (Yahoo sometimes blocks requests without one)
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TromGateway/1.0)"
      }
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(502).json({ error: "Yahoo request failed", status: r.status, details: text.slice(0, 300) });
    }

    const data = await r.json();
    const result = data?.chart?.result?.[0];
    const err = data?.chart?.error;

    if (err) return res.status(502).json({ error: "Yahoo chart error", details: err });
    if (!result) return res.status(502).json({ error: "No chart data returned", details: JSON.stringify(data).slice(0, 300) });

    const ts = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];

    const candles = [];
    for (let i = 0; i < ts.length; i++) {
      const o = opens[i], h = highs[i], l = lows[i], c = closes[i], v = volumes[i];
      // Skip missing points
      if ([o, h, l, c].some(x => x === null || x === undefined)) continue;
      candles.push({
        t: new Date(ts[i] * 1000).toISOString(),
        o: Number(o),
        h: Number(h),
        l: Number(l),
        c: Number(c),
        v: v === null || v === undefined ? null : Number(v)
      });
    }

    return res.status(200).json({
      symbol: symbol.toUpperCase(),
      interval: iv,
      range,
      asOf: new Date().toISOString(),
      candles,
      source: "Yahoo Finance (unofficial)"
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
