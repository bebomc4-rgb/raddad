#!/usr/bin/env bash
# بيشتغل على السيرفر (Ubuntu) كـ root: بيجهّز ردّاد بس ما بيشغّلو لحتى توصل البيانات من الموبايل
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo "==> تنصيب Node.js 22 و git و cloudflared"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v cloudflared >/dev/null; then
  curl -fsSL -o /tmp/cf.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  apt-get install -y /tmp/cf.deb
fi
id raddad >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin raddad
echo "==> الكود من GitHub"
if [ -d /opt/raddad/.git ]; then git -C /opt/raddad fetch -q origin && git -C /opt/raddad reset -q --hard origin/main
else rm -rf /opt/raddad.tmp && git clone -q https://github.com/bebomc4-rgb/raddad /opt/raddad.tmp && mkdir -p /opt/raddad && cp -a /opt/raddad.tmp/. /opt/raddad/ && rm -rf /opt/raddad.tmp; fi
mkdir -p /opt/raddad/data
git config --global --add safe.directory /opt/raddad
cd /opt/raddad && npm install --omit=dev --no-audit --no-fund
chown -R raddad:raddad /opt/raddad
echo "==> الخدمة (السيرفر هوي الأساسي)"
cat > /etc/systemd/system/raddad.service <<'U'
[Unit]
Description=K FAST AI (raddad)
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=raddad
WorkingDirectory=/opt/raddad
ExecStart=/usr/bin/node --no-warnings=ExperimentalWarning server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=DEVICE_NAME=server
Environment=PRIMARY_DEVICE=server
StandardOutput=append:/opt/raddad/data/server.log
StandardError=append:/opt/raddad/data/server.log
[Install]
WantedBy=multi-user.target
U
echo "==> تحديث تلقائي من GitHub كل 5 دقايق"
cat > /usr/local/bin/raddad-update <<'U'
#!/usr/bin/env bash
cd /opt/raddad || exit 0
git fetch -q origin main || exit 0
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0
OLD=$(git rev-parse HEAD:package.json)
git reset -q --hard origin/main
[ "$OLD" != "$(git rev-parse HEAD:package.json)" ] && npm install --omit=dev --no-audit --no-fund
chown -R raddad:raddad /opt/raddad
echo "[$(date -Is)] updated to $(git log -1 --format='%h %s')" >> /opt/raddad/data/update.log
systemctl restart raddad
U
chmod +x /usr/local/bin/raddad-update
cat > /etc/systemd/system/raddad-update.service <<'U'
[Unit]
Description=K FAST AI update
[Service]
Type=oneshot
ExecStart=/usr/local/bin/raddad-update
U
cat > /etc/systemd/system/raddad-update.timer <<'U'
[Unit]
Description=K FAST AI update every 5 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
U
systemctl daemon-reload
systemctl enable raddad raddad-update.timer >/dev/null
systemctl start raddad-update.timer
echo "✓ السيرفر جاهز، ناطر البيانات من الموبايل"
