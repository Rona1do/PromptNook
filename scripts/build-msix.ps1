param(
  [Parameter(Mandatory=$true)][string]$IdentityName,
  [Parameter(Mandatory=$true)][string]$Publisher,
  [Parameter(Mandatory=$true)][string]$PublisherDisplayName,
  [ValidatePattern('^\d+\.\d+\.\d+\.0$')][string]$Version = '0.2.3.0',
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$makeAppx = Get-ChildItem $sdkRoot -Directory | Where-Object Name -Match '^10\.' |
  Sort-Object { [version]$_.Name } -Descending |
  ForEach-Object { Join-Path $_.FullName 'x64/makeappx.exe' } |
  Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$makeAppx) { throw 'Install the Windows SDK with MakeAppx first.' }
if (!$IdentityName.Trim() -or !$Publisher.StartsWith('CN=') -or !$PublisherDisplayName.Trim()) {
  throw 'Use the exact package identity and publisher values from Partner Center.'
}
Push-Location $projectRoot
try {
  if (!$SkipBuild) {
    & npm.cmd run tauri -- build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed.' }
  }
  $outputRoot = Join-Path $projectRoot 'release-artifacts/msix'
  $stage = Join-Path $outputRoot ([guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path (Join-Path $stage 'Assets') -Force | Out-Null
  Copy-Item (Join-Path $projectRoot 'src-tauri/target/release/promptnook.exe') $stage
  foreach ($name in @('Square44x44Logo.png','Square150x150Logo.png','StoreLogo.png')) {
    Copy-Item (Join-Path $projectRoot "src-tauri/icons/$name") (Join-Path $stage "Assets/$name")
  }
  $nameXml = [Security.SecurityElement]::Escape($IdentityName)
  $publisherXml = [Security.SecurityElement]::Escape($Publisher)
  $displayXml = [Security.SecurityElement]::Escape($PublisherDisplayName)
  $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap rescap">
 <Identity Name="$nameXml" Publisher="$publisherXml" Version="$Version" ProcessorArchitecture="x64" />
 <Properties><DisplayName>PromptNook</DisplayName><PublisherDisplayName>$displayXml</PublisherDisplayName><Logo>Assets/StoreLogo.png</Logo></Properties>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.22000.0" MaxVersionTested="10.0.26100.0" /></Dependencies>
 <Resources><Resource Language="en-us" /></Resources>
 <Applications><Application Id="App" Executable="promptnook.exe" EntryPoint="Windows.FullTrustApplication">
 <uap:VisualElements DisplayName="PromptNook" Description="Local prompt recipes and ComfyUI workflow export" BackgroundColor="transparent" Square150x150Logo="Assets/Square150x150Logo.png" Square44x44Logo="Assets/Square44x44Logo.png" />
 </Application></Applications>
 <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
"@
  [IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $manifest, [Text.UTF8Encoding]::new($false))
  $output = Join-Path $outputRoot "PromptNook_${Version}_x64_$([guid]::NewGuid().ToString('N').Substring(0,8)).msix"
  & $makeAppx pack /d $stage /p $output
  if ($LASTEXITCODE -ne 0) { throw 'MSIX validation/packing failed.' }
  Get-FileHash -LiteralPath $output -Algorithm SHA256
  Write-Output "Unsigned Store submission package: $output"
  Write-Output 'Store identity must match Partner Center. Packaging success is not Store certification or installation validation.'
} finally { Pop-Location }
