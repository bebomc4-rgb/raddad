#!/data/data/com.termux/files/usr/bin/bash
# تشغيل المجيب بالخلفية، وإعادة تشغيلو لحالو إذا وقف، وسحب التعديلات من GitHub لحالها
APP=~/raddad
mkdir -p "$APP/data"
# يمنع أندرويد ينيّم Termux
command -v termux-wake-lock >/dev/null && termux-wake-lock

if ! pgrep -f "raddad-server-loop" >/dev/null; then
  nohup bash -c 'exec -a raddad-server-loop bash -c "cd ~/raddad; while true; do node --no-warnings=ExperimentalWarning server.js >> data/server.log 2>&1; echo \"[restart \$(date)]\" >> data/server.log; sleep 3; done"' >/dev/null 2>&1 &
  echo "✓ السيرفر اشتغل"
else
  echo "• السيرفر شغّال من قبل"
fi

if ! pgrep -f "termux-update-loop.sh" >/dev/null; then
  nohup bash "$APP/deploy/termux-update-loop.sh" >/dev/null 2>&1 &
  echo "✓ التحديث التلقائي من GitHub اشتغل"
fi
