#!/data/data/com.termux/files/usr/bin/bash
# كل 5 دقايق: إذا في تعديل جديد على GitHub، منسحبو ومنعيد تشغيل السيرفر لحالو (بلا ما حدا يكبس شي)
cd ~/raddad || exit 1
while true; do
  sleep 300
  git fetch -q origin 2>>data/update.log || continue
  B=$(git rev-parse --abbrev-ref HEAD)
  [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$B")" ] && continue
  OLDPKG=$(git rev-parse HEAD:package.json)
  git reset -q --hard "origin/$B"
  chmod +x deploy/*.sh
  [ "$OLDPKG" != "$(git rev-parse HEAD:package.json)" ] && bash deploy/termux-npm.sh >> data/update.log 2>&1
  echo "[$(date)] updated to $(git log -1 --format='%h %s')" >> data/update.log
  pkill -f "node --no-warnings=ExperimentalWarning server.js" # حلقة السيرفر بترجّعو بعد 3 ثواني
done
