#!/data/data/com.termux/files/usr/bin/bash
# نقل المجيب من الموبايل للسيرفر — بيشتغل على الموبايل (Termux):  bash ~/raddad/deploy/move-to-server.sh IP
# بيطلب كلمة سر السيرفر مرة وحدة (إنت بتكتبها). بعدها الموبايل بيوقف نهائياً، والسيرفر بيشتغل بنفس الواتساب والحسابات.
set -e
IP="$1"; [ -n "$IP" ] || { echo "اكتب عنوان السيرفر: bash ~/raddad/deploy/move-to-server.sh 1.2.3.4"; exit 1; }
command -v ssh >/dev/null || pkg install -y openssh
mkdir -p ~/.ssh
S="ssh -o StrictHostKeyChecking=accept-new -o ControlMaster=auto -o ControlPath=$HOME/.ssh/cm-%r@%h -o ControlPersist=20m root@$IP"
echo "==> 1/4 اتصال بالسيرفر (اكتب كلمة السر لما يطلبها)"
$S 'echo ✓ متصل'
echo "==> 2/4 تجهيز السيرفر (دقيقتين تلاتة)"
$S 'bash -s' < ~/raddad/deploy/server-remote.sh
echo "==> 3/4 نقل البيانات (الحسابات، الإعدادات، ربط الواتساب)"
bash ~/raddad/deploy/termux-stop.sh || true
sleep 2
cd ~/raddad/data
tar czf - --exclude='server.log' --exclude='update.log' --exclude='backup-*' --exclude='backups' --exclude='auto-test*' --exclude='exports' . | $S 'mkdir -p /opt/raddad/data && tar xzf - -C /opt/raddad/data && chown -R raddad:raddad /opt/raddad/data'
echo "==> 4/4 تشغيل المجيب على السيرفر"
$S 'systemctl restart raddad; sleep 20; curl -s localhost:3000/api/whoami; echo'
date > ~/raddad/data/moved-to-server
echo "$IP" >> ~/raddad/data/moved-to-server
echo
echo "✅ خلص: المجيب صار على السيرفر $IP. الموبايل وقف نهائياً (ما بيرجع يشتغل لحالو)."
