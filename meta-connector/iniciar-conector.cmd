@echo off
cd /d "%~dp0"
"%LOCALAPPDATA%\SocioMetaConnector\app\runtime\node.exe" "%LOCALAPPDATA%\SocioMetaConnector\app\connector.mjs" --resume
pause
