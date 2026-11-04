import csv
import io
from datetime import date

from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from cuentas.models import es_admin
from cuentas.permissions import EsAdmin, LecturaOAdmin, RegistroColaborador
from finanzas.models import Categoria, Configuracion, Egreso
from finanzas.views import _categorias

from . import services
from . import ia
from .factura_parser import FacturaInvalida, leer_factura
from .pdf import leer_factura_pdf
from .models import Factura, FacturaItem, Insumo, MovimientoInventario, Producto, VentaProducto
from .serializers import (
    FacturaSerializer, InsumoCrearSerializer, InsumoSerializer, LoteVentasSerializer, MovimientoSerializer,
    ProductoSerializer, VentaProductoSerializer,
)
from .unidades import UNIDADES

MAX_ARCHIVO = 8 * 1024 * 1024


def _fecha(request, nombre):
    try:
        return date.fromisoformat(request.query_params.get(nombre, ""))
    except ValueError:
        return None


class InsumoViewSet(viewsets.ModelViewSet):
    permission_classes = [LecturaOAdmin]

    def get_serializer_class(self):
        return InsumoCrearSerializer if self.action == "create" else InsumoSerializer

    def get_queryset(self):
        qs = Insumo.objects.all()
        if self.request.query_params.get("activos") == "1":
            qs = qs.filter(activo=True)
        if cat := self.request.query_params.get("categoria"):
            qs = qs.filter(categoria=cat)
        return qs

    def destroy(self, request, *args, **kwargs):
        insumo = self.get_object()
        if insumo.en_recetas.exists() or insumo.movimientos.exists():
            insumo.activo = False
            insumo.save(update_fields=["activo"])
            return Response({"detail": "El insumo tiene historial; se desactivó en lugar de borrarse."})
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], permission_classes=[EsAdmin])
    def ajustar(self, request, pk=None):
        try:
            stock_real = float(request.data.get("stock_real"))
        except (TypeError, ValueError):
            return Response({"stock_real": "Escribe cuánto hay realmente."}, status=400)
        try:
            fecha = date.fromisoformat(request.data.get("fecha") or "") if request.data.get("fecha") else None
        except ValueError:
            return Response({"fecha": "La fecha no es válida."}, status=400)
        insumo = services.ajustar_stock(self.get_object(), str(stock_real), request.data.get("nota", ""), request.user, fecha=fecha)
        return Response(InsumoSerializer(insumo).data)

    @action(detail=False, methods=["post"], permission_classes=[EsAdmin], parser_classes=[MultiPartParser, FormParser])
    def importar(self, request):
        """Lee un inventario (CSV, Excel o PDF) y devuelve las filas para revisar antes de aplicarlas."""
        from finanzas.tabla import ArchivoInvalido, leer_tabla

        from . import inventario

        archivo = request.FILES.get("archivo")
        if not archivo:
            return Response({"detail": "Adjunta el archivo del inventario."}, status=400)
        contenido = archivo.read()
        try:
            if archivo.name.lower().endswith(".pdf") or contenido[:4] == b"%PDF":
                if not ia.disponible():
                    return Response({"detail": "Para leer inventarios en PDF hay que activar la lectura con IA (ANTHROPIC_API_KEY). "
                                               "Mientras tanto, usa la plantilla en Excel o CSV."}, status=400)
                items = inventario.desde_pdf(contenido)
            else:
                items = inventario.desde_tabla(*leer_tabla(contenido, archivo.name))
        except (ArchivoInvalido, ValueError, ia.IANoDisponible) as e:
            return Response({"detail": str(e)}, status=400)
        if not items:
            return Response({"detail": "No encontramos productos en el archivo."}, status=400)
        return Response({"items": inventario.emparejar(items)})

    @action(detail=False, methods=["post"], permission_classes=[EsAdmin], url_path="importar/aplicar")
    def importar_aplicar(self, request):
        from . import inventario

        try:
            fecha = date.fromisoformat(request.data.get("fecha") or "")
        except ValueError:
            return Response({"detail": "Elige la fecha del inventario."}, status=400)
        items = [i for i in (request.data.get("items") or []) if str(i.get("nombre") or "").strip()]
        if not items:
            return Response({"detail": "No hay productos para cargar."}, status=400)
        return Response(inventario.aplicar(items, fecha, request.user, request.data.get("actualizar_costos", True) is not False), status=201)


class ProductoViewSet(viewsets.ModelViewSet):
    serializer_class = ProductoSerializer
    permission_classes = [LecturaOAdmin]

    def get_queryset(self):
        qs = Producto.objects.prefetch_related("receta__insumo")
        if self.request.query_params.get("activos") == "1":
            qs = qs.filter(activo=True)
        return qs

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["cfg"] = Configuracion.actual()
        return ctx

    def destroy(self, request, *args, **kwargs):
        p = self.get_object()
        if p.ventas.exists():
            p.activo = False
            p.save(update_fields=["activo"])
            return Response({"detail": "El producto tiene ventas; se desactivó en lugar de borrarse."})
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], permission_classes=[EsAdmin])
    def usar_precio_sugerido(self, request, pk=None):
        p = self.get_object()
        p.precio_venta = services.costeo_producto(p)["precio_sugerido"]
        p.save(update_fields=["precio_venta", "actualizado"])
        return Response(self.get_serializer(p).data)


class FacturaViewSet(viewsets.ModelViewSet):
    serializer_class = FacturaSerializer
    permission_classes = [LecturaOAdmin]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        qs = Factura.objects.prefetch_related("items__insumo", "egresos")
        if estado := self.request.query_params.get("estado"):
            qs = qs.filter(estado=estado)
        return qs

    def perform_create(self, serializer):
        serializer.save(creado_por=self.request.user)

    def destroy(self, request, *args, **kwargs):
        if self.get_object().estado == Factura.APLICADA:
            return Response({"detail": "La factura ya se aplicó al inventario y no se puede borrar."}, status=400)
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["post"], permission_classes=[EsAdmin])
    def leer(self, request):
        archivo = request.FILES.get("archivo")
        if not archivo:
            return Response({"detail": "Adjunta el .zip, .xml o .pdf de la factura."}, status=400)
        if archivo.size > MAX_ARCHIVO:
            return Response({"detail": "El archivo pesa más de 8 MB."}, status=400)
        contenido = archivo.read()
        metodo = "xml"
        try:
            if archivo.name.lower().endswith(".pdf") or contenido[:4] == b"%PDF":
                datos, metodo = leer_factura_pdf(contenido)
            else:
                datos = leer_factura(contenido, archivo.name)
        except (FacturaInvalida, ia.IANoDisponible) as e:
            return Response({"detail": str(e)}, status=400)
        if datos["nit"] and datos["numero"]:
            previa = Factura.objects.filter(nit=datos["nit"], numero=datos["numero"]).first()
            if previa:
                return Response({"detail": f"La factura {datos['numero']} de {datos['proveedor']} ya está cargada.", "id": previa.id}, status=409)
        archivo.seek(0)
        items = datos.pop("items")
        factura = Factura.objects.create(tipo=Factura.ELECTRONICA, creado_por=request.user, archivo=archivo, **datos)
        FacturaItem.objects.bulk_create([FacturaItem(factura=factura, **i) for i in items])
        services.sugerir_alias(factura)
        if metodo != "xml":
            factura.tipo = Factura.MANUAL
            factura.save(update_fields=["tipo"])
        return Response({**self.get_serializer(factura).data, "metodo_lectura": metodo}, status=201)

    @action(detail=True, methods=["post"], permission_classes=[EsAdmin])
    def aplicar(self, request, pk=None):
        egreso = request.data.get("registrar_egreso")
        if egreso:
            if egreso.get("origen") not in dict(Egreso.ORIGENES):
                return Response({"detail": "Elige de dónde salió el pago."}, status=400)
            if egreso.get("origen") == Egreso.BOLSILLO and not egreso.get("bolsillo"):
                return Response({"detail": "Elige de qué bolsillo salió el pago."}, status=400)
        try:
            factura = services.aplicar_factura(self.get_object(), request.user, egreso)
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(self.get_serializer(factura).data)


class VentaProductoViewSet(viewsets.ModelViewSet):
    serializer_class = VentaProductoSerializer
    permission_classes = [RegistroColaborador]
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def update(self, request, *args, **kwargs):
        """Editar una venta: se devuelve al inventario lo que descontó y se registra de nuevo con los datos corregidos."""
        if not es_admin(request.user):
            return Response({"detail": "Solo los administradores pueden editar ventas."}, status=403)
        venta = self.get_object()
        try:
            cantidad = int(request.data.get("cantidad", venta.cantidad))
            fecha = date.fromisoformat(request.data["fecha"]) if request.data.get("fecha") else venta.fecha
            precio = request.data.get("precio_unitario")
            precio = float(precio) if precio not in (None, "") else float(venta.precio_unitario)
        except (TypeError, ValueError):
            return Response({"detail": "Revisa la cantidad, el precio o la fecha."}, status=400)
        if cantidad < 1 or precio < 0:
            return Response({"detail": "La cantidad debe ser al menos 1 y el precio no puede ser negativo."}, status=400)
        producto = venta.producto
        from django.db import transaction
        from decimal import Decimal

        with transaction.atomic():
            services.borrar_venta(venta)
            nueva = services.registrar_ventas(fecha, [(producto, cantidad, Decimal(str(precio)))], request.user)[0]
        return Response(VentaProductoSerializer(nueva).data)

    def get_queryset(self):
        qs = VentaProducto.objects.select_related("producto")
        if d := _fecha(self.request, "desde"):
            qs = qs.filter(fecha__gte=d)
        if h := _fecha(self.request, "hasta"):
            qs = qs.filter(fecha__lte=h)
        if f := _fecha(self.request, "fecha"):
            qs = qs.filter(fecha=f)
        return qs

    def create(self, request, *args, **kwargs):
        s = LoteVentasSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        items = [(i["producto"], i["cantidad"], i.get("precio")) for i in s.validated_data["items"]]
        ventas = services.registrar_ventas(s.validated_data["fecha"], items, request.user)
        return Response(VentaProductoSerializer(ventas, many=True).data, status=201)

    def destroy(self, request, *args, **kwargs):
        if not es_admin(request.user):
            return Response({"detail": "Solo los administradores pueden borrar ventas."}, status=403)
        services.borrar_venta(self.get_object())
        return Response(status=204)

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def importar(self, request):
        """CSV con columnas producto,cantidad y opcionales precio,fecha (AAAA-MM-DD)."""
        archivo = request.FILES.get("archivo")
        if not archivo:
            return Response({"detail": "Adjunta un archivo .csv."}, status=400)
        try:
            fecha_def = date.fromisoformat(request.data.get("fecha", ""))
        except ValueError:
            fecha_def = None
        texto = archivo.read().decode("utf-8-sig", errors="replace")
        muestra = texto[:2000]
        delim = ";" if muestra.count(";") > muestra.count(",") else ","
        lector = csv.DictReader(io.StringIO(texto), delimiter=delim)
        campos = {(c or "").strip().lower(): c for c in (lector.fieldnames or [])}
        if "producto" not in campos or "cantidad" not in campos:
            return Response({"detail": "El CSV necesita las columnas producto y cantidad."}, status=400)
        productos = {services.normalizar(p.nombre): p for p in Producto.objects.filter(activo=True)}
        por_fecha, errores = {}, []
        for n, fila in enumerate(lector, start=2):
            nombre = (fila.get(campos["producto"]) or "").strip()
            prod = productos.get(services.normalizar(nombre))
            try:
                cant = int(float((fila.get(campos["cantidad"]) or "0").replace(",", ".")))
            except ValueError:
                cant = 0
            f = fecha_def
            if "fecha" in campos and (fila.get(campos["fecha"]) or "").strip():
                try:
                    f = date.fromisoformat(fila[campos["fecha"]].strip())
                except ValueError:
                    f = None
            precio = None
            if "precio" in campos and (fila.get(campos["precio"]) or "").strip():
                try:
                    precio = float(fila[campos["precio"]].replace(".", "").replace(",", ".")) if "," in fila[campos["precio"]] else float(fila[campos["precio"]])
                except ValueError:
                    precio = None
            if not prod:
                errores.append(f"Fila {n}: no existe el producto «{nombre}».")
            elif cant <= 0:
                errores.append(f"Fila {n}: la cantidad no es válida.")
            elif not f:
                errores.append(f"Fila {n}: falta la fecha.")
            else:
                por_fecha.setdefault(f, []).append((prod, cant, precio))
        if errores:
            return Response({"detail": "Corrige el archivo y vuelve a subirlo.", "errores": errores[:50]}, status=400)
        total = 0
        for f, items in por_fecha.items():
            total += len(services.registrar_ventas(f, items, request.user))
        return Response({"registradas": total}, status=201)


class MovimientoViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MovimientoSerializer

    def get_queryset(self):
        qs = MovimientoInventario.objects.select_related("insumo")
        if i := self.request.query_params.get("insumo"):
            qs = qs.filter(insumo_id=i)
        return qs[:500]


@api_view(["GET"])
def analitica_productos(request):
    return Response(services.analitica(_fecha(request, "desde"), _fecha(request, "hasta")))


@api_view(["GET"])
def opciones(request):
    return Response({
        "unidades": [{"valor": k, "nombre": v} for k, v in UNIDADES],
        "categorias_insumo": _categorias(Categoria.INSUMO),
        "categorias_producto": _categorias(Categoria.PRODUCTO),
    })
