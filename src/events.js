// بث مباشر للوحة التحكم (Server-Sent Events) — كل مشترك بيشوف أحداثه بس
const clients = new Map(); // tenantId -> Set<res>

export function subscribe(tenantId, res) {
  if (!clients.has(tenantId)) clients.set(tenantId, new Set());
  clients.get(tenantId).add(res);
  res.on('close', () => clients.get(tenantId)?.delete(res));
}

export function emit(tenantId, type, data = {}) {
  const set = clients.get(tenantId);
  if (!set || !set.size) return;
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { set.delete(res); }
  }
}

setInterval(() => {
  for (const set of clients.values()) for (const res of set) { try { res.write(': ping\n\n'); } catch {} }
}, 25_000).unref();
