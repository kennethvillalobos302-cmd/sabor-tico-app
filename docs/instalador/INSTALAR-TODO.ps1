# ============================================================
#  INSTALACION AUTOMATICA COMPLETA - Camaras Sabor Tico
#  UN solo script: arregla WSL, instala Docker, pide tus datos
#  de Wyze y deja el sistema corriendo. Pensado para Wyze v3/v4.
# ============================================================
$Host.UI.RawUI.WindowTitle = 'Camaras Sabor Tico - Instalacion automatica'
Set-Location $PSScriptRoot
function Titulo($t){ Write-Host ''; Write-Host ('== ' + $t) -ForegroundColor Cyan }
function Fallo($m){ Write-Host ''; Write-Host ('[X] ' + $m) -ForegroundColor Red; Read-Host 'Enter para salir'; exit 1 }

Write-Host '=============================================='
Write-Host '  CAMARAS WYZE SIN SUSCRIPCION - INSTALADOR'
Write-Host '  (hace todo solo; responde lo que pregunte)'
Write-Host '=============================================='

# ---------- 1. WSL moderno (el motor que usa Docker) ----------
Titulo 'Paso 1: Revisando WSL...'
wsl --version *> $null
if($LASTEXITCODE -ne 0){
  Write-Host '   Falta el WSL moderno. Se instala ahora: acepta el permiso de Windows (Si).'
  try{ Start-Process wsl.exe -ArgumentList '--install','--no-distribution','--web-download' -Verb RunAs -Wait }
  catch{ Fallo 'No se acepto el permiso de administrador. Corre INSTALAR-TODO.bat de nuevo.' }
  Write-Host ''
  Write-Host '  >>> LISTO. Ahora REINICIA LA COMPUTADORA y vuelve a dar <<<' -ForegroundColor Yellow
  Write-Host '  >>> doble clic a INSTALAR-TODO.bat para continuar.      <<<' -ForegroundColor Yellow
  Read-Host 'Enter para salir'; exit 0
}
Write-Host '   WSL OK' -ForegroundColor Green

# ---------- 2. Docker Desktop ----------
Titulo 'Paso 2: Revisando Docker...'
$dockerExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
if(-not (Test-Path $dockerExe)){
  $inst = Join-Path $PSScriptRoot 'Docker-Desktop-Installer.exe'
  if(-not (Test-Path $inst)){
    Write-Host '   Descargando Docker Desktop (~630 MB, paciencia)...'
    curl.exe -L -o $inst 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe'
    if(-not (Test-Path $inst)){ Fallo 'No se pudo descargar Docker. Revisa el internet y proba de nuevo.' }
  }
  Write-Host '   Instalando Docker (acepta el permiso de Windows; tarda varios minutos)...'
  try{ Start-Process $inst -ArgumentList 'install','--quiet','--accept-license','--backend=wsl-2' -Verb RunAs -Wait }
  catch{ Fallo 'No se acepto el permiso de administrador. Corre INSTALAR-TODO.bat de nuevo.' }
  if(-not (Test-Path $dockerExe)){ Fallo 'Docker no quedo instalado. Corre INSTALAR-TODO.bat de nuevo.' }
  Write-Host '   Docker instalado' -ForegroundColor Green
} else {
  Write-Host '   Docker OK' -ForegroundColor Green
}

# ---------- 3. Tus datos de Wyze (sin Bloc de notas) ----------
Titulo 'Paso 3: Tus datos de Wyze...'
$envPath = Join-Path $PSScriptRoot '.env'
$raw = ''
if(Test-Path $envPath){ $raw = Get-Content $envPath -Raw }
if($raw -match 'pegar-aqui' -or $raw -match 'ejemplo\.com' -or $raw.Trim() -eq ''){
  Write-Host '   Se abre la pagina de Wyze para crear tu llave GRATIS:'
  Write-Host '   inicia sesion -> "Create API Key" -> nombre: sabortico'
  Start-Process 'https://developer-api-console.wyze.com/#/apikey/view'
  Write-Host ''
  $em = Read-Host '   Tu correo de Wyze'
  $pwS = Read-Host '   Tu clave de Wyze (no se ve al escribir)' -AsSecureString
  $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pwS))
  $id = Read-Host '   API Key ID (copiala de la pagina)'
  $ky = Read-Host '   API Key (copiala de la pagina)'
  if(-not $em -or -not $pw -or -not $id -or -not $ky){ Fallo 'Falto algun dato. Corre INSTALAR-TODO.bat de nuevo.' }
  $out = "WYZE_EMAIL=$em`nWYZE_PASSWORD=$pw`nAPI_ID=$id`nAPI_KEY=$ky`n"
  [IO.File]::WriteAllText($envPath, $out, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host '   Datos guardados (quedan SOLO en esta compu)' -ForegroundColor Green
} else {
  Write-Host '   Datos OK (.env ya esta lleno)' -ForegroundColor Green
}

# ---------- 4. Levantar todo (puente + grabador) ----------
Titulo 'Paso 4: Levantando el sistema...'
& (Join-Path $PSScriptRoot 'INSTALAR.ps1')
