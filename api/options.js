export default async function handler(req, res) {
  try {
    const { symbol, expiration } = req.query;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    // Yahoo expects expiration as UNIX seconds in the query: ?date=1700000000
    const dateParam = expiration ? `?date=${encodeURIComponent(expiration)}` : "";

    const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}${dateParam}`;

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
    const chain = data?.optionChain?.result?.[0];
    const err = data?.optionChain?.error;

    if (err) return res.status(502).json({ error: "Yahoo options error", details: err });
    if (!chain) return res.status(502).json({ error: "No options data returned", details: JSON.stringify(data).slice(0, 300) });

    const expirations = chain.expirationDates || [];
    const opt = chain.options?.[0] || {};
    const calls = opt.calls || [];
    const puts = opt.puts || [];

    // Normalize contracts (greeks often not present; IV is often present as impliedVolatility)
    const norm = (row, type) => ({
      symbol: (chain.quote?.symbol || symbol).toUpperCase(),
      optionSymbol: row.contractSymbol || null,
      expiration: row.expiration ? new Date(row.expiration * 1000).toISOString().slice(0, 10) : null,
      type,
      strike: row.strike ?? null,
      last: row.lastPrice ?? null,
      bid: row.bid ?? null,
      ask: row.ask ?? null,
      volume: row.volume ?? null,
      openInterest: row.openInterest ?? null,
      impliedVol: row.impliedVolatility ?? null
    });

    const contracts = [
      ...calls.map(c => norm(c, "call")),
      ...puts.map(p => norm(p, "put"))
    ];

    return res.status(200).json({
      symbol: (chain.quote?.symbol || symbol).toUpperCase(),
      asOf: new Date().toISOString(),
      expirations: expirations.map(s => new Date(s * 1000).toISOString().slice(0, 10)),
      contracts,
      source: "Yahoo Finance (unofficial)"
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
