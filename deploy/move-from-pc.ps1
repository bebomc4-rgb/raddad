# نقل المجيب من الكمبيوتر للسيرفر. بيشتغل من cmd:  C:\raddad\deploy\move-from-pc.bat 1.2.3.4
# بيطلب كلمة سر السيرفر مرتين (إنت بتكتبها). بعدها الكمبيوتر والموبايل بيوقفوا، والسيرفر بيشتغل بنفس الواتساب والحسابات.
param([string]$IP, [string]$Mode = 'all')
# Mode: important = اللوغو وصور المنتجات بس | all = كلشي | quick = بدون الصور والصوت (المجيب بيشتغل بسرعة) | media = الصور بس، بعد quick، بلا ما يوقف المجيب
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = 'C:\raddad'; $data = "$root\data"
if (-not $IP) { Write-Host 'اكتب رقم السيرفر:  C:\raddad\deploy\move-from-pc.bat 1.2.3.4' -ForegroundColor Yellow; exit 1 }
$H = if ($IP -like '*@*') { $IP } else { "root@$IP" }
$O = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30')

if ($Mode -eq 'all') {
Write-Host ''
Write-Host '==> 1/4 تجهيز السيرفر (اكتب كلمة سر السيرفر لما يطلبها، الحروف ما بتبيّن وهاد طبيعي)' -ForegroundColor Cyan
ssh @O $H 'curl -fsSL https://raw.githubusercontent.com/bebomc4-rgb/raddad/main/deploy/server-remote.sh -o /tmp/raddad-setup.sh && bash /tmp/raddad-setup.sh'
if ($LASTEXITCODE -ne 0) { Write-Host 'X تجهيز السيرفر ما زبط. الكمبيوتر ما انلمس. صوّر الشاشة وابعتها.' -ForegroundColor Red; exit 1 }

Write-Host '==> 2/4 إيقاف المجيب على الكمبيوتر' -ForegroundColor Cyan
Set-Content -Path "$data\moved-to-server" -Value "$(Get-Date -Format s)`r`n$IP"
Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'server\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4
}

Write-Host '==> 3/4 نقل البيانات (الحسابات، الإعدادات، ربط الواتساب). اكتب كلمة السر كمان مرة' -ForegroundColor Cyan
$ex = @('--exclude=server.log', '--exclude=update.log', '--exclude=backup-*', '--exclude=backups', '--exclude=auto-test*', '--exclude=exports', '--exclude=moved-to-server', '--exclude=*.pid')
$media = @('*.jpg', '*.jpeg', '*.png', '*.webp', '*.gif', '*.heic', '*.mp4', '*.webm', '*.mov', '*.ogg', '*.opus', '*.mp3', '*.m4a', '*.wav', '*.pdf') | ForEach-Object { "--exclude=$_" }
if ($Mode -eq 'important') {
  $t = "$env:TEMP\raddad-important.tgz"; $list = "$env:TEMP\raddad-important.txt"
  node --no-warnings "$root\deploy\important-files.js" $list
  Write-Host ("   عدد الملفات المهمة: {0}" -f (Get-Content $list | Where-Object { $_ }).Count)
  Remove-Item $t -ErrorAction SilentlyContinue
  tar -czf $t -C $data -T $list
} elseif ($Mode -eq 'media') {
  $t = "$env:TEMP\raddad-data.tgz"
  if (-not (Test-Path $t)) { tar -czf $t @ex -C $data . }
} else {
  $t = if ($Mode -eq 'quick') { "$env:TEMP\raddad-quick.tgz" } else { "$env:TEMP\raddad-data.tgz" }
  Remove-Item $t -ErrorAction SilentlyContinue
  if ($Mode -eq 'quick') { tar -czf $t @ex @media -C $data . } else { tar -czf $t @ex -C $data . }
}
Write-Host ("   الحجم: {0:N0} ميغا" -f ((Get-Item $t).Length / 1MB))
if ($LASTEXITCODE -ne 0) { Write-Host 'X ضغط البيانات ما زبط. صوّر الشاشة وابعتها.' -ForegroundColor Red; exit 1 }
$remote = if ($Mode -eq 'media' -or $Mode -eq 'important') { 'cat > /tmp/raddad-media.tgz && tar xzf /tmp/raddad-media.tgz --skip-old-files -C /opt/raddad/data && rm -f /tmp/raddad-media.tgz && chown -R raddad:raddad /opt/raddad/data && echo MEDIA-OK' } else { 'cat > /tmp/raddad-data.tgz && mkdir -p /opt/raddad/data && tar xzf /tmp/raddad-data.tgz -C /opt/raddad/data && rm -f /tmp/raddad-data.tgz && chown -R raddad:raddad /opt/raddad && systemctl restart raddad && sleep 20 && curl -s localhost:3000/api/whoami && echo' }
Write-Host '==> 4/4 بعد ما تكتب كلمة السر: نقل وتشغيل المجيب على السيرفر (دقيقة تقريباً)' -ForegroundColor Cyan
cmd /c "ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 $H `"$remote`" < `"$t`""
if ($LASTEXITCODE -ne 0) { Write-Host 'X نقل البيانات ما زبط. صوّر الشاشة وابعتها.' -ForegroundColor Red; exit 1 }
if ($Mode -ne 'quick') { Remove-Item $t -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host "✅ خلص: المجيب صار على السيرفر $IP. الكمبيوتر وقف (ما بيرجع يشتغل لحالو)." -ForegroundColor Green
