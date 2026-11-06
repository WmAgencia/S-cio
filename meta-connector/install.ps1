$ErrorActionPreference = 'Stop'
$destinoConector = Join-Path $env:LOCALAPPDATA 'SocioMetaConnector\app'
New-Item -ItemType Directory -Force -Path $destinoConector | Out-Null
$arquivosConector = @('package.json','package-lock.json','connector.mjs','runtime.mjs','protocol.mjs','iniciar-conector.cmd','README.md')
foreach ($nomeConector in $arquivosConector) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $nomeConector) -Destination (Join-Path $destinoConector $nomeConector) -Force
}
$nodeConector = Join-Path $destinoConector 'runtime\node.exe'
$npmConector = Join-Path $destinoConector 'runtime\node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $nodeConector)) {
    $nodeExistenteConector = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeExistenteConector) {
        $versaoExistenteConector = & $nodeExistenteConector.Source --version
        $npmExistenteConector = Join-Path (Split-Path $nodeExistenteConector.Source -Parent) 'node_modules\npm'
        if ($versaoExistenteConector -match '^v24\.' -and (Test-Path -LiteralPath (Join-Path $npmExistenteConector 'bin\npm-cli.js'))) {
            Write-Host 'Preparando uma copia local do Node.js 24 ja instalado...'
            $modulosRuntimeConector = Join-Path $destinoConector 'runtime\node_modules'
            New-Item -ItemType Directory -Force -Path $modulosRuntimeConector | Out-Null
            Copy-Item -LiteralPath $nodeExistenteConector.Source -Destination $nodeConector -Force
            Copy-Item -LiteralPath $npmExistenteConector -Destination $modulosRuntimeConector -Recurse -Force
        }
    }
}
if (-not (Test-Path -LiteralPath $nodeConector)) {
    Write-Host 'Baixando Node.js 24 do site oficial e verificando SHA-256...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $manifestoConector = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 45 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt').Content
    $linhaNodeConector = [regex]::Match($manifestoConector, '(?m)^([a-f0-9]{64})\s+(node-v24\.\d+\.\d+-win-x64\.zip)\s*$')
    if (-not $linhaNodeConector.Success) { throw 'Manifesto oficial do Node.js invalido.' }
    $nomeNodeConector = $linhaNodeConector.Groups[2].Value
    $zipNodeConector = Join-Path $destinoConector $nomeNodeConector
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 ('https://nodejs.org/dist/latest-v24.x/' + $nomeNodeConector) -OutFile $zipNodeConector
    if ((Get-FileHash -LiteralPath $zipNodeConector -Algorithm SHA256).Hash.ToLowerInvariant() -ne $linhaNodeConector.Groups[1].Value) { throw 'Checksum do Node.js diferente do manifesto oficial.' }
    Expand-Archive -LiteralPath $zipNodeConector -DestinationPath $destinoConector -Force
    $pastaNodeConector = Join-Path $destinoConector ($nomeNodeConector -replace '\.zip$', '')
    $pastaRuntimeConector = Join-Path $destinoConector 'runtime'
    if (Test-Path -LiteralPath $pastaRuntimeConector) { throw 'Pasta runtime existente sem node.exe. Confira a instalacao antes de continuar.' }
    Rename-Item -LiteralPath $pastaNodeConector -NewName 'runtime'
}
if (-not (Test-Path -LiteralPath $npmConector)) { throw 'Runtime incompleto. Reinstale o conector para reparar o Node.js/npm.' }
Push-Location -LiteralPath $destinoConector
try {
    & $nodeConector $npmConector ci --omit=dev --ignore-scripts --no-audit
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel instalar as dependencias fixadas do conector.' }
} finally { Pop-Location }
$protocoloConector = 'HKCU:\Software\Classes\socio-meta'
New-Item -Path $protocoloConector -Force | Out-Null
Set-Item -Path $protocoloConector -Value 'URL:Socio Meta Connector'
New-ItemProperty -Path $protocoloConector -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-Item -Path "$protocoloConector\shell\open\command" -Force | Out-Null
$comandoConector = '"' + $nodeConector + '" "' + (Join-Path $destinoConector 'connector.mjs') + '" "%1"'
Set-Item -Path "$protocoloConector\shell\open\command" -Value $comandoConector
$atalhoConector = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Iniciar Conector Socio.cmd'
Copy-Item -LiteralPath (Join-Path $destinoConector 'iniciar-conector.cmd') -Destination $atalhoConector -Force
Write-Host 'Conector instalado para este usuario. Volte ao Socio e clique em Conectar no meu navegador.'
