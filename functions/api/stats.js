// Export totals by day. Aggregate numbers only; no personal data is stored.
export async function onRequestGet({ env }) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!env.DB) return Response.json({ totals: {}, days: [] }, { headers });
  try {
    const { results } = await env.DB.prepare('SELECT day, kind, n FROM counts ORDER BY day DESC LIMIT 400').all();
    const totals = {};
    for (const r of results) totals[r.kind] = (totals[r.kind] || 0) + r.n;
    return Response.json({ totals, days: results }, { headers });
  } catch (e) {
    return Response.json({ totals: {}, days: [] }, { headers });
  }
}
