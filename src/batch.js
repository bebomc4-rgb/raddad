// طابور تعديل الصور الجماعي: بترفع عشرات الصور وبتنام، والكمبيوتر بيخلّصهن وحدة وحدة
import { q } from './db.js';
import { getTenant } from './tenants.js';
import { editImage, geminiProduct } from './imageedit.js';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { brandImage } from './brand.js';
import { emit } from './events.js';

let running = false;
export function startBatchWorker() {
  // إذا السيرفر انطفى بالنص، الشغل يلي كان عم ينعمل بيرجع للطابور
  q.run("UPDATE edit_jobs SET status = 'queued' WHERE status = 'working'");
  setInterval(tick, 5000);
}
async function tick() {
  if (running) return;
  const job = q.get("SELECT * FROM edit_jobs WHERE status = 'queued' ORDER BY id LIMIT 1");
  if (!job) return;
  running = true;
  q.run("UPDATE edit_jobs SET status = 'working' WHERE id = ?", job.id);
  emit(job.tenant_id, 'batch', { id: job.id });
  try {
    const t = getTenant(job.tenant_id);
    let r;
    if (job.src_urls) { // منتج Gemini بكذا صورة
      r = await geminiProduct(t, JSON.parse(job.src_urls), job.request);
      const safe = String(job.product_name || 'منتج').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 60) || 'منتج';
      const dir = path.join(DATA_DIR, 'exports', safe); fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, `${safe} - ${job.prompt_no || 1}.png`);
      fs.copyFileSync(path.join(DATA_DIR, 'uploads', path.basename(r.url)), out);
      q.run('UPDATE edit_jobs SET export_path = ? WHERE id = ?', out, job.id);
    } else r = job.request ? await editImage(t, job.src_url, job.request, { quality: job.quality }) : { url: job.src_url, by: 'بدون تعديل' };
    if (job.brand) { const b = await brandImage(t, r.url, { productLogoUrl: job.brand_logo }); r = { ...r, url: b.url, by: r.by + ' + قالب انستا' }; }
    q.run("UPDATE edit_jobs SET status = 'done', result_url = ?, engine = ?, done_at = unixepoch() WHERE id = ?", r.url, r.by, job.id);
    console.log(`[batch] job ${job.id} done by ${r.by}`);
  } catch (e) {
    q.run("UPDATE edit_jobs SET status = 'error', error = ?, done_at = unixepoch() WHERE id = ?", String(e.message).slice(0, 300), job.id);
    console.error(`[batch] job ${job.id}: ${e.message}`);
  } finally {
    running = false;
    emit(job.tenant_id, 'batch', { id: job.id });
  }
}
