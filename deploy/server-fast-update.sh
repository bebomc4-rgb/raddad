#!/usr/bin/env bash
# مرة وحدة عالسيرفر:  ssh root@IP "cd /opt/raddad && git pull -q && bash deploy/server-fast-update.sh"
# بعدها كل تعديل على GitHub بيوصل للسيرفر خلال ثواني (مو 5 دقايق)
set -e
cat > /usr/local/bin/raddad-update <<'U'
#!/usr/bin/env bash
exec bash /opt/raddad/deploy/server-update.sh
U
chmod +x /usr/local/bin/raddad-update
cat > /etc/systemd/system/raddad-update.path <<'U'
[Unit]
Description=K FAST AI update right after GitHub says so
[Path]
PathExists=/opt/raddad/data/update-now
Unit=raddad-update.service
[Install]
WantedBy=multi-user.target
U
cat > /etc/systemd/system/raddad-update.timer <<'U'
[Unit]
Description=K FAST AI update every minute (backup)
[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
[Install]
WantedBy=timers.target
U
systemctl daemon-reload
systemctl enable --now raddad-update.path raddad-update.timer >/dev/null
systemctl restart raddad-update.timer
chown -R raddad:raddad /opt/raddad
echo "✓ التحديث صار فوري (وكل دقيقة احتياط)"
