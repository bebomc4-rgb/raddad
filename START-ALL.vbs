' K FAST AI - starts everything hidden
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
Function Running(pattern)
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set ps = wmi.ExecQuery("SELECT CommandLine FROM Win32_Process")
  Running = False
  For Each p In ps
    If Not IsNull(p.CommandLine) Then
      If InStr(1, p.CommandLine, pattern, 1) > 0 Then Running = True
    End If
  Next
End Function
llama = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Microsoft\WinGet\Packages\ggml.llamacpp_Microsoft.Winget.Source_8wekyb3d8bbwe\llama-server.exe"
model = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\Downloads\Qwen2.5-7B-Instruct-Q4_K_M.gguf"
If fs.FileExists(llama) And fs.FileExists(model) And Not Running("llama-server") Then
  sh.Run """" & llama & """ -m """ & model & """ --port 8080 -ngl 99 -c 65536 -np 4 --cache-type-k q8_0 --cache-type-v q8_0 --alias qwen", 0, False
End If
If fs.FileExists("C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\main.py") And Not Running("ComfyUI\main.py") Then
  sh.Run "cmd /c ""C:\raddad\deploy\image-ai-start.bat""", 0, False
End If
' the bot runs on the phone now: the PC must NOT start its own copy (two copies would fight over the same WhatsApp)
onPhone = fs.FileExists("C:\raddad\RUN-ON-PHONE.txt")
' any code update restarts the server by itself (no need to run RESTART-ALL)
If Not onPhone And Not Running("watch-restart.ps1") Then
  sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\raddad\deploy\watch-restart.ps1""", 0, False
End If
If Not onPhone And Not Running("windows-start.bat") Then
  sh.Run "cmd /c ""C:\raddad\deploy\windows-start.bat""", 0, False
End If
