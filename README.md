# 🐇 La Madriguera · Caja, costos y ventas

Aplicación web para administrar el café bar: cierre de caja diario con reparto automático a bolsillos, egresos, flujo de caja, costeo de productos con margen objetivo, inventario en onzas y unidades, lectura de facturas electrónicas de la DIAN y analítica de los productos más vendidos.

- **Backend:** Django 5 + Django REST Framework, autenticación con JWT, PostgreSQL (SQLite en desarrollo).
- **Frontend:** React 18 + Vite, Recharts para las gráficas.
- **Despliegue:** una sola imagen Docker sirve la API y la app en la misma URL.

## Qué hace

| Sección | Para qué sirve |
|---|---|
| Cierre del día | Se escribe lo que entró por Bold y el efectivo en caja. Calcula cuánto dejar en caja para vueltas (15% del efectivo, configurable), cuánto transferir, el ingreso a la cuenta, lo que va a cada bolsillo y lo que queda disponible. Guarda los porcentajes del día para que el histórico no cambie si después se modifican. |
| Egresos | Lo que sale de la caja, de la cuenta o de un bolsillo, con categoría y para qué. |
| Ventas por producto | Unidades vendidas de cada producto, a mano o importando un CSV. Descuenta el inventario según la receta. |
| Flujo de caja | Ingresos contra egresos por día, acumulado del mes, egresos por categoría, saldos de caja, cuenta y cada bolsillo, e histórico mensual. |
| Productos más vendidos | Top por unidades, ventas, utilidad o margen; resultados por categoría y por día. |
| Metas y rendimiento | Meta mensual y diaria, si el bolsillo de arriendo alcanza y cuánto rinden los bolsillos en 12 meses. |
| Carta y costeo | Cada producto con lo que lleva (licores en onzas, fruta, servilleta, pincho, envío…). Calcula el costo, el precio sugerido para el margen que quieras y el margen real con el precio de la carta. |
| Insumos e inventario | Costo por onza o por unidad a partir de la presentación (ej. botella de 750 ml a $80.000), stock, alertas de compra y conteos físicos. |
| Facturas | Lee el .zip o .xml de la factura electrónica, recuerda cómo se llama cada producto del proveedor, actualiza costos (promedio ponderado) e inventario, y puede registrar el pago como egreso. También se pueden registrar a mano. |
| Configuración y usuarios | Solo administradores: meta, días abiertos, arriendo, % de caja, tasa de los bolsillos, margen objetivo, ml por onza, redondeo de precios, bolsillos y usuarios. |

### Roles

- **Administrador:** todo, incluido cambiar configuración, costos y precios, gestionar usuarios y borrar registros.
- **Colaborador:** registra cierres, egresos y ventas, y consulta todos los reportes. Puede corregir un cierre que él mismo registró.

### Cómo se calcula el precio

El margen bruto se mide sobre el precio de venta: `precio = costo ÷ (1 − margen)`. Con 40%, una cerveza que cuesta $2.500 + $150 de servilleta + $600 de envío = **$3.250** se debe vender en **$5.417**, que se redondea a **$5.500** (el redondeo se configura). Ojo: 40% de margen no es lo mismo que sumarle 40% al costo (eso daría $4.550 y un margen real de solo 28,6%).

Los licores se cuentan en onzas. Por defecto 1 oz = 30 ml (se cambia en Configuración a 29,57 si prefieres la onza exacta). Una botella de 750 ml son 25 oz.

## Trabajar en tu computador

Necesitas Python 3.12 y Node 20.

```bash
# Backend
cd backend
python -m venv .venv
source .venv/bin/activate        # En Windows: .venv\Scripts\activate
pip install -r requirements.txt
export DEBUG=true                # En Windows (PowerShell): $env:DEBUG="true"
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver

# Frontend (en otra terminal)
cd frontend
npm install
npm run dev
```

Abre http://localhost:5173. Vite le pasa las llamadas `/api` al backend en el puerto 8000.

Pruebas del backend: `cd backend && DEBUG=true python manage.py test`.

## Correrlo con Docker

```bash
cp .env.example .env     # y cambia las claves
docker compose up --build
```

Queda en http://localhost:8000 con PostgreSQL. El primer administrador se crea solo con `ADMIN_USERNAME` y `ADMIN_PASSWORD` del `.env`.

## Publicarlo para entrar desde cualquier lugar

### 1. Subirlo a GitHub

```bash
cd madriguera
git init
git add .
git commit -m "La Madriguera: caja, costos y ventas"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/madriguera.git
git push -u origin main
```

Crea el repositorio como **privado**: tiene la lógica de tu negocio. El archivo `.env` nunca se sube (está en `.gitignore`).

### 2. Desplegar en Render

1. Entra a [render.com](https://render.com) con tu cuenta de GitHub.
2. **New → Blueprint** y elige el repositorio. Render lee `render.yaml` y crea la app y la base de datos.
3. Cuando te pida `ADMIN_USERNAME` y `ADMIN_PASSWORD`, escribe el usuario y la contraseña del primer administrador.
4. Al terminar, la app queda en `https://madriguera-XXXX.onrender.com`. Desde ahí creas los usuarios de los demás en **Usuarios**.

Revisa las condiciones del plan gratis antes de depender de él: en Render los servicios gratis se duermen cuando no se usan (la primera carga tarda unos segundos) y las bases de datos gratis tienen límites de tiempo. Para uso diario del negocio conviene el plan pago más pequeño de la base de datos, o usar una base PostgreSQL de otro proveedor (Neon, Supabase) poniendo su URL en `DATABASE_URL`.

Funciona igual en cualquier servicio que corra Docker (Railway, Fly.io, un VPS) con estas variables: `DATABASE_URL`, `SECRET_KEY`, `DEBUG=false`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`.

### Copias de seguridad

Toda la información vive en PostgreSQL. Haz copias con `pg_dump "$DATABASE_URL" > respaldo.sql` o activa los respaldos automáticos de tu proveedor. Los archivos de facturas subidas se guardan en `media/`; en Render sin disco persistente se pierden al reiniciar, pero los datos ya leídos quedan en la base.

## Detalles útiles

- **Facturas:** se leen el .zip que llega al correo, el AttachedDocument .xml o el Invoice .xml (UBL 2.1 de la DIAN). El PDF solo es la representación gráfica y no trae los datos en un formato legible; para esas, usa la factura manual. Una factura con el mismo NIT y número no se puede cargar dos veces.
- **Importar ventas en CSV:** columnas `producto,cantidad` y opcionales `precio,fecha` (AAAA-MM-DD). Separador coma o punto y coma. Los nombres deben coincidir con la carta.
- **Inventario:** entra con las facturas aplicadas y el stock inicial; sale con las ventas por producto; los conteos físicos guardan la diferencia como ajuste.
- **Bolsillos:** la app no se conecta con el banco ni con Bold. Mantén en Configuración los mismos porcentajes que tienes en la app del banco.
- **Panel de Django:** `/admin/` para ver o corregir cualquier dato directamente (solo superusuarios).

## API

Todas las rutas están bajo `/api/` y piden `Authorization: Bearer <token>` (se obtiene en `POST /api/auth/login/`).

| Ruta | Uso |
|---|---|
| `yo/`, `yo/password/`, `usuarios/` | Sesión, cambio de contraseña y usuarios (admin) |
| `configuracion/`, `bolsillos/` | Parámetros del negocio |
| `cierres/`, `egresos/` | Registro diario (`?desde=&hasta=` en AAAA-MM-DD) |
| `reportes/flujo/`, `reportes/saldos/`, `reportes/historico/`, `reportes/proyeccion/` | Reportes |
| `insumos/`, `insumos/{id}/ajustar/`, `movimientos/` | Inventario |
| `productos/`, `productos/{id}/usar_precio_sugerido/` | Carta y costeo |
| `facturas/`, `facturas/leer/`, `facturas/{id}/aplicar/` | Facturas |
| `ventas-producto/`, `ventas-producto/importar/`, `analitica/productos/` | Ventas y analítica |
