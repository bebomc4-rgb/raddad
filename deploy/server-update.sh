#!/usr/bin/env bash
# تحديث السيرفر من GitHub: بيشتغل كـ root فوراً بعد كل تعديل (GitHub بيدق /api/deploy-hook) وكل دقيقة احتياط
main() {
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
