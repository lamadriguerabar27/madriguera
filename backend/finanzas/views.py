from datetime import date

from rest_framework import status, viewsets
from django.db.models import Count, Max, Min, Sum
from rest_framework.decorators import action, api_view, parser_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from cuentas.models import es_admin
from cuentas.permissions import LecturaOAdmin, RegistroColaborador

from . import services
from .models import Bolsillo, Categoria, Cierre, Configuracion, Egreso, VentaBold
from .serializers import BolsilloSerializer, CategoriaSerializer, CierreSerializer, ConfiguracionSerializer, EgresoSerializer


def _categorias(ambito):
    return [{"valor": c.slug, "nombre": c.nombre} for c in Categoria.objects.filter(ambito=ambito)]


class CategoriaViewSet(viewsets.ModelViewSet):
    serializer_class = CategoriaSerializer
    permission_classes = [LecturaOAdmin]

    def get_queryset(self):
        qs = Categoria.objects.all()
        if ambito := self.request.query_params.get("ambito"):
            qs = qs.filter(ambito=ambito)
        return qs

    def destroy(self, request, *args, **kwargs):
        """Si la categoría está en uso, hay que indicar a cuál mover sus registros (?mover_a=<id>)."""
        cat = self.get_object()
        usos = services.usos_categoria(cat)
        if usos:
            destino_id = request.query_params.get("mover_a")
            destino = Categoria.objects.filter(pk=destino_id, ambito=cat.ambito).exclude(pk=cat.pk).first() if destino_id else None
            if not destino:
                return Response(
                    {"detail": f"Esta categoría tiene {usos} registro(s). Elige a qué categoría moverlos antes de borrarla.", "en_uso": usos},
                    status=status.HTTP_409_CONFLICT,
                )
            services.mover_categoria(cat, destino)
        cat.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _fecha(request, nombre):
    v = request.query_params.get(nombre)
    if not v:
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


@api_view(["GET", "PUT", "PATCH"])
def configuracion(request):
    cfg = Configuracion.actual()
    if request.method == "GET":
        return Response(ConfiguracionSerializer(cfg).data)
    if not es_admin(request.user):
        return Response({"detail": "Solo los administradores pueden cambiar la configuración."}, status=403)
    s = ConfiguracionSerializer(cfg, data=request.data, partial=True)
    s.is_valid(raise_exception=True)
    s.save()
    return Response(s.data)


class BolsilloViewSet(viewsets.ModelViewSet):
    queryset = Bolsillo.objects.all()
    serializer_class = BolsilloSerializer
    permission_classes = [LecturaOAdmin]

    def destroy(self, request, *args, **kwargs):
        b = self.get_object()
        if b.repartos.exists() or b.egresos.exists():
            b.activo = False
            b.save(update_fields=["activo"])
            return Response({"detail": "El bolsillo tiene movimientos; se desactivó en lugar de borrarse."})
        return super().destroy(request, *args, **kwargs)


class CierreViewSet(viewsets.ModelViewSet):
    serializer_class = CierreSerializer
    permission_classes = [RegistroColaborador]

    def get_queryset(self):
        qs = Cierre.objects.prefetch_related("repartos").select_related("creado_por")
        if d := _fecha(self.request, "desde"):
            qs = qs.filter(fecha__gte=d)
        if h := _fecha(self.request, "hasta"):
            qs = qs.filter(fecha__lte=h)
        if f := _fecha(self.request, "fecha"):
            qs = qs.filter(fecha=f)
        return qs

    def create(self, request, *args, **kwargs):
        """Guardar un día: si ya existe, lo actualiza (su autor o un administrador)."""
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        existente = Cierre.objects.filter(fecha=s.validated_data["fecha"]).first()
        if existente:
            if not (es_admin(request.user) or existente.creado_por_id == request.user.id):
                return Response(
                    {"detail": "Ese día ya tiene un cierre registrado por otra persona. Pide a un administrador que lo corrija."},
                    status=status.HTTP_409_CONFLICT,
                )
            for k, v in s.validated_data.items():
                setattr(existente, k, v)
            cierre = services.guardar_cierre(existente, request.user, recalcular_porcentajes=False)
            return Response(self.get_serializer(cierre).data)
        cierre = services.guardar_cierre(Cierre(**s.validated_data), request.user, recalcular_porcentajes=True)
        return Response(self.get_serializer(cierre).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def sugerencia(self, request):
        """Saldo de caja con el que debería abrir un día: lo que quedó en caja en el cierre anterior."""
        fecha = _fecha(request, "fecha") or date.today()
        previo = Cierre.objects.filter(fecha__lt=fecha).order_by("-fecha").first()
        return Response({
            "fecha_anterior": previo.fecha if previo else None,
            "inicio_caja": float(previo.queda_en_caja) if previo else None,
            "final_bold_anterior": float(previo.final_bold) if previo and previo.final_bold is not None else None,
            "egresos_caja_hoy": float(services.egresos_caja(fecha)),
        })

    def perform_update(self, serializer):
        cierre = serializer.instance
        for k, v in serializer.validated_data.items():
            setattr(cierre, k, v)
        recalcular = self.request.query_params.get("porcentajes_actuales") == "1"
        services.guardar_cierre(cierre, self.request.user, recalcular_porcentajes=recalcular)


class EgresoViewSet(viewsets.ModelViewSet):
    serializer_class = EgresoSerializer
    permission_classes = [RegistroColaborador]

    def get_queryset(self):
        qs = Egreso.objects.select_related("bolsillo", "creado_por", "trabajador", "socio")
        if d := _fecha(self.request, "desde"):
            qs = qs.filter(fecha__gte=d)
        if h := _fecha(self.request, "hasta"):
            qs = qs.filter(fecha__lte=h)
        for campo in ["origen", "categoria", "bolsillo"]:
            if v := self.request.query_params.get(campo):
                qs = qs.filter(**{campo: v})
        return qs

    def perform_create(self, serializer):
        serializer.save(creado_por=self.request.user)


@api_view(["GET"])
def reporte_flujo(request):
    return Response(services.flujo(_fecha(request, "desde"), _fecha(request, "hasta")))


@api_view(["GET"])
def reporte_saldos(request):
    return Response(services.saldos(_fecha(request, "hasta")))


@api_view(["GET"])
def reporte_historico(request):
    return Response(services.historico())


@api_view(["GET"])
def reporte_proyeccion(request):
    return Response(services.proyeccion())


@api_view(["GET"])
def opciones(request):
    return Response({
        "categorias_egreso": _categorias(Categoria.EGRESO),
        "origenes_egreso": [{"valor": k, "nombre": v} for k, v in Egreso.ORIGENES],
    })


# ---------- Historial de Bold ----------

def _archivo_tabla(request):
    from .tabla import ArchivoInvalido, leer_tabla

    archivo = request.FILES.get("archivo")
    if not archivo:
        raise ArchivoInvalido("Adjunta el archivo exportado de Bold (.csv o .xlsx).")
    if archivo.size > 15 * 1024 * 1024:
        raise ArchivoInvalido("El archivo pesa más de 15 MB.")
    return leer_tabla(archivo.read(), archivo.name)


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def bold_importar(request):
    """Sin aplicar=1 solo previsualiza: columnas detectadas, estados y totales por día."""
    import json

    from . import bold
    from .tabla import ArchivoInvalido

    if not es_admin(request.user):
        return Response({"detail": "Solo los administradores pueden importar el historial de Bold."}, status=403)
    try:
        encabezados, filas = _archivo_tabla(request)
    except ArchivoInvalido as e:
        return Response({"detail": str(e)}, status=400)
    mapa = bold.detectar(encabezados)
    try:
        mapa.update({k: v for k, v in json.loads(request.data.get("mapa") or "{}").items() if v in encabezados or v in ("", None)})
        estados = json.loads(request.data["estados"]) if request.data.get("estados") else None
    except (ValueError, AttributeError):
        return Response({"detail": "La configuración de columnas no es válida."}, status=400)
    if not mapa.get("fecha") or not mapa.get("valor"):
        return Response({"detail": "No encontramos las columnas de fecha y valor. Elígelas abajo.", "encabezados": encabezados,
                         "mapa": mapa, "muestra": _muestra(filas)}, status=422)
    trans, resumen = bold.procesar(filas, mapa, estados)
    if request.data.get("aplicar") != "1":
        return Response({"encabezados": encabezados, "mapa": mapa, "resumen": resumen, "muestra": _muestra(filas)})
    if not trans:
        return Response({"detail": "No hay transacciones válidas para guardar."}, status=400)
    return Response(bold.aplicar(trans, request.user, request.data.get("actualizar_cierres", "1") == "1"), status=201)


def _muestra(filas):
    return [{k: ("" if v is None else str(v)) for k, v in f.items()} for f in filas[:5]]


@api_view(["GET"])
def bold_ventas(request):
    qs = VentaBold.objects.all()
    if d := _fecha(request, "desde"):
        qs = qs.filter(fecha__gte=d)
    if h := _fecha(request, "hasta"):
        qs = qs.filter(fecha__lte=h)
    dias = [{"fecha": r["fecha"].isoformat(), "total": float(r["s"]), "transacciones": r["n"]}
            for r in qs.values("fecha").annotate(s=Sum("valor"), n=Count("id")).order_by("fecha")]
    importaciones = [{"importacion": r["importacion"], "desde": r["d"].isoformat(), "hasta": r["h"].isoformat(), "transacciones": r["n"],
                      "total": float(r["s"]), "creado": r["c"]}
                     for r in VentaBold.objects.values("importacion").annotate(d=Min("fecha"), h=Max("fecha"), n=Count("id"), s=Sum("valor"), c=Max("creado")).order_by("-c")[:30]]
    return Response({"dias": dias, "total": sum(x["total"] for x in dias), "importaciones": importaciones})


@api_view(["DELETE"])
def bold_borrar_importacion(request, lote):
    if not es_admin(request.user):
        return Response({"detail": "Solo los administradores pueden borrar importaciones."}, status=403)
    from decimal import Decimal

    dias = set(VentaBold.objects.filter(importacion=lote).values_list("fecha", flat=True))
    VentaBold.objects.filter(importacion=lote).delete()
    for d in dias:
        cierre = Cierre.objects.filter(fecha=d).first()
        if cierre:
            cierre.ventas_bold = VentaBold.objects.filter(fecha=d).aggregate(s=Sum("valor"))["s"] or Decimal(0)
            services.guardar_cierre(cierre, request.user, recalcular_porcentajes=False)
    return Response(status=204)
