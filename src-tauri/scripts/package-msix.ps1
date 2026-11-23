[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Publisher,

    [Parameter(Mandatory = $true)]
    [string]$CertificateThumbprint,

    [string]$Version = "0.1.0.0",
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    throw "Version must use four numeric components, for example 0.1.0.0."
}

$tauriRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $tauriRoot
$outputPath = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    Join-Path $repoRoot "artifacts"
} else {
    [System.IO.Path]::GetFullPath($OutputDirectory)
}

$certificate = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Thumbprint -eq ($CertificateThumbprint -replace '\s', '') } |
    Select-Object -First 1
if (-not $certificate) {
    throw "Signing certificate was not found in Cert:\CurrentUser\My."
}
if ($certificate.Subject -ne $Publisher) {
    throw "Publisher must exactly match the signing certificate subject '$($certificate.Subject)'."
}

$makeAppxPath = (Get-Command makeappx.exe -ErrorAction SilentlyContinue).Source
$signToolPath = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
$windowsKitsBin = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
if (-not $makeAppxPath -and (Test-Path $windowsKitsBin)) {
    $makeAppxPath = (Get-ChildItem $windowsKitsBin -Filter MakeAppx.exe -Recurse |
        Sort-Object FullName -Descending | Select-Object -First 1).FullName
}
if (-not $signToolPath -and (Test-Path $windowsKitsBin)) {
    $signToolPath = (Get-ChildItem $windowsKitsBin -Filter SignTool.exe -Recurse |
        Where-Object { $_.Directory.Name -eq "x64" } |
        Sort-Object FullName -Descending | Select-Object -First 1).FullName
}
if (-not $makeAppxPath -or -not $signToolPath) {
    throw "Install the Windows 10/11 SDK with MakeAppx.exe and SignTool.exe."
}

Push-Location $repoRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }

    cargo build --manifest-path src-tauri/Cargo.toml --release
    if ($LASTEXITCODE -ne 0) { throw "Rust release build failed." }
} finally {
    Pop-Location
}

$appExecutable = Join-Path $tauriRoot "target\release\dynamic-island.exe"
if (-not (Test-Path $appExecutable)) {
    throw "Built executable not found: $appExecutable"
}

$stagePath = Join-Path $env:TEMP ("dynamic-island-msix-" + [guid]::NewGuid().ToString("N"))
$assetsPath = Join-Path $stagePath "Assets"
New-Item -ItemType Directory -Path $assetsPath -Force | Out-Null
Copy-Item $appExecutable (Join-Path $stagePath "dynamic-island.exe")
Copy-Item (Join-Path $tauriRoot "icons\StoreLogo.png") (Join-Path $assetsPath "StoreLogo.png")
Copy-Item (Join-Path $tauriRoot "icons\Square150x150Logo.png") (Join-Path $assetsPath "Square150x150Logo.png")
Copy-Item (Join-Path $tauriRoot "icons\Square44x44Logo.png") (Join-Path $assetsPath "Square44x44Logo.png")

[xml]$manifest = Get-Content (Join-Path $tauriRoot "msix\Package.appxmanifest.template") -Raw
$identity = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
$identity.Publisher = $Publisher
$identity.Version = $Version
$manifest.Save((Join-Path $stagePath "AppxManifest.xml"))

New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$packagePath = Join-Path $outputPath "dynamic-island-$Version-x64.msix"
& $makeAppxPath pack /d $stagePath /p $packagePath /o
if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed." }

& $signToolPath sign /fd SHA256 /s My /sha1 ($CertificateThumbprint -replace '\s', '') $packagePath
if ($LASTEXITCODE -ne 0) { throw "MSIX signing failed." }

Write-Output "Signed MSIX created at: $packagePath"
Write-Output "Staging files are at: $stagePath"