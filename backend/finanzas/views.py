from datetime import date

from rest_framework import status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from cuentas.models import es_admin
from cuentas.permissions import LecturaOAdmin, RegistroColaborador

from . import services
from .models import Bolsillo, Cierre, Configuracion, Egreso
from .serializers import BolsilloSerializer, CierreSerializer, ConfiguracionSerializer, EgresoSerializer


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
        qs = Egreso.objects.select_related("bolsillo", "creado_por")
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
        "categorias_egreso": [{"valor": k, "nombre": v} for k, v in Egreso.CATEGORIAS],
        "origenes_egreso": [{"valor": k, "nombre": v} for k, v in Egreso.ORIGENES],
    })
