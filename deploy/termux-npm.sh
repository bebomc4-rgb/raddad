#!/data/data/com.termux/files/usr/bin/bash
# مكتبات المنصة على الموبايل. مكتبة الصور sharp ما إلها نسخة أندرويد، فمنركّب نسختها WebAssembly
cd ~/raddad
npm install --omit=dev --no-audit --no-fund
npm install --no-save --no-audit --no-fund --cpu=wasm32 sharp@0.34 || echo "(sharp: ما زبطت، تعديل الصور بس رح يوقف)"
