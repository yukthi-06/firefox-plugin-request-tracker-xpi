# build.ps1 - Package the Firefox WebExtension as an XPI file
# This script compresses the contents of the 'extension' directory into 'session-resource-logger.xpi'

$SourceDir = Join-Path $PSScriptRoot "extension"
$OutputFile = Join-Path $PSScriptRoot "session-resource-logger.xpi"

if (Test-Path $OutputFile) {
    Remove-Item $OutputFile -Force
    Write-Host "Cleaned up old XPI file."
}

if (-not (Test-Path $SourceDir)) {
    Write-Error "Source directory '$SourceDir' does not exist."
    exit 1
}

Write-Host "Packaging WebExtension from $SourceDir into $OutputFile..."

# To ensure manifest.json is at the root of the zip archive, we zip the contents directly
$CurrentDir = Get-Location
Set-Location $SourceDir
try {
    Get-ChildItem | Compress-Archive -DestinationPath $OutputFile -Force
    Write-Host "Successfully built XPI file at: $OutputFile"
}
finally {
    Set-Location $CurrentDir
}
