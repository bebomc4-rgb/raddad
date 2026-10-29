@echo off
title Raddad - image AI setup
rem Installs ComfyUI + FLUX.2 klein 4B (fast) + Qwen-Image-Edit 2511 (high quality) (free local image editing on your NVIDIA GPU). Safe to run again: downloads resume.
set ROOT=C:\ComfyUI
set APP=%ROOT%\ComfyUI_windows_portable
mkdir "%ROOT%" 2>nul
cd /d "%ROOT%"
echo.
echo === 1/5  ComfyUI (about 2 GB) ===
if not exist "%APP%\run_nvidia_gpu.bat" (
  curl -L --retry 30 --retry-all-errors -C - -o comfy.7z https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z || goto fail
  echo Extracting...
  tar -xf comfy.7z -C "%ROOT%" || goto fail
  del comfy.7z
)
set M=%APP%\ComfyUI\models
echo.
echo === 2/5  Image model (about 4 GB) ===
curl -L --retry 30 --retry-all-errors -C - -o "%M%\diffusion_models\flux-2-klein-4b-fp8.safetensors" https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/resolve/main/flux-2-klein-4b-fp8.safetensors || goto fail
echo.
echo === 3/5  Text encoder (about 8 GB) ===
curl -L --retry 30 --retry-all-errors -C - -o "%M%\text_encoders\qwen_3_4b.safetensors" https://huggingface.co/Comfy-Org/flux2-klein-4B/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors || goto fail
echo.
echo === 4/5  VAE (about 0.3 GB) ===
curl -L --retry 30 --retry-all-errors -C - -o "%M%\vae\flux2-vae.safetensors" https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors || goto fail
echo.
echo === HQ 1/5  GGUF support ===
if not exist "%APP%\ComfyUI\custom_nodes\ComfyUI-GGUF" (
  git clone --depth 1 https://github.com/city96/ComfyUI-GGUF "%APP%\ComfyUI\custom_nodes\ComfyUI-GGUF" || goto fail
)
"%APP%\python_embeded\python.exe" -s -m pip install --upgrade gguf || goto fail
mkdir "%M%\unet" 2>nul
mkdir "%M%\loras" 2>nul
echo.
echo === HQ 2/5  Qwen image edit model (about 9 GB) ===
curl -L --retry 30 --retry-all-errors -C - -o "%M%\unet\qwen-image-edit-2511-Q3_K_S.gguf" https://huggingface.co/unsloth/Qwen-Image-Edit-2511-GGUF/resolve/main/qwen-image-edit-2511-Q3_K_S.gguf || goto fail
echo.
echo === HQ 3/5  Qwen text encoder (about 9 GB) ===
curl -L --retry 30 --retry-all-errors -C - -o "%M%\text_encoders\qwen_2.5_vl_7b_fp8_scaled.safetensors" https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors || goto fail
echo.
echo === HQ 4/5  Qwen VAE ===
curl -L --retry 30 --retry-all-errors -C - -o "%M%\vae\qwen_image_vae.safetensors" https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors || goto fail
echo.
echo === HQ 5/5  4-step speed LoRA ===
curl -L --retry 30 --retry-all-errors -C - -o "%M%\loras\Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors || goto fail
echo.
echo === Auto start ===
copy /y "C:\raddad\deploy\image-ai-start.bat" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\raddad-image-ai.bat" >nul
taskkill /fi "WINDOWTITLE eq Raddad image AI*" /t /f >nul 2>nul
start "Raddad image AI - do not close" /min "C:\raddad\deploy\image-ai-start.bat"
echo.
echo [OK] Done. Image AI is starting (window "Raddad image AI").
pause
exit /b 0
:fail
echo.
echo [X] Something failed. Check your internet and run this file again - it continues where it stopped.
pause
exit /b 1
