export default async function handler(req, res) {
  const { symbol } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: "Missing symbol parameter" });
  }

  const API_KEY = process.env.ALPHA_VANTAGE_KEY;

  const response = await fetch(
    `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${API_KEY}`
  );

  const data = await response.json();

  const quote = data["Global Quote"];

  if (!quote) {
    return res.status(500).json({ error: "Invalid response from Alpha Vantage" });
  }

  return res.status(200).json({
    symbol: symbol,
    asOf: new Date().toISOString(),
    price: parseFloat(quote["05. price"]),
    changePct: parseFloat(quote["10. change percent"]),
    volume: parseInt(quote["06. volume"]),
    currency: "USD",
    source: "Alpha Vantage"
  });
}
