// HERO STORE — مزامنة قائمة المورّد (mega-game.net) مع موقع هيرو ستور
// مفصول عن ردّاد: بس ساكن على نفس السيرفر. بيشتغل مرتين باليوم: 10 الصبح و6 المسا بتوقيت دمشق (hero-sync.timer).
// بيقرا الصفحات العامة بس (بدون تسجيل دخول)، وبيبعت لقطة موقّعة بمفتاح خاص محفوظ على السيرفر فقط.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";
import { hostname } from "node:os";

const SRC = "https://mega-game.net";
const HERO = process.env.HERO_URL || "https://herostore-sy.pages.dev";
const DIR = new URL("../data/hero-sync/", import.meta.url);
const UA = "HeroStoreSync/1.0 (+supplier price list)";
const S = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (buf) => Buffer.from(buf).toString("base64url");

async function get(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(SRC + path, { headers: { "user-agent": UA, "accept-language": "ar" }, signal: AbortSignal.timeout(25000) });
      if (r.ok) return await r.text();
      if (r.status === 404) return "";
    } catch {}
    await sleep(2000 * (i + 1));
  }
  throw new Error("ما قدرت إفتح " + path);
}
const links = (html, kind) => [...new Set([...html.matchAll(new RegExp(`href="(?:${SRC.replace(/\./g, "\\.")})?(/${kind}/[^"#?]+)"`, "g"))].map((m) => m[1]))];
function parseProducts(html) {
  const out = []; let i = 0;
  while ((i = html.indexOf("selectProduct(", i)) !== -1) {
    let j = i + 14, d = 0, q = false, e = false;
    for (; j < html.length; j++) { const ch = html[j]; if (q) { if (e) e = false; else if (ch === "\\") e = true; else if (ch === '"') q = false; } else if (ch === '"') q = true; else if (ch === "{") d++; else if (ch === "}") { d--; if (!d) { j++; break; } } }
    try { out.push(JSON.parse(html.slice(i + 14, j).replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&"))); } catch {}
    i = j;
  }
  return out;
}
const title = (html) => S((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "").split("|")[0].trim();

async function snapshot() {
  const home = await get("/");
  const cats = links(home, "category");
  if (!cats.length) throw new Error("ما لقيت أقسام");
  const games = [], seen = new Set();
  for (const cp of cats) {
    const ch = await get(cp); const cname = title(ch) || decodeURIComponent(cp.split("/").pop());
    const gl = links(ch, "game").filter((g) => !seen.has(g));
    gl.forEach((g) => seen.add(g));
    // 3 صفحات بنفس الوقت، بهدوء
    for (let i = 0; i < gl.length; i += 3) {
      const part = await Promise.all(gl.slice(i, i + 3).map(async (g) => {
        const h = await get(g); const ps = parseProducts(h);
        const slug = decodeURIComponent(g.slice(6));
        const f0 = (ps[0] && ps[0].daynamicFields) || [];
        return {
          slug, cat: cname, name: S((ps[0] && ps[0].gameName) || title(h) || slug),
          auto: ps.some((p) => /آلية|الية|اوتوماتيك/.test(p.note || "")) ? 1 : 0,
          fields: f0.map((f, k) => ({ k: "f" + k, l: S(f.label) || S(f.name) || "المعلومات المطلوبة", t: f.type === "select" ? "text" : (f.type || "text"), r: f.required ? 1 : 0, ...(f.options && f.options.length ? { o: f.options.map((o) => S(typeof o === "object" ? o.label || o.value : o)).filter(Boolean) } : {}) })),
          products: ps.map((p) => ({ id: p.id, n: S(p.name), cost: Math.round((parseFloat(p.price) || 0) * 1e6) / 1e6, on: p.isActive ? 1 : 0, min: p.minCount || 1, max: p.maxCount || 1 })),
        };
      }));
      games.push(...part);
      await sleep(300);
    }
  }
  return games;
}

async function keys() {
  await mkdir(DIR, { recursive: true });
  try { return JSON.parse(await readFile(new URL("key.json", DIR), "utf8")); } catch {}
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const k = { priv: await crypto.subtle.exportKey("jwk", kp.privateKey), pub: await crypto.subtle.exportKey("jwk", kp.publicKey) };
  await writeFile(new URL("key.json", DIR), JSON.stringify(k), { mode: 0o600 });
  return k;
}
async function hello(k) {
  const r = await fetch(HERO + "/api/sync/hello", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pub: { kty: "EC", crv: "P-256", x: k.pub.x, y: k.pub.y }, host: hostname() }) });
  return (await r.json()).status;
}
async function push(k, games) {
  const raw = JSON.stringify({ games }), ts = Date.now();
  const key = await crypto.subtle.importKey("jwk", k.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = b64u(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(ts + "." + raw)));
  const r = await fetch(HERO + "/api/sync/push", { method: "POST", headers: { "content-type": "application/json", "x-ts": String(ts), "x-sig": sig }, body: raw });
  return [r.status, await r.text()];
}

const log = async (m) => { const line = `[${new Date().toISOString()}] ${m}\n`; process.stdout.write(line); try { await writeFile(new URL("last.log", DIR), line); } catch {} };
try {
  const k = await keys();
  const st = await hello(k);
  if (st !== "approved") { await log("بانتظار موافقة صاحب المتجر من لوحة هيرو (الملخص ← المزامنة)"); process.exit(0); }
  const t0 = Date.now(), games = await snapshot();
  const [code, body] = await push(k, games);
  await log(`سحبت ${games.length} خدمة بـ ${Math.round((Date.now() - t0) / 1000)} ثانية ← ${code} ${body.slice(0, 300)}`);
} catch (e) { await log("خطأ: " + e.message); process.exit(1); }
