@echo off
setlocal enabledelayedexpansion

echo.
echo  DART Event Auditor - Auto Updater
echo  ==================================
echo.

:: Get the directory where this script is located
set "EXTENSION_DIR=%~dp0"
set "REPO=abn-digital/dart-auditor-extension"
set "TEMP_ZIP=%TEMP%\dart-update.zip"
set "TEMP_EXTRACT=%TEMP%\dart-update-extract"

:: Get latest version from GitHub API
echo  Checking for updates...
for /f "delims=" %%i in ('powershell -Command "(Invoke-RestMethod -Uri 'https://api.github.com/repos/%REPO%/releases/latest').tag_name"') do set "LATEST_VERSION=%%i"

if "%LATEST_VERSION%"=="" (
    echo  Error: Could not fetch latest version
    pause
    exit /b 1
)

echo  Latest version: %LATEST_VERSION%
echo.

:: Download the ZIP
echo  Downloading update...
set "DOWNLOAD_URL=https://github.com/%REPO%/releases/download/%LATEST_VERSION%/DART-Event-Auditor-%LATEST_VERSION%.zip"
powershell -Command "Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%TEMP_ZIP%'" 2>nul

if not exist "%TEMP_ZIP%" (
    echo  Error: Download failed
    pause
    exit /b 1
)

:: Clean up old temp extract folder
if exist "%TEMP_EXTRACT%" rmdir /s /q "%TEMP_EXTRACT%"
mkdir "%TEMP_EXTRACT%"

:: Extract ZIP
echo  Extracting files...
powershell -Command "Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%TEMP_EXTRACT%' -Force"

:: Copy files to extension directory (overwrite)
echo  Updating extension...
xcopy /s /y "%TEMP_EXTRACT%\*" "%EXTENSION_DIR%" >nul

:: Cleanup
del "%TEMP_ZIP%" 2>nul
rmdir /s /q "%TEMP_EXTRACT%" 2>nul

echo.
echo  Update complete! Version: %LATEST_VERSION%
echo.
echo  Now go to chrome://extensions and click
echo  the refresh icon to reload the extension.
echo.
pause
