@echo off
:: CMD Build Script for Session Resource Logger XPI using zip.exe
:: Compresses the contents of the 'extension' directory into 'session-resource-logger_yyyyMMdd.hhmmss.xpi'

:: Fetch timestamp in yyyyMMdd.hhmmss format reliably
for /f "usebackq" %%i in (`powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd.HHmmss'"`) do set "TS=%%i"

set "OUTPUT_FILE=session-resource-logger_%TS%.xpi"

echo Packaging WebExtension from 'extension' directory into %OUTPUT_FILE% using zip.exe...

:: Change directory to extension to ensure paths are at root of archive
cd extension
zip -r -q "..\output_xpi\%OUTPUT_FILE%" *
cd ..

if exist "%OUTPUT_FILE%" (
    echo Successfully built XPI file at: %OUTPUT_FILE%
) else (
    echo Error: Failed to create %OUTPUT_FILE%.
)
