' K FAST AI - restart everything hidden (no black windows)
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c ""C:\raddad\STOP-ALL.bat""", 0, True
WScript.Sleep 3000
sh.Run "wscript ""C:\raddad\START-ALL.vbs""", 0, False
