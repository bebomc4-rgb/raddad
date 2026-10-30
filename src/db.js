// قاعدة البيانات: SQLite المدمجة بـ Node (بدون أي مكتبة خارجية)
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'raddad.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const migrations = [
  // 1 — البنية الأساسية
  `
  CREATE TABLE plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price_monthly REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    ai_replies_per_day INTEGER NOT NULL DEFAULT 100,
    max_products INTEGER NOT NULL DEFAULT 200,
    allow_own_key INTEGER NOT NULL DEFAULT 1,
    allow_cloud_api INTEGER NOT NULL DEFAULT 1,
    is_public INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    features TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    plan_id TEXT NOT NULL DEFAULT 'free' REFERENCES plans(id),
    plan_expires_at INTEGER,
    status TEXT NOT NULL DEFAULT 'active',           -- active | suspended
    wa_provider TEXT NOT NULL DEFAULT 'qr',          -- qr | cloud
    wa_phone TEXT,
    cloud_phone_number_id TEXT,
    cloud_token_enc TEXT,
    ai_provider TEXT NOT NULL DEFAULT 'platform',    -- platform | gemini | openai_compat
    ai_base_url TEXT,
    ai_model TEXT,
    ai_key_enc TEXT,
    bot_enabled INTEGER NOT NULL DEFAULT 1,
    settings TEXT NOT NULL DEFAULT '{}',
    knowledge TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',              -- owner | agent
    is_super INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    sku TEXT,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    price REAL,
    sale_price REAL,
    currency TEXT,
    stock INTEGER,
    options TEXT,             -- مثلاً: المقاسات 40-45 | الألوان أسود، أبيض
    image_url TEXT,
    url TEXT,
    tags TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    search TEXT,              -- نص مطبّع للبحث
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX idx_products_tenant ON products(tenant_id, active);

  CREATE TABLE contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    jid TEXT NOT NULL,
    phone TEXT,
    name TEXT,
    notes TEXT,
    bot_paused_until INTEGER NOT NULL DEFAULT 0,     -- 0 = البوت شغال، رقم كبير = موقوف
    needs_human INTEGER NOT NULL DEFAULT 0,
    unread INTEGER NOT NULL DEFAULT 0,
    last_message TEXT,
    last_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(tenant_id, jid)
  );
  CREATE INDEX idx_contacts_tenant ON contacts(tenant_id, last_at DESC);

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,       -- in | out
    sender TEXT NOT NULL,          -- customer | bot | human
    body TEXT,
    media_url TEXT,
    wa_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX idx_messages_contact ON messages(contact_id, id);

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    customer_name TEXT,
    customer_phone TEXT,
    address TEXT,
    items TEXT NOT NULL DEFAULT '[]',
    total REAL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'new',   -- new | confirmed | shipped | done | cancelled
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX idx_orders_tenant ON orders(tenant_id, id DESC);

  CREATE TABLE usage (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    ai_replies INTEGER NOT NULL DEFAULT 0,
    msgs_in INTEGER NOT NULL DEFAULT 0,
    msgs_out INTEGER NOT NULL DEFAULT 0,
    orders INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, day)
  );

  CREATE TABLE platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  INSERT INTO plans (id, name, price_monthly, ai_replies_per_day, max_products, allow_own_key, allow_cloud_api, sort, features)
  VALUES
    ('free', 'مجانية', 0, 100, 100, 1, 1, 1, '["رقم واتساب واحد","100 رد ذكي يومياً من المنصة","ردود بلا حدود بمفتاحك الخاص","حتى 100 منتج"]'),
    ('pro', 'احترافية', 15, 2000, 5000, 1, 1, 2, '["2000 رد ذكي يومياً","حتى 5000 منتج","أولوية بالدعم"]'),
    ('business', 'أعمال', 39, 10000, 50000, 1, 1, 3, '["10000 رد ذكي يومياً","منتجات بلا حدود تقريباً","ربط رسمي Cloud API"]');
  `,
  // 2 — إعدادات الدفع اليدوي والإشعارات
  `
  CREATE TABLE payment_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL,
    months INTEGER NOT NULL DEFAULT 1,
    method TEXT,
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX idx_messages_waid ON messages(tenant_id, wa_id);
  `,
  // 3 — أمثلة من ردود صاحب المتجر (ليتعلّم الوكيل أسلوبه)
  `
  CREATE TABLE style_examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    q TEXT NOT NULL,
    a TEXT NOT NULL,
    q_norm TEXT NOT NULL,
    sig TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'import',   -- import | live | history
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(tenant_id, sig)
  );
  CREATE INDEX idx_style_tenant ON style_examples(tenant_id);
  `,
  // 4 — تنظيف: أرقام انحفظت غلط من معرّفات @lid
  `
  UPDATE contacts SET phone = NULL WHERE jid LIKE '%@lid' AND phone = substr(jid, 1, instr(jid, '@') - 1);
  `,
  // 5 — اسم العقل يلي كتب كل رد
  `
  ALTER TABLE messages ADD COLUMN ai_via TEXT;
  `,
  // 6 — تعديل صور جماعي (بيشتغل بالليل لحاله)
  `
  CREATE TABLE edit_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    src_url TEXT NOT NULL,
    request TEXT NOT NULL,
    quality TEXT NOT NULL DEFAULT 'high',
    status TEXT NOT NULL DEFAULT 'queued',   -- queued | working | done | error
    result_url TEXT,
    engine TEXT,
    error TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    done_at INTEGER
  );
  CREATE INDEX idx_edit_jobs ON edit_jobs(status, id);
  `,
  // 7 — قالب انستا مع شعارات المتجر
  `
  ALTER TABLE edit_jobs ADD COLUMN brand INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE edit_jobs ADD COLUMN brand_logo TEXT;
  `,
  // 8 — منتجات Gemini: كذا صورة لنفس المنتج + رقم البرومبت + اسم المنتج
  `
  ALTER TABLE edit_jobs ADD COLUMN src_urls TEXT;
  ALTER TABLE edit_jobs ADD COLUMN product_name TEXT;
  ALTER TABLE edit_jobs ADD COLUMN prompt_no INTEGER;
  ALTER TABLE edit_jobs ADD COLUMN export_path TEXT;
  `,
  // 9 — التعديل التلقائي من مجلد
  `
  CREATE TABLE auto_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    picked TEXT, src_url TEXT, result_url TEXT, out_path TEXT, by TEXT, error TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(tenant_id, product)
  );
  `,
  // 10 — أسعار المدد وطرق الدفع وتنبيه انتهاء الاشتراك
  `
  CREATE TABLE plan_prices (
    plan_id TEXT NOT NULL,
    months INTEGER NOT NULL,
    price REAL NOT NULL,
    PRIMARY KEY (plan_id, months)
  );
  ALTER TABLE payment_requests ADD COLUMN amount REAL;
  ALTER TABLE payment_requests ADD COLUMN receipt TEXT;
  ALTER TABLE payment_requests ADD COLUMN phone TEXT;
  ALTER TABLE tenants ADD COLUMN expiry_warned_for INTEGER;
  `,
  // 11 — التجربة المجانية مربوطة برقم الواتساب
  `
  CREATE TABLE trial_numbers (
    phone TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL
  );
  CREATE TABLE trial_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',     -- open | allowed | dismissed
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  `,
  // 12 — رابط خاص لكل زبون
  `
  ALTER TABLE tenants ADD COLUMN slug TEXT;
  CREATE UNIQUE INDEX idx_tenants_slug ON tenants(slug);
  `,
  // 13 — منتجات منفصلة عن المجيب: حفظ كل رقم جديد (اشتراك بالمدة) وحفظ الأرقام القديمة (دفعة وحدة)
  `
  CREATE TABLE services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'period',      -- period = اشتراك بالمدة | once = دفعة وحدة
    description TEXT NOT NULL DEFAULT '',
    features TEXT NOT NULL DEFAULT '[]',
    currency TEXT NOT NULL DEFAULT 'USD',
    is_public INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE service_prices (
    service_id TEXT NOT NULL,
    months INTEGER NOT NULL,                  -- 0 = دفعة وحدة
    price REAL NOT NULL,
    PRIMARY KEY (service_id, months)
  );
  CREATE TABLE tenant_services (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id TEXT NOT NULL,
    expires_at INTEGER,                       -- NULL = للأبد (دفعة وحدة)
    paused INTEGER NOT NULL DEFAULT 0,        -- الزبون وقّفها بإيدو
    warned_for INTEGER,
    activated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (tenant_id, service_id)
  );
  CREATE TABLE contact_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source TEXT NOT NULL,                     -- link | backup
    found INTEGER NOT NULL DEFAULT 0,
    queued INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  ALTER TABLE payment_requests ADD COLUMN service_id TEXT;
  INSERT INTO services (id, name, kind, description, features, sort) VALUES
    ('contacts_new', 'حفظ كل رقم جديد', 'period', 'كل زبون بيراسلك أول مرة بينحفظ بجهات اتصالك بنفس اللحظة، بدون ما تعمل شي.',
     '["بينحفظ أول ما يبعتلك","حتى لو تفاعل برمز أو إنت بعتّلو أول","حتى لو وصلت رسالتو والنت مقطوع","باسم مرتّب: زبون + آخر 4 أرقام"]', 1),
    ('contacts_old', 'حفظ كل الأرقام القديمة', 'once', 'كل الأرقام يلي راسلتك من أول ما فتحت واتساب بتنحفظ بجهات اتصالك، بدفعة وحدة.',
     '["أوتوماتيك وقت ربط الواتس","وكمان من النسخة الاحتياطية من سنين","الملف بيتفك على جهازك وما بينرفع","بدون تكرار ولا لمس للأسماء يلي حاططها إنت"]', 2);
  INSERT INTO service_prices (service_id, months, price) VALUES
    ('contacts_new', 1, 5), ('contacts_new', 3, 12), ('contacts_new', 6, 20), ('contacts_new', 12, 35), ('contacts_old', 0, 10);
  `,
  // 14: الحساب برقم الموبايل السوري (بدل الإيميل) + صورة الملف الشخصي
  `
  ALTER TABLE users ADD COLUMN phone TEXT;
  ALTER TABLE users ADD COLUMN avatar TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS users_phone ON users(phone) WHERE phone IS NOT NULL;
  `,
  // 15: ردود بلا حدود لكل الباقات، وبيفهم الصوت والصور (قرار صاحب المنصة)
  `
  UPDATE plans SET ai_replies_per_day = 1000000;
  UPDATE plans SET features = '["ردود بلا حدود","بيفهم الرسائل الصوتية وبيرد عليها","بيشوف الصور وبيرد بطريقة تسويقية","حتى 5000 منتج","أولوية بالدعم"]' WHERE id = 'pro';
  UPDATE plans SET features = '["ردود بلا حدود","بيفهم الرسائل الصوتية وبيرد عليها","بيشوف الصور وبيرد بطريقة تسويقية","منتجات بلا حدود تقريباً","ربط رسمي Cloud API"]' WHERE id = 'business';
  UPDATE plans SET features = '["ردود بلا حدود","بيفهم الرسائل الصوتية وبيرد عليها","بيشوف الصور وبيرد بطريقة تسويقية","حتى 100 منتج"]' WHERE id = 'free';
  `,
  // 16: الأرقام القديمة من النسخة الاحتياطية بس، ومعها 24 ساعة بعد الشرا (قرار صاحب المنصة)
  `
  UPDATE services SET description = 'كل الأرقام يلي راسلتك من أول ما فتحت واتساب، من نسختك الاحتياطية، بتنحفظ بجهات اتصالك بدفعة وحدة.',
    features = '["من النسخة الاحتياطية، من سنين لهلق","الملف بيتفك على جهازك وما بينرفع","بعد الشرا معك 24 ساعة لترفع النسخة","بدون تكرار ولا لمس للأسماء يلي حاططها إنت"]'
  WHERE id = 'contacts_old';
  `,
  // 17: طرق الدفع (صاحب المنصة، 30 تشرين الأول): شام كاش بالباركود، وكاش بالمركز
  `
  INSERT INTO platform_settings (key, value) VALUES
    ('shamcash_number', '"575679b5faa8163d47e74d848732e601"'),
    ('shamcash_name', '"عبد المجيد محمد ديب صالح"'),
    ('shamcash_qr', '"/uploads/shamcash-qr.jpg"'),
    ('cash_address', '"دمشق - قدسيا - خلف البلدية"')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
  `,
  // 18: أسعار «حفظ كل رقم جديد» (صاحب المنصة: شهر 10$، سنة 50$، والباقي بالنص)
  `
  INSERT INTO service_prices (service_id, months, price) VALUES ('contacts_new', 1, 10), ('contacts_new', 3, 25), ('contacts_new', 6, 35), ('contacts_new', 12, 50)
  ON CONFLICT(service_id, months) DO UPDATE SET price = excluded.price;
  `,
  // 19: سعر المجيب (صاحب المنصة: شهر 30$، سنة 210$، والباقي بالنص). الردود صارت بلا حدود، فباقة وحدة بتكفي: «أعمال» بتختفي من العرض
  `
  UPDATE plans SET price_monthly = 30 WHERE id = 'pro';
  INSERT INTO plan_prices (plan_id, months, price) VALUES ('pro', 1, 30), ('pro', 3, 80), ('pro', 6, 140), ('pro', 12, 210)
  ON CONFLICT(plan_id, months) DO UPDATE SET price = excluded.price;
  UPDATE plans SET is_public = 0 WHERE id = 'business';
  `
];

db.exec('CREATE TABLE IF NOT EXISTS _migrations (n INTEGER PRIMARY KEY)');
const done = new Set(db.prepare('SELECT n FROM _migrations').all().map(r => r.n));
migrations.forEach((sql, i) => {
  if (done.has(i + 1)) return;
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (n) VALUES (?)').run(i + 1);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
});

// أدوات مساعدة
export const q = {
  get: (sql, ...p) => db.prepare(sql).get(...p),
  all: (sql, ...p) => db.prepare(sql).all(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p)
};

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function getSetting(key, fallback = null) {
  const r = q.get('SELECT value FROM platform_settings WHERE key = ?', key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return r.value; }
}
export function setSetting(key, value) {
  q.run('INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, JSON.stringify(value));
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
export function bumpUsage(tenantId, field, n = 1) {
  const allowed = ['ai_replies', 'msgs_in', 'msgs_out', 'orders'];
  if (!allowed.includes(field)) return;
  q.run(`INSERT INTO usage (tenant_id, day, ${field}) VALUES (?, ?, ?)
         ON CONFLICT(tenant_id, day) DO UPDATE SET ${field} = ${field} + excluded.${field}`, tenantId, today(), n);
}
export function usageToday(tenantId) {
  return q.get('SELECT * FROM usage WHERE tenant_id = ? AND day = ?', tenantId, today())
    || { ai_replies: 0, msgs_in: 0, msgs_out: 0, orders: 0 };
}
