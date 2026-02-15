let cached = {
  crumb: null,
  cookie: null,
  expiresAt: 0
};

async function getYahooSession() {
  const now = Date.now();
  if (cached.crumb && cached.cookie && now < cached.expiresAt) return cached;

  // 1) Get cookies from Yahoo
  const home = await fetch("https://finance.yahoo.com", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; TromGateway/1.0)" }
  });

  const setCookie = home.headers.get("set-cookie") || "";
  const cookie = setCookie
    .split(",")
    .map(p => p.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  // 2) Get crumb (endpoint sometimes works, sometimes not)
  const crumbResp = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TromGateway/1.0)",
      "Cookie": cookie
    }
  });

  const crumb = (await crumbResp.text()).trim();

  if (!crumb || crumb.includes("<") || crumb.length < 5) {
    throw new Error(`Failed to obtain Yahoo crumb. Got: ${crumb.slice(0, 40)}`);
  }

  // Cache for 10 minutes
  cached = { crumb, cookie, expiresAt: now + 10 * 60 * 1000 };
  return cached;
}

export default async function handler(req, res) {
  try {
    const { symbol, expiration } = req.query;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    const { crumb, cookie } = await getYahooSession();

    const dateParam = expiration ? `&date=${encodeURIComponent(expiration)}` : "";
    const url =
      `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}` +
      `?crumb=${encodeURIComponent(crumb)}${dateParam}`;

    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TromGateway/1.0)",
        "Cookie": cookie
      }
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(502).json({
        error: "Yahoo request failed",
        status: r.status,
        details: text.slice(0, 300)
      });
    }

    const data = await r.json();
    const chain = data?.optionChain?.result?.[0];
    const err = data?.optionChain?.error;

    if (err) return res.status(502).json({ error: "Yahoo options error", details: err });
    if (!chain) return res.status(502).json({ error: "No options data returned" });

    const expirations = chain.expirationDates || [];
    const opt = chain.options?.[0] || {};
    const calls = opt.calls || [];
    const puts = opt.puts || [];

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

    return res.status(200).json({
      symbol: (chain.quote?.symbol || symbol).toUpperCase(),
      asOf: new Date().toISOString(),
      expirations: expirations.map(s => new Date(s * 1000).toISOString().slice(0, 10)),
      expirationTimestamps: expirations, // helpful for calling with `expiration=...`
      contracts: [...calls.map(c => norm(c, "call")), ...puts.map(p => norm(p, "put"))],
      source: "Yahoo Finance (unofficial)"
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
