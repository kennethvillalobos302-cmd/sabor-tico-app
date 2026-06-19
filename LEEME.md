# Sabor Tico App

Plataforma de gestión integral del restaurante. Funciona en **celular y computadora**, sin internet ni instalación: todo se guarda en el dispositivo.

## Cómo abrirla

Abrí el archivo **`index.html`** con doble clic (se abre en tu navegador). En el celular, copiá la carpeta y abrí `index.html` desde el navegador.

## Cómo entrar

Elegí tu nombre y poné el PIN. Para esta versión de prueba **todos los PIN son `1234`** (los cambiás luego en Equipo).

Usuarios de ejemplo (editables):
- **Kenneth Villalobos** — Administración / Gerencia (ve y controla todo)
- Marco Jiménez — Chef · Josué Soto / Carla Méndez — Jefe de Salón
- Lucía Ramírez — Cocina · Jafet Mora / Bryan Castro — Saloneros
- Diego Vargas — Proveeduría · Sofía Núñez — Contabilidad · Andrea Rojas — RRHH

## Qué hace

- **Tareas** entre puestos con notas, imágenes, prioridad y fecha. Cada cambio queda registrado: se sabe quién cumple y quién no (atrasadas/rechazadas). No se pueden borrar tareas ni su historial.
- **Pedidos** internos a Proveeduría, Contabilidad o RRHH, con seguimiento del proceso (pendiente → en proceso → entregado) y registro de responsables.
- **Proyectos** (ej: Remodelación) con miembros y una **pizarra** de notas e imágenes.
- **Mensajes**: chats directos y grupos. Los grupos solo los crea Administración. Gerencia ve todos los chats (control total).
- **Notificaciones** con contador en la campana.
- **Equipo** (solo admin): crear/editar usuarios, puestos y **dos o más sucursales**.
- **Movimientos** (solo admin): registro de auditoría anti-fraude de todo lo que pasa.

## Cada puesto tiene su propio menú

La app muestra a cada persona solo lo que necesita:

- **Gerencia (Kenneth):** todo + **Reportes** (cumplimiento por puesto, pedidos por área, valor de inventario, actividad por sucursal) + Equipo + Movimientos.
- **Proveeduría:** **Inventario** completo (alta de productos, entradas y salidas, alertas de stock bajo) + pedidos a su área.
- **Chef:** Recetas/Menú, ver inventario, asignar tareas a cocina, pedir insumos.
- **Cocina:** sus tareas, recetas del día, ver inventario, pedir insumos.
- **Jefe de Salón:** asignar a saloneros, Horarios, pedidos del salón.
- **Salonero:** sus tareas y su horario.
- **Contabilidad:** Reportes, valor del inventario, solicitudes.
- **RRHH:** **Personal** (directorio del equipo) y solicitudes (permisos, adelantos, vacaciones), Horarios.

## Inventario conectado a los pedidos

Cuando alguien hace un pedido a Proveeduría puede **ligarlo a un producto del inventario**. Al marcarlo **Entregado**, el stock se **descuenta solo** y queda el movimiento registrado. Lo mismo pasa al **preparar una receta**: descuenta los ingredientes. Si algo baja del mínimo, salta una alerta de stock bajo.

## Novedades de esta versión

- **Sin emojis:** toda la interfaz usa iconos de línea limpios y consistentes.
- **Puestos nuevos:** Gerencia de Experiencia, Gerencia de Estadística y Diseño, y Bartender (con su propio menú y permisos).
- **Sucursales editables:** desde Equipo podés renombrar cada sucursal.
- **Equipo ordenado:** las personas se agrupan por sucursal y se ordenan por puesto.
- **Horarios fáciles:** asignás un turno con horarios rápidos (Mañana, Día, Tarde, Partido) y agregás los **quiebres/descansos** que quieras. Cada persona recibe un **aviso el día anterior** con su turno del día siguiente, y en **Inicio** ve si hoy trabaja (con horas y quiebres) o está libre.
- **Pizarra de proyectos más funcional:** tablero grande tipo pizarra; las tarjetas (notas e imágenes) se **arrastran para ordenar**, se pueden **editar** y pintar de color. Todo queda guardado ahí.
- **Inventario dividido en Cocina y Bar:** la bodega de **Cocina** la manejan Proveeduría y Chef; la de **Bar**, Bartender y Jefe de Salón. Cada quien ve y edita solo su área; Gerencia y Contabilidad ven ambas con pestañas para cambiar entre Cocina y Bar. Al elegir el área (Bar/Cocina) las **categorías cambian** a las de esa bodega, y son **personalizables** desde el botón "Categorías…" (agregar o quitar categorías de Cocina y de Bar por separado).
- **Chat con fotos y video:** adjuntá imágenes o videos a los mensajes (botón del clip).
- **Pop-ups mejorados:** todos los formularios y menús emergentes con mejor diseño UI/UX.

## Respaldos

En el menú de tu usuario (arriba a la derecha): **Respaldar datos** descarga todo en un archivo; **Restaurar respaldo** lo vuelve a cargar. Útil para pasar la información de un dispositivo a otro.

> Esta versión guarda los datos en cada dispositivo por separado. Cuando quieras que todos los celulares se sincronicen en tiempo real, se migra a la nube (requiere un servidor).
