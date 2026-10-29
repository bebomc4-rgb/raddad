// الربط الرسمي: WhatsApp Cloud API من ميتا (آمن ومستقر، أول 1000 رد خدمة بالشهر مجانية لكل رقم)
import crypto from 'node:crypto';
import { config } from '../config.js';
import { q } from '../db.js';
import { decrypt } from '../security.js';
import { getTenant } from '../tenants.js';

const graph = path => `https://graph.facebook.com/${config.graphVersion}/${path}`;

export function status(tenant) {
  const ok = tenant.cloud_phone_number_id && tenant.cloud_token_enc;
  return { provider: 'cloud', status: ok ? 'open' : 'disconnected', phone: tenant.wa_phone || null };
}

async function api(tenant, path, body) {
  const token = decrypt(tenant.cloud_token_enc);
  if (!token || !tenant.cloud_phone_number_id) throw new Error('الربط الرسمي مو مكتمل (Phone Number ID والتوكن)');
  const res = await fetch(graph(path), {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meta: ${data?.error?.message || res.status}`);
  return data;
}

export async function verifyCredentials(tenant) {
  const d = await api(tenant, `${tenant.cloud_phone_number_id}?fields=display_phone_number,verified_name,quality_rating`);
  return d;
}

function publicMedia(url) {
  if (url.startsWith('/')) {
    if (!config.publicUrl) throw new Error('لازم تحط PUBLIC_URL بملف .env حتى تنبعت الصور المرفوعة بالربط الرسمي');
    return config.publicUrl + url;
  }
  return url;
}

export async function send(tenant, jid, { text, image }) {
  const to = String(jid).split('@')[0];
  const body = image
    ? { messaging_product: 'whatsapp', to, type: 'image', image: { link: publicMedia(image), ...(text ? { caption: text.slice(0, 1024) } : {}) } }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: String(text).slice(0, 4096), preview_url: true } };
  try {
    const d = await api(tenant, `${tenant.cloud_phone_number_id}/messages`, body);
    return { id: d?.messages?.[0]?.id };
  } catch (e) {
    if (image && text) {
      const d = await api(tenant, `${tenant.cloud_phone_number_id}/messages`, { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } });
      return { id: d?.messages?.[0]?.id };
    }
    throw e;
  }
}

async function markRead(tenant, messageId) {
  try {
    await api(tenant, `${tenant.cloud_phone_number_id}/messages`, {
      messaging_product: 'whatsapp', status: 'read', message_id: messageId,
      ...(tenant.settings.typing_indicator ? { typing_indicator: { type: 'text' } } : {})
    });
  } catch {}
}

// التحقق من الـ webhook (GET) — كل مشترك إله رابط وتوكن خاص
export function verifyWebhook(tenantId, query) {
  const t = getTenant(tenantId);
  const expected = t?.settings?.cloud_verify_token;
  if (query['hub.mode'] === 'subscribe' && expected && query['hub.verify_token'] === expected) return query['hub.challenge'];
  return null;
}

export function checkSignature(tenant, rawBody, header) {
  const secret = decrypt(tenant.settings.cloud_app_secret_enc || '');
  if (!secret) return true; // إذا ما في App Secret مضبوط منتجاوز الفحص
  if (!header?.startsWith('sha256=')) return false;
  const h = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(h), b = Buffer.from(header.slice(7));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// استقبال الرسائل (POST)
export async function handleWebhook(tenantId, payload) {
  const tenant = getTenant(tenantId);
  if (!tenant || tenant.wa_provider !== 'cloud') return;
  const { handleInbound } = await import('../agent.js');
  for (const entry of payload?.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      if (v.metadata?.phone_number_id && String(v.metadata.phone_number_id) !== String(tenant.cloud_phone_number_id)) continue;
      if (v.metadata?.display_phone_number && !tenant.wa_phone)
        q.run('UPDATE tenants SET wa_phone = ? WHERE id = ?', String(v.metadata.display_phone_number).replace(/\D/g, ''), tenant.id);
      const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        let text = '', mediaNote = null;
        switch (m.type) {
          case 'text': text = m.text?.body || ''; break;
          case 'image': text = m.image?.caption || ''; if (!text) mediaNote = '[العميل بعت صورة بدون نص]'; break;
          case 'video': text = m.video?.caption || ''; if (!text) mediaNote = '[العميل بعت فيديو]'; break;
          case 'audio': mediaNote = '[العميل بعت رسالة صوتية — ما فيك تسمعها، اطلب منه يكتب طلبه بلطف]'; break;
          case 'document': text = m.document?.caption || ''; if (!text) mediaNote = '[ملف]'; break;
          case 'location': mediaNote = `[موقع العميل: ${m.location?.latitude},${m.location?.longitude}${m.location?.address ? ' — ' + m.location.address : ''}]`; break;
          case 'interactive': text = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || ''; break;
          case 'button': text = m.button?.text || ''; break;
          case 'sticker': mediaNote = '[ملصق]'; break;
          case 'reaction': continue;
          default: mediaNote = `[رسالة من نوع ${m.type}]`;
        }
        markRead(tenant, m.id);
        handleInbound(tenant.id, { jid: `${m.from}@s.whatsapp.net`, phone: m.from, name: names[m.from] || null, text, mediaNote, waId: m.id });
      }
    }
  }
}
