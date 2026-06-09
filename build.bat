@echo off
:: CMD Build Script for Session Resource Logger XPI using zip.exe
:: Compresses the contents of the 'extension' directory into 'session-resource-logger.xpi'

set "OUTPUT_FILE=session-resource-logger.xpi"

if exist "%OUTPUT_FILE%" (
    echo Cleaning up old XPI file...
    del "%OUTPUT_FILE%"
)

echo Packaging WebExtension from 'extension' directory using zip.exe...

:: Change directory to extension to ensure paths are at root of archive
cd extension
zip -r "..\%OUTPUT_FILE%" *
cd ..

if exist "%OUTPUT_FILE%" (
    echo Successfully built XPI file at: %OUTPUT_FILE%
) else (
    echo Error: Failed to create %OUTPUT_FILE%.
)
