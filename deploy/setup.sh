#!/usr/bin/env bash
# تنصيب ردّاد على سيرفر Ubuntu (Oracle Cloud المجاني أو أي VPS)
# الاستخدام: ارفع مجلد raddad للسيرفر، وبعدين:  sudo bash deploy/setup.sh
set -euo pipefail

APP_DIR=/opt/raddad
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> تحديث النظام وتنصيب Node.js 22"
apt-get update -y
apt-get install -y ca-certificates curl gnupg rsync git
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> إنشاء مستخدم للتطبيق"
id raddad >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin raddad

echo "==> نسخ الملفات إلى $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude data --exclude .env "$SRC_DIR"/ "$APP_DIR"/
[ -f "$APP_DIR/.env" ] || cp "$APP_DIR/.env.example" "$APP_DIR/.env"
mkdir -p "$APP_DIR/data"
chown -R raddad:raddad "$APP_DIR"

echo "==> تنصيب المكتبات"
cd "$APP_DIR"
sudo -u raddad npm install --omit=dev --no-audit --no-fund

echo "==> تشغيل الخدمة (بتشتغل لحالها مع كل إعادة تشغيل للسيرفر)"
cp "$APP_DIR/deploy/raddad.service" /etc/systemd/system/raddad.service
systemctl daemon-reload
systemctl enable --now raddad
sleep 2
systemctl --no-pager status raddad | head -n 5 || true

echo
echo "✅ ردّاد شغّال على http://127.0.0.1:3000"
echo "   عدّل الإعدادات:   sudo nano $APP_DIR/.env   وبعدها:  sudo systemctl restart raddad"
echo "   السجلات:          sudo journalctl -u raddad -f"
echo "   الخطوة الجاية: اربطه بدومينك عن طريق Cloudflare Tunnel (اقرا README.md)"
