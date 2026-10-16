// Anonymous export counter: adds 1 to today's count for "video" or "slides". Stores no personal data.
let ready = false;
export async function onRequestPost({ request, env }) {
  const kind = new URL(request.url).searchParams.get('k');
  if (!env.DB || (kind !== 'video' && kind !== 'slides')) return new Response(null, { status: 204 });
  if (!ready) {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS counts (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))').run();
    ready = true;
  }
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare('INSERT INTO counts (day, kind, n) VALUES (?1, ?2, 1) ON CONFLICT(day, kind) DO UPDATE SET n = n + 1').bind(day, kind).run();
  return new Response(null, { status: 204 });
}
