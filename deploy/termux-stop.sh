#!/data/data/com.termux/files/usr/bin/bash
# إيقاف المجيب على الموبايل
pkill -f raddad-server-loop; pkill -f termux-update-loop.sh
pkill -f "node --no-warnings=ExperimentalWarning server.js"; pkill -f "cloudflared tunnel"
echo "✓ وقف كل شي"
