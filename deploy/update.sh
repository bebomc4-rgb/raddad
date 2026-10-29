#!/usr/bin/env bash
# تحديث ردّاد لنسخة جديدة بدون ما تخسر البيانات أو ربط واتساب
# الاستخدام: ارفع النسخة الجديدة لأي مجلد، وبعدين:  sudo bash deploy/update.sh
set -euo pipefail
APP_DIR=/opt/raddad
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> نسخة احتياطية من البيانات"
mkdir -p /opt/raddad-backups
tar -czf "/opt/raddad-backups/data-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$APP_DIR" data .env

echo "==> نسخ الملفات الجديدة"
rsync -a --exclude node_modules --exclude data --exclude .env "$SRC_DIR"/ "$APP_DIR"/
chown -R raddad:raddad "$APP_DIR"
cd "$APP_DIR" && sudo -u raddad npm install --omit=dev --no-audit --no-fund

systemctl restart raddad
echo "✅ تحدّث. السجلات: sudo journalctl -u raddad -f"
