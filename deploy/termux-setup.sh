#!/data/data/com.termux/files/usr/bin/bash
# تنصيب K FAST AI (ردّاد) على موبايل أندرويد عن طريق Termux — مرة وحدة
# قبلها:  pkg install -y git  &&  git clone <رابط الريبو مع التوكن> ~/raddad
# بعدها:  bash ~/raddad/deploy/termux-setup.sh
set -e
APP=~/raddad
cd "$APP"

echo "==> تحديث Termux وتنصيب الأدوات (بياخد كم دقيقة)"
yes | pkg update -y || true
yes | pkg upgrade -y || true
pkg install -y git nodejs cloudflared ffmpeg termux-api unzip
echo "Node: $(node -v)"

echo "==> صلاحية ملفات الموبايل (اضغط Allow إذا طلب)"
[ -d ~/storage/downloads ] || termux-setup-storage || true
sleep 3

echo "==> مكتبات المنصة"
bash "$APP/deploy/termux-npm.sh"

[ -f .env ] || cp .env.example .env
mkdir -p data

# بيانات المجيب من الكمبيوتر (جلسة الواتس، الزباين، الإعدادات): ملف raddad-data.zip بمجلد Download بالموبايل
ZIP=~/storage/downloads/raddad-data.zip
if [ ! -f data/raddad.db ] && [ -f "$ZIP" ]; then
  echo "==> عم انقل بيانات المجيب من raddad-data.zip"
  unzip -q -o "$ZIP" -d data
fi
[ -f data/raddad.db ] && echo "✓ البيانات موجودة" || echo "⚠️ ما لقيت raddad-data.zip بمجلد Download — المجيب رح يبلّش فاضي"

echo "==> تشغيل تلقائي لما الموبايل يقلع (تطبيق Termux:Boot)"
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/start-raddad <<'EOT'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
bash ~/raddad/deploy/termux-start.sh
EOT
chmod +x ~/.termux/boot/start-raddad "$APP"/deploy/*.sh

bash "$APP/deploy/termux-start.sh"
echo
echo "✅ المجيب شغّال على الموبايل: http://127.0.0.1:3000"
echo "   وكل تعديل جديد على GitHub بينسحب لحالو كل 5 دقايق."
