# ============================================================
#  Instalador automatico de camaras (Sabor Tico) - PASO UNICO
#  Levanta el puente, DETECTA tus camaras solas y configura el
#  grabador 24/7. Solo requiere el archivo .env lleno.
# ============================================================
$Host.UI.RawUI.WindowTitle = 'Camaras Sabor Tico - Instalador'
Set-Location $PSScriptRoot
function Fallo($msg){ Write-Host ''; Write-Host ('[X] ' + $msg) -ForegroundColor Red; Read-Host 'Enter para salir'; exit 1 }

Write-Host '== Paso 1 de 5: Revisando tus datos (.env)...' -ForegroundColor Cyan
if(-not (Test-Path .env)){ Fallo 'No existe el archivo .env en esta carpeta' }
$envRaw = Get-Content .env -Raw
if($envRaw -match 'pegar-aqui' -or $envRaw -match 'ejemplo\.com'){ Fallo 'Primero llena el archivo .env con tus datos de Wyze (abrilo con el Bloc de notas, llenalo y guarda)' }

# IP local de esta compu (el puente la usa para transmitir a otros dispositivos)
try{
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' -and $_.InterfaceAlias -notmatch 'WSL|vEthernet|Loopback' -and ($_.PrefixOrigin -eq 'Dhcp' -or $_.PrefixOrigin -eq 'Manual') } | Select-Object -First 1 -ExpandProperty IPAddress)
  if($ip){
    $lineas = @(Get-Content .env) | Where-Object { $_ -notmatch '^WB_IP=' }
    $lineas += "WB_IP=$ip"
    [IO.File]::WriteAllLines((Join-Path $PSScriptRoot '.env'), $lineas)
    Write-Host ('   IP de esta compu: ' + $ip) -ForegroundColor Green
  }
}catch{}

Write-Host '== Paso 2 de 5: Arrancando Docker...' -ForegroundColor Cyan
docker info *> $null
if($LASTEXITCODE -ne 0){
  $dd = $null
  foreach($p in @((Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
                  (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'),
                  (Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe'))){
    if(Test-Path $p){ $dd = $p; break }
  }
  if($dd){ Start-Process $dd } else { Fallo 'Docker Desktop no esta instalado. Instalalo primero y volve a intentar.' }
  $ok = $false
  for($i=0; $i -lt 60; $i++){
    Start-Sleep 5
    docker info *> $null
    if($LASTEXITCODE -eq 0){ $ok = $true; break }
    Write-Host '   ... esperando a que Docker arranque (si pregunta algo, acepta)'
  }
  if(-not $ok){ Fallo 'Docker no arranco. Abre Docker Desktop, acepta los terminos si pregunta, y corre PROBAR.bat de nuevo.' }
}

Write-Host '== Paso 3 de 5: Levantando el puente (la 1a vez descarga ~500 MB)...' -ForegroundColor Cyan
docker compose up -d wyze-bridge
if($LASTEXITCODE -ne 0){ Fallo 'No se pudo levantar el puente de camaras' }

Write-Host '== Paso 4 de 5: Buscando tus camaras en tu cuenta Wyze...' -ForegroundColor Cyan
$cams = @()
for($i=0; $i -lt 36; $i++){
  Start-Sleep 5
  try{
    $api = Invoke-RestMethod -Uri 'http://localhost:5000/api/cameras' -TimeoutSec 5
    if($api){ $cams = @($api | ForEach-Object { $_.name } | Where-Object { $_ }) }
    if($cams.Count -gt 0){ break }
  }catch{}
  Write-Host '   ... esperando (el puente esta entrando a tu cuenta Wyze)'
}
if($cams.Count -eq 0){ Fallo 'No se encontraron camaras. Revisa el correo, la clave y el API Key en .env, y que las camaras esten en linea en la app de Wyze. Luego corre INSTALAR-TODO.bat de nuevo.' }
Write-Host ('   Camaras encontradas: ' + ($cams -join ', ')) -ForegroundColor Green

Write-Host '== Paso 5 de 5: Configurando el grabador 24/7 (deteccion de personas incluida)...' -ForegroundColor Cyan
$retain = 2
if($envRaw -match 'RETAIN_DAYS=(\d+)'){ $retain = [int]$Matches[1] }
$cfg  = "mqtt:`n  enabled: false`n`n"
$cfg += "detect:`n  enabled: true`n  width: 1280`n  height: 720`n  fps: 5`n`n"
$cfg += "objects:`n  track:`n    - person`n    - dog`n    - cat`n    - car`n`n"
$cfg += "record:`n  enabled: true`n  retain:`n    days: $retain`n    mode: all`n`n"
$cfg += "cameras:`n"
foreach($c in $cams){
  $cfg += "  ${c}:`n"
  $cfg += "    ffmpeg:`n      inputs:`n"
  $cfg += "        - path: rtsp://wyze-bridge:8554/$c`n          roles:`n            - record`n            - detect`n"
}
New-Item -ItemType Directory -Force -Path frigate-config | Out-Null
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'frigate-config\config.yml'), $cfg, (New-Object System.Text.UTF8Encoding($false)))
docker compose up -d
if($LASTEXITCODE -ne 0){ Fallo 'No se pudo levantar el grabador' }

Start-Sleep 10
Start-Process 'http://localhost:5000'
Start-Process 'http://localhost:5001'
Write-Host ''
Write-Host '==================================================' -ForegroundColor Green
Write-Host '  LISTO. Se abrieron 2 paginas:' -ForegroundColor Green
Write-Host '   http://localhost:5000  ->  camaras EN VIVO (todas)'
Write-Host '   http://localhost:5001  ->  GRABACIONES 24/7 (linea de tiempo)'
Write-Host ''
Write-Host '  Y EN SABOR TICO APP (sabortico.app -> Camaras):' -ForegroundColor Green
Write-Host '  las camaras APARECEN SOLAS en ~2 minutos,' -ForegroundColor Green
Write-Host '  desde cualquier celular, sin instalar nada.' -ForegroundColor Green
Write-Host '=================================================='
Read-Host 'Enter para cerrar'
