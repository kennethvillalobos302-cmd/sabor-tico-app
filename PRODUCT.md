# Product

## Register

product

## Users

Personal de un restaurante en Costa Rica (Sabor Tico, 2 sucursales): saloneros, cocina, chef, jefe de salón, proveeduría, contabilidad y gerencia. La mayoría usa la app **en el celular** (iPhone y Android, a menudo agregada a la pantalla de inicio como PWA), de pie, en medio del servicio, con una mano. Gerencia y contabilidad también la usan en computadora/tablet para revisar reportes, horarios y caja. Idioma: español costarricense, voseo ("tocá", "escribí").

## Product Purpose

App interna de gestión total del restaurante: tareas (estilo Asana), pedidos, inventario, reservas, horarios, caja (control cruzado anti-fraude), mensajes internos (estilo WhatsApp), proyectos, reportes y auditoría. Sustituye WhatsApp + papel + Excel. El éxito es que el equipo la use a diario sin fricción y que gerencia tenga control y trazabilidad (anti-fraude, bitácoras inmutables).

## Brand Personality

Cálida, confiable, trabajadora. Paleta vino/burgundy (#8f2438) con neutros tibios; tema oscuro y claro. Tono directo y cercano en voseo, sin tecnicismos: el equipo no es técnico.

## Anti-references

- NO SaaS genérico frío (azules corporativos, dashboards con gradientes).
- NO interfaces densas de escritorio apretadas en el celular: cada vista debe repensarse para touch.
- El chat NO debe sentirse como un formulario web: la referencia explícita del dueño es **"mejor que WhatsApp"**.
- Nada de zoom accidental en iOS (inputs siempre ≥16px), nada de botones diminutos.

## Design Principles

1. **El celular es la pantalla principal**: todo (menús, popups, PIN, tablas, chat) debe encajar y operarse con el pulgar; hojas desde abajo en vez de modales centrados.
2. **Familiaridad ganada**: patrones que el equipo ya conoce (WhatsApp para mensajes, Asana para tareas); no inventar affordances.
3. **Trazabilidad visible**: quién hizo qué y cuándo, siempre a un toque (bitácoras, historial, auditoría).
4. **Un solo vocabulario visual**: mismos botones, chips, pills y campos en todas las vistas; la variedad está en el contenido, no en los controles.
5. **Registrar rápido gana**: cada flujo frecuente (tarea, mensaje, movimiento de caja/inventario) debe completarse en segundos, con valores por defecto sensatos.

## Accessibility & Inclusion

Personal no técnico y de edades variadas: tipografía generosa (cuerpo ≥13.5px, inputs 16px), áreas táctiles ≥44px, alto contraste en ambos temas, `prefers-reduced-motion` respetado, textos de estado claros en español. Debe funcionar bien en gama baja y conexiones lentas (sin librerías pesadas).
