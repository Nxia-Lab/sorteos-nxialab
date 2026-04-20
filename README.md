# Sorteo Pintureria

Web app en React + Vite + Tailwind + Firebase para registrar participaciones de sorteos por sucursal y ejecutar sorteos desde un panel administrativo.

## Puesta en marcha

1. Instalar dependencias con `npm install`
2. Copiar `.env.example` a `.env` y completar las credenciales de Firebase
3. Definir `VITE_ADMIN_PASSWORD` para proteger `/admin` con una clave simple
4. Ejecutar `npm run dev`

## Rutas

- `/` formulario de inscripcion, usando `?suc=nombre_sucursal`
- `/admin` panel administrativo

Si `VITE_ADMIN_PASSWORD` no se define, el panel usa `admin123` como respaldo temporal.

## Firestore

Colecciones esperadas:

- `participantes`
- `resultados`

Cada documento de `participantes` guarda `dni`, `nombre`, `telefono`, `sucursal` y `timestamp`.
