# Guía: Sistema de cámaras Wyze v3/v4 gratis (24/7, sin suscripción)

> **⚡ CAMINO FÁCIL (recomendado):** usá la **instalación automática** de la carpeta [`docs/instalador/`](instalador/) — son 3 dobles-clic siguiendo su `LEEME.txt`, y detecta tus cámaras sola. Esta guía manual queda como referencia detallada (usa `C:\camaras` como ejemplo de carpeta, pero sirve cualquiera).

Sistema completo tipo DVR profesional con tus Wyze Cam v3 o v4: **ver en vivo (todas o una por una) dentro de Sabor Tico App, grabación 24/7 en disco, retroceder a cualquier momento, y detección de personas** — pagando **₡0 al mes**.

**Qué se ocupa (una sola vez):**
- Una computadora con Windows 10/11 que quede **encendida 24/7** (una vieja sirve; que tenga 8 GB de RAM ideal).
- Un disco de **1 TB** para las grabaciones (~2 a 4 semanas de 3–4 cámaras; lo viejo se borra solo).
- Recomendado: una **microSD** dentro de cada cámara como respaldo (graban solas aunque apaguen la compu).
- Las cámaras y la compu en el **mismo internet** del restaurante.

**Tiempo:** ~40 minutos, una sola vez. Todo es copiar y pegar.

---

## Paso 1 — Llave de acceso de Wyze (5 min)

El puente necesita una "llave" de tu cuenta Wyze (es gratis):

1. Entrá a **https://developer-api-console.wyze.com/#/apikey/view** e iniciá sesión con tu cuenta de Wyze.
2. Tocá **Create API Key**, ponele un nombre (ej: `sabortico`).
3. Anotá el **API Key ID** y el **API Key** (guardalos, se usan en el Paso 3). **No los compartás con nadie.**

## Paso 2 — Instalar los programas (10 min)

En la computadora del restaurante:

1. Instalá **Docker Desktop**: https://www.docker.com/products/docker-desktop/ → botón Windows → instalar → reiniciar si lo pide → abrirlo una vez (si pregunta por WSL2, aceptá todo).
2. Instalá **Tailscale** (el túnel seguro gratis): https://tailscale.com/download/windows → instalá → iniciá sesión con una cuenta Google (creá una para el restaurante). **Instalá también la app de Tailscale en tu celular** con la MISMA cuenta.

## Paso 3 — Configurar el puente y el grabador (10 min)

1. Creá la carpeta `C:\camaras` y adentro otra llamada `frigate-config`.
2. En `C:\camaras`, creá un archivo llamado **`docker-compose.yml`** (con el Bloc de notas) y pegá esto, **cambiando lo que está en MAYÚSCULAS**:

```yaml
services:
  wyze-bridge:
    container_name: wyze-bridge
    image: mrlt8/wyze-bridge:latest
    restart: unless-stopped
    ports:
      - 8554:8554
      - 8888:8888
      - 8889:8889
      - 8189:8189/udp
      - 5000:5000
    environment:
      - WYZE_EMAIL=TU_CORREO_DE_WYZE
      - WYZE_PASSWORD=TU_CLAVE_DE_WYZE
      - API_ID=EL_API_KEY_ID_DEL_PASO_1
      - API_KEY=EL_API_KEY_DEL_PASO_1
      - WB_IP=IP_DE_ESTA_COMPU
      - SUBSTREAM=True
      - TZ=America/Costa_Rica

  frigate:
    container_name: frigate
    image: ghcr.io/blakeblackshear/frigate:stable
    restart: unless-stopped
    shm_size: "256mb"
    ports:
      - 8971:8971
    volumes:
      - ./frigate-config:/config
      - D:/grabaciones:/media/frigate
    environment:
      - TZ=America/Costa_Rica
```

> - `IP_DE_ESTA_COMPU`: abrí el símbolo del sistema (cmd) y escribí `ipconfig` — es la "Dirección IPv4" (ej: `192.168.1.50`).
> - `D:/grabaciones`: la carpeta del disco de 1 TB (creala). Si el disco es C:, poné `C:/grabaciones`.

3. En `C:\camaras\frigate-config`, creá el archivo **`config.yml`** y pegá esto (una sección por cámara — el nombre es el apodo de la cámara en la app de Wyze, en minúsculas y con guiones en vez de espacios: "Comedor Principal" → `comedor-principal`):

```yaml
mqtt:
  enabled: false

cameras:
  comedor:
    ffmpeg:
      inputs:
        - path: rtsp://IP_DE_ESTA_COMPU:8554/comedor
          roles: [record]
        - path: rtsp://IP_DE_ESTA_COMPU:8554/comedor-sub
          roles: [detect]

  cocina:
    ffmpeg:
      inputs:
        - path: rtsp://IP_DE_ESTA_COMPU:8554/cocina
          roles: [record]
        - path: rtsp://IP_DE_ESTA_COMPU:8554/cocina-sub
          roles: [detect]

record:
  enabled: true
  retain:
    days: 15
    mode: all

objects:
  track:
    - person

detect:
  enabled: true
```

4. Abrí el símbolo del sistema (cmd), y ejecutá:

```
cd C:\camaras
docker compose up -d
```

La primera vez tarda unos minutos (descarga los programas). Para verificar:
- **http://localhost:5000** → panel del puente: deben aparecer tus cámaras con imagen.
- **http://localhost:8971** → Frigate (el grabador): la primera vez muestra el usuario y clave en los "logs" (en Docker Desktop → frigate → Logs, buscá "Password"). Entrá y cambiala.

## Paso 4 — Verlas desde cualquier lado (5 min)

En el cmd de la computadora:

```
tailscale serve --bg --https=443 http://localhost:8889
tailscale serve --bg --https=8443 http://localhost:8971
```

Eso te da una dirección segura del estilo `https://NOMBRE-PC.tu-red.ts.net` (la ves con `tailscale serve status`):
- `https://NOMBRE-PC.tu-red.ts.net/comedor/` → cámara en vivo (así se conectan a Sabor Tico App).
- `https://NOMBRE-PC.tu-red.ts.net:8443` → Frigate: **grabaciones y línea de tiempo**.

> En el celular tenés que tener la app de **Tailscale encendida** (un toque) — ese es el candado: solo tus dispositivos pueden ver las cámaras.

## Paso 5 — Que nunca se apague (2 min)

1. Windows → Configuración → Sistema → Energía → **Suspender: Nunca** (pantalla puede apagarse, no importa).
2. Docker Desktop → Settings → General → ✅ **Start Docker Desktop when you sign in**.
3. Los contenedores ya arrancan solos (`restart: unless-stopped`).

## Paso 6 — Conectarlas a Sabor Tico App (2 min)

1. En Sabor Tico App (como Gerencia) → sección **Cámaras** → **Agregar cámara**.
2. Nombre: `Comedor` · Dirección: `https://NOMBRE-PC.tu-red.ts.net/comedor/`
3. Repetí por cada cámara. En **"URL de grabaciones"** pegá `https://NOMBRE-PC.tu-red.ts.net:8443`.

Listo: mosaico en vivo, una por una, y botón directo a las grabaciones.

---

## Problemas comunes

| Síntoma | Solución |
|---|---|
| El puente no ve las cámaras | Revisá correo/clave/API Key en `docker-compose.yml`; las cámaras deben estar en línea en la app de Wyze |
| Se ve en la compu pero no en el celular | Encendé la app de Tailscale en el celular (misma cuenta) |
| La cámara se llama distinto | El nombre es el apodo de Wyze en minúsculas con guiones (mirá la lista en http://localhost:5000) |
| Cambió algo tras actualizar Wyze | Actualizá el puente: `cd C:\camaras` → `docker compose pull` → `docker compose up -d` |

**Nota honesta:** el puente (wyze-bridge) es un proyecto comunitario, no oficial de Wyze. Funciona muy bien y se mantiene activo, pero si Wyze cambia algo puede caerse unos días hasta que actualicen. El respaldo de microSD dentro de cada cámara no depende de nada de esto.
