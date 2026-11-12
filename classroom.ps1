[CmdletBinding()]
param([ValidateSet('install','init','accounts','build','start','stop','test','check','browser')][string]$Action='start')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodePath=(Get-Command node.exe -ErrorAction Stop).Source
$vault=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'DemoClassroom'
$vaultFile=Join-Path $vault 'initial-accounts.xml'
switch ($Action) {
  'install' {
    $nodeDir=Split-Path -Parent $nodePath
    $npmCli=Join-Path $nodeDir 'node_modules/npm/bin/npm-cli.js'
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=$nodePath
    $start.UseShellExecute=$false
    $start.WorkingDirectory=$PSScriptRoot
    $start.Arguments='"'+$npmCli+'" ci --no-fund --no-audit'
    $childDirs=@($nodeDir, [Environment]::SystemDirectory, $env:SystemRoot)
    $start.EnvironmentVariables['Path']=($childDirs | Select-Object -Unique) -join ';'
    $install=[Diagnostics.Process]::Start($start)
    $install.WaitForExit()
    exit $install.ExitCode
  }
  'init' {
    if (Test-Path -LiteralPath $vaultFile) { throw 'Initial accounts already saved. Use .\classroom.ps1 accounts.' }
    New-Item -ItemType Directory -Path $vault -Force | Out-Null
    $json=& $nodePath --import tsx scripts/data.ts init
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $entries=($json -join [Environment]::NewLine | ConvertFrom-Json).credentials
    $accounts=foreach($item in $entries) {
      [System.Management.Automation.PSCredential]::new($item.username,(ConvertTo-SecureString $item.password -AsPlainText -Force))
    }
    $accounts | Export-Clixml -LiteralPath $vaultFile -Encoding UTF8
    Write-Output 'Initial credentials saved for this Windows user. Run .\classroom.ps1 accounts to display them.'
  }
  'accounts' {
    if (!(Test-Path -LiteralPath $vaultFile)) { throw 'No saved local credentials. Run init on an empty installation.' }
    $accounts=Import-Clixml -LiteralPath $vaultFile
    foreach($item in $accounts) { Write-Output ($item.UserName+'  '+$item.GetNetworkCredential().Password) }
  }
  'build' {
    & $nodePath --import tsx scripts/build-demos.ts
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $nodePath node_modules/next/dist/bin/next build --webpack
    exit $LASTEXITCODE
  }
  'start' { & $nodePath --import tsx server.ts; exit $LASTEXITCODE }
  'stop' { & $nodePath --import tsx scripts/stop.ts; exit $LASTEXITCODE }
  'check' { & $nodePath node_modules/typescript/bin/tsc --noEmit; exit $LASTEXITCODE }
  'browser' { & $nodePath --import tsx scripts/browser-qa.ts; exit $LASTEXITCODE }
  'test' {
    $specs=Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'tests') -Filter '*.test.ts' -File
    & $nodePath --import tsx --test @($specs.FullName)
    exit $LASTEXITCODE
  }
}
