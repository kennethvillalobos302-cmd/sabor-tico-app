# ============================================================
#  Conecta tus camaras a Sabor Tico App (tunel seguro gratis)
#  Instala Tailscale, crea el tunel https y te da las
#  direcciones EXACTAS para pegar en la app.
# ============================================================
$Host.UI.RawUI.WindowTitle = 'Camaras Sabor Tico - Conectar a la app'
Set-Location $PSScriptRoot
function Fallo($msg){ Write-Host ''; Write-Host ('[X] ' + $msg) -ForegroundColor Red; Read-Host 'Enter para salir'; exit 1 }

Write-Host '== Paso 1 de 3: Tailscale (el candado del sistema)...' -ForegroundColor Cyan
tailscale version *> $null
if($LASTEXITCODE -ne 0){
  Write-Host '   Instalando Tailscale (acepta el permiso de Windows si pregunta)...'
  winget install -e --id Tailscale.Tailscale --accept-package-agreements --accept-source-agreements --silent
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  tailscale version *> $null
  if($LASTEXITCODE -ne 0){ Fallo 'No se pudo instalar Tailscale. Instalalo manual desde tailscale.com/download y volve a correr esto.' }
}

Write-Host '== Paso 2 de 3: Iniciando sesion (se abre el navegador)...' -ForegroundColor Cyan
Write-Host '   Si es la primera vez: entra con tu cuenta de Google y toca "Connect".'
tailscale up
if($LASTEXITCODE -ne 0){ Fallo 'No se pudo iniciar sesion en Tailscale' }

Write-Host '== Paso 3 de 3: Publicando las camaras de forma segura...' -ForegroundColor Cyan
tailscale serve --bg --https=443 http://127.0.0.1:8889 | Out-Null
tailscale serve --bg --https=8443 http://127.0.0.1:5001 | Out-Null
$st = tailscale status --json | ConvertFrom-Json
$dns = $st.Self.DNSName.TrimEnd('.')
$cams = @()
try{
  $api = Invoke-RestMethod -Uri 'http://localhost:5000/api' -TimeoutSec 5
  if($api.cameras){ $cams = @($api.cameras.PSObject.Properties | ForEach-Object { $_.Name }) }
}catch{}

Write-Host ''
Write-Host '==================================================' -ForegroundColor Green
Write-Host '  LISTO. PEGA ESTO EN SABOR TICO APP (Camaras -> Agregar camara):' -ForegroundColor Green
Write-Host ''
if($cams.Count -gt 0){
  foreach($c in $cams){ Write-Host ("   " + $c + "  ->  https://" + $dns + "/" + $c + "/") }
} else {
  Write-Host ('   (corre primero PROBAR.bat)  ->  https://' + $dns + '/NOMBRE-DE-CAMARA/')
}
Write-Host ("   URL de grabaciones  ->  https://" + $dns + ":8443")
Write-Host ''
Write-Host '  IMPORTANTE: en tu celular instala la app "Tailscale"'
Write-Host '  (gratis, App Store/Play Store) y entra con la MISMA cuenta.'
Write-Host '  Ese es el candado: solo tus dispositivos ven las camaras.'
Write-Host '=================================================='
Read-Host 'Enter para cerrar'
