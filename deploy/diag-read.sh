#!/usr/bin/env bash
# فك تشفير سجل السيرفر (المفتاح الخاص عند المساعد بس): bash deploy/diag-read.sh file.json
python3 - "$1" <<'P'
import json,sys,base64,subprocess
j=json.load(open(sys.argv[1]))
k=subprocess.run(['openssl','pkeyutl','-decrypt','-inkey',__import__('os').path.expanduser('~/.diag/key.pem'),'-pkeyopt','rsa_padding_mode:oaep','-pkeyopt','rsa_oaep_md:sha256'],input=base64.b64decode(j['k']),capture_output=True).stdout
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
print(AESGCM(k).decrypt(base64.b64decode(j['iv']),base64.b64decode(j['d'])+base64.b64decode(j['tag']),None).decode())
P
