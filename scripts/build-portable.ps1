param(
    [switch]$SkipBuild,
    [string]$ScrcpyVersion = "4.1",
    [string]$ScrcpySha256 = "5b12172b3264b2889f4583ee64752ce832e29bc8b1089dca81093459697165db",
    [string]$OutputDirectory = "src-tauri/target/release/bundle/portable"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
    throw "The Windows portable package must be built on Windows."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $repoRoot

try {
    if (-not $SkipBuild) {
        & npm run tauri:build -- --no-bundle
        if ($LASTEXITCODE -ne 0) {
            throw "Tauri build failed with exit code $LASTEXITCODE."
        }
    }

    $package = Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
    $appVersion = $package.version
    $executable = Join-Path $repoRoot "src-tauri/target/release/scrcpy-gui-plus.exe"

    if (-not (Test-Path $executable -PathType Leaf)) {
        throw "Application executable was not found at $executable."
    }

    $outputRoot = Join-Path $repoRoot $OutputDirectory
    $portableName = "Mobile-Device-Studio_${appVersion}_x64-portable"
    $stagingRoot = Join-Path $outputRoot $portableName
    $archivePath = Join-Path $outputRoot "${portableName}.zip"
    $downloadPath = Join-Path $outputRoot "scrcpy-win64-v${ScrcpyVersion}.zip"
    $extractRoot = Join-Path $outputRoot "scrcpy-extract"

    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
    Remove-Item $stagingRoot, $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $archivePath, $downloadPath -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

    Copy-Item $executable (Join-Path $stagingRoot "Mobile Device Studio.exe")

    $scrcpyAsset = "scrcpy-win64-v${ScrcpyVersion}.zip"
    $scrcpyUrl = "https://github.com/Genymobile/scrcpy/releases/download/v${ScrcpyVersion}/${scrcpyAsset}"
    Write-Host "Downloading scrcpy v$ScrcpyVersion from the official Genymobile release..."
    Invoke-WebRequest -Uri $scrcpyUrl -OutFile $downloadPath
    $actualSha256 = (Get-FileHash $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $ScrcpySha256.ToLowerInvariant()) {
        throw "scrcpy archive checksum mismatch. Expected $ScrcpySha256 but received $actualSha256."
    }
    Expand-Archive -Path $downloadPath -DestinationPath $extractRoot -Force

    $scrcpySource = Get-ChildItem $extractRoot -Directory | Select-Object -First 1
    if (
        -not $scrcpySource -or
        -not (Test-Path (Join-Path $scrcpySource.FullName "scrcpy.exe")) -or
        -not (Test-Path (Join-Path $scrcpySource.FullName "adb.exe"))
    ) {
        throw "The downloaded scrcpy archive has an unexpected layout."
    }

    Copy-Item $scrcpySource.FullName (Join-Path $stagingRoot "scrcpy-bin") -Recurse

    @"
Mobile Device Studio $appVersion - Windows Portable

Run "Mobile Device Studio.exe" directly; installation is not required.
The bundled scrcpy v$ScrcpyVersion and ADB tools are stored in scrcpy-bin.

Requirements:
- Windows 10 or Windows 11 (64-bit)
- Microsoft Edge WebView2 Runtime
- USB debugging enabled on the Android device

Application preferences and WebView data are stored in the current Windows
user profile. Delete that application-data directory separately if you want
to remove all preferences after deleting this portable folder.
"@ | Set-Content (Join-Path $stagingRoot "README-PORTABLE.txt") -Encoding UTF8

    Compress-Archive -Path $stagingRoot -DestinationPath $archivePath -CompressionLevel Optimal
    Remove-Item $downloadPath -Force
    Remove-Item $extractRoot -Recurse -Force
    Write-Host "Portable package created: $archivePath"
}
finally {
    Pop-Location
}
