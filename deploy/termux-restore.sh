#!/data/data/com.termux/files/usr/bin/bash
# نقل بيانات المجيب من الكمبيوتر (raddad-data.zip بمجلد Download) للموبايل، وتشغيلو. كل شي بأمر واحد
ZIP=$(ls ~/storage/downloads/raddad-data*.zip 2>/dev/null | head -1)
[ -z "$ZIP" ] && ZIP=$(find ~/storage/shared -name "raddad-data*.zip" 2>/dev/null | head -1)
if [ -z "$ZIP" ]; then echo "❌ ما لقيت raddad-data.zip — حطّو بمجلد Download واعطي Termux صلاحية التخزين (termux-setup-storage)"; exit 1; fi
echo "✓ لقيت الملف: $ZIP"
bash ~/raddad/deploy/termux-stop.sh >/dev/null 2>&1; sleep 2
cd ~/raddad || exit 1
[ -d data ] && mv data "data-old-$(date +%s)"
mkdir -p data
echo "… عم فك الملف (كم دقيقة)"
unzip -q -o "$ZIP" -d data 2>&1 | grep -v backslashes
[ -f data/raddad.db ] || { [ -f data/data/raddad.db ] && mv data/data/* data/ && rmdir data/data; }
if [ ! -f data/raddad.db ]; then echo "❌ الملف ما فيه raddad.db"; ls data; exit 1; fi
echo "✓ البيانات جاهزة"
bash ~/raddad/deploy/termux-start.sh
echo
echo "✅ خلص. استنى دقيقتين وافتح https://k-fast-ai.pages.dev وسجّل دخول بحسابك القديم"
