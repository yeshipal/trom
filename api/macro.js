export default async function handler(req, res) {
  try {
    const series = (req.query.series || "DGS10,DGS2,SOFR,CPIAUCSL,UNRATE").toString();
    const ids = series.split(",").map(s => s.trim()).filter(Boolean);

    if (ids.length === 0) return res.status(400).json({ error: "Missing series" });
    if (ids.length > 10) return res.status(400).json({ error: "Too many series (max 10)" });

    const key = process.env.FRED_API_KEY;
    if (!key) return res.status(500).json({ error: "Missing FRED_API_KEY on server" });

    const headers = { "User-Agent": "TromMarketGateway" };

    async function latestObservation(id) {
      const url =
        `https://api.stlouisfed.org/fred/series/observations` +
        `?series_id=${encodeURIComponent(id)}` +
        `&api_key=${encodeURIComponent(key)}` +
        `&file_type=json` +
        `&sort_order=desc` +
        `&limit=10`;

      const r = await fetch(url, { headers });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`FRED ${id} failed: ${r.status} ${t.slice(0, 200)}`);
      }
      const data = await r.json();
      const obs = (data.observations || []).find(o => o.value !== "." && o.value != null);
      if (!obs) return { id, date: null, value: null };
      return { id, date: obs.date, value: Number(obs.value) };
    }

    const values = [];
    for (const id of ids) values.push(await latestObservation(id));

    return res.status(200).json({
      asOf: new Date().toISOString(),
      values,
      source: "FRED"
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
