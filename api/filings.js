export default async function handler(req, res) {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    // SEC requires a descriptive User-Agent
    const headers = {
      "User-Agent": "TromMarketGateway your_email@example.com"
    };

    // First: convert ticker to CIK
    const tickerResp = await fetch(
      "https://www.sec.gov/files/company_tickers.json",
      { headers }
    );
    const tickerData = await tickerResp.json();

    const entry = Object.values(tickerData).find(
      (x) => x.ticker.toUpperCase() === symbol.toUpperCase()
    );

    if (!entry)
      return res.status(404).json({ error: "Ticker not found in SEC database" });

    const cik = entry.cik_str.toString().padStart(10, "0");

    // Fetch company submissions
    const filingsResp = await fetch(
      `https://data.sec.gov/submissions/CIK${cik}.json`,
      { headers }
    );

    const filingsData = await filingsResp.json();

    const recent = filingsData?.filings?.recent;
    if (!recent)
      return res.status(502).json({ error: "No filings returned" });

    const filings = recent.form.slice(0, 20).map((form, i) => ({
      formType: form,
      filedAt: recent.filingDate[i],
      accessionNumber: recent.accessionNumber[i],
      primaryDoc: recent.primaryDocument[i]
    }));

    return res.status(200).json({
      symbol: symbol.toUpperCase(),
      cik,
      filings,
      source: "SEC EDGAR"
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
