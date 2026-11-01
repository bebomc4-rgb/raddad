#!/usr/bin/env bash
# تحديث السيرفر من GitHub: بيشتغل كـ root فوراً بعد كل تعديل (GitHub بيدق /api/deploy-hook) وكل دقيقة احتياط
# (1 تشرين التاني 2026) صار فوري: GitHub Actions → /api/deploy-hook → data/update-now → raddad-update.path
main() {
  # systemd ما بيعطي HOME → git ما بيشوف safe.directory تبع root وبيرفض المجلد (dubious ownership). هيك بيشتغل دايماً
  export HOME="${HOME:-/root}"
  git config --system --get-all safe.directory 2>/dev/null | grep -qx /opt/raddad || git config --system --add safe.directory /opt/raddad
  rm -f /opt/raddad/data/update-now
  cd /opt/raddad || return 0
  git fetch -q origin main || return 0
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && return 0
  local OLD; OLD=$(git rev-parse HEAD:package.json)
  git reset -q --hard origin/main
  [ "$OLD" != "$(git rev-parse HEAD:package.json)" ] && npm install --omit=dev --no-audit --no-fund
  chown -R raddad:raddad /opt/raddad
  echo "[$(date -Is)] updated to $(git log -1 --format='%h %s')" >> /opt/raddad/data/update.log
  systemctl restart raddad
}
main "$@"; exit 0
