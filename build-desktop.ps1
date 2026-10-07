$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$publish = Join-Path $root 'artifacts\publish\win-x64'
$installer = Join-Path $root 'installer\MyTOEIC.iss'
$dotnet = Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'
$iscc = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
  (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (!(Test-Path $dotnet)) { throw '.NET SDK 10 is not installed.' }
if (!$iscc) { throw 'Inno Setup 6 is not installed.' }
& $dotnet test (Join-Path $root 'desktop.tests\SentenceLab.Desktop.Tests.csproj') -c Release
if ($LASTEXITCODE) { exit $LASTEXITCODE }
if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
& $dotnet publish (Join-Path $root 'desktop\SentenceLab.Desktop.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -o $publish
if ($LASTEXITCODE) { exit $LASTEXITCODE }
& $iscc $installer
exit $LASTEXITCODE
