@echo off
title Raddad image AI - do not close
cd /d C:\ComfyUI\ComfyUI_windows_portable
.\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --listen 127.0.0.1 --port 8188 --lowvram --disable-auto-launch
