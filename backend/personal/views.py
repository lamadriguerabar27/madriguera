from datetime import date

from rest_framework import viewsets
from rest_framework.decorators import api_view
from rest_framework.response import Response

from cuentas.models import es_admin
from cuentas.permissions import LecturaOAdmin, RegistroColaborador
from finanzas.models import Bolsillo, Categoria, Egreso

from . import services
from .models import Liquidacion, Socio, Trabajador, Turno
from .serializers import LiquidacionSerializer, SocioSerializer, TrabajadorSerializer, TurnoSerializer


def _fecha(valor):
    try:
        return date.fromisoformat(valor or "")
    except ValueError:
        return None


class TrabajadorViewSet(viewsets.ModelViewSet):
    queryset = Trabajador.objects.all()
    serializer_class = TrabajadorSerializer
    permission_classes = [LecturaOAdmin]

    def destroy(self, request, *args, **kwargs):
        t = self.get_object()
        if t.turnos.exists() or t.pagos.exists():
            t.activo = False
            t.save(update_fields=["activo"])
            return Response({"detail": "Tiene turnos o pagos registrados; quedó inactivo en lugar de borrarse."})
        return super().destroy(request, *args, **kwargs)


class TurnoViewSet(viewsets.ModelViewSet):
    serializer_class = TurnoSerializer
    permission_classes = [RegistroColaborador]

    def get_queryset(self):
        qs = Turno.objects.select_related("trabajador")
        if d := _fecha(self.request.query_params.get("desde")):
            qs = qs.filter(fecha__gte=d)
        if h := _fecha(self.request.query_params.get("hasta")):
            qs = qs.filter(fecha__lte=h)
        if t := self.request.query_params.get("trabajador"):
            qs = qs.filter(trabajador_id=t)
        return qs

    def perform_create(self, serializer):
        serializer.save(creado_por=self.request.user)


class SocioViewSet(viewsets.ModelViewSet):
    queryset = Socio.objects.all()
    serializer_class = SocioSerializer
    permission_classes = [LecturaOAdmin]


class LiquidacionViewSet(viewsets.ModelViewSet):
    queryset = Liquidacion.objects.all()
    serializer_class = LiquidacionSerializer
    permission_classes = [LecturaOAdmin]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def perform_create(self, serializer):
        d = serializer.validated_data
        datos = services.liquidar(d["desde"], d["hasta"], d.get("tipo", "otro"), self.request.data.get("provisionar_arriendo", True) is not False)
        serializer.save(datos=datos, creado_por=self.request.user)


@api_view(["GET"])
def liquidacion(request):
    desde, hasta = _fecha(request.query_params.get("desde")), _fecha(request.query_params.get("hasta"))
    if not desde or not hasta or desde > hasta:
        return Response({"detail": "Elige un periodo válido."}, status=400)
    tipo = request.query_params.get("tipo", "otro")
    return Response(services.liquidar(desde, hasta, tipo, request.query_params.get("provision", "1") == "1"))


@api_view(["POST"])
def registrar_pagos(request):
    """Registra como egresos los pagos de nómina (tipo=nomina) o los retiros de socios (tipo=socios)."""
    if not es_admin(request.user):
        return Response({"detail": "Solo los administradores pueden registrar pagos."}, status=403)
    d = request.data
    fecha = _fecha(d.get("fecha"))
    origen = d.get("origen")
    if not fecha or origen not in dict(Egreso.ORIGENES):
        return Response({"detail": "Elige la fecha y de dónde sale la plata."}, status=400)
    bolsillo = d.get("bolsillo")
    if origen == Egreso.BOLSILLO and not Bolsillo.objects.filter(pk=bolsillo).exists():
        return Response({"detail": "Elige el bolsillo."}, status=400)
    if d.get("tipo") == "socios":
        categoria, campo, desc = services.RETIRO, "socio", "Ganancias"
        validos = dict(Socio.objects.values_list("id", "nombre"))
    else:
        categoria, campo, desc = services.NOMINA, "trabajador", "Nómina"
        validos = dict(Trabajador.objects.values_list("id", "nombre"))
    Categoria.objects.get_or_create(ambito=Categoria.EGRESO, slug=categoria,
                                    defaults={"nombre": "Nómina" if categoria == services.NOMINA else "Retiro de socios"})
    items = []
    for it in d.get("items") or []:
        try:
            iid, valor = int(it["id"]), float(it["valor"])
        except (KeyError, TypeError, ValueError):
            return Response({"detail": "Hay un pago con datos incompletos."}, status=400)
        if iid not in validos:
            return Response({"detail": "Uno de los pagos no corresponde a una persona registrada."}, status=400)
        items.append({"id": iid, "nombre": validos[iid], "valor": valor})
    creados = services.registrar_pagos(items, fecha, origen, bolsillo, categoria, request.user, campo, d.get("descripcion") or desc)
    return Response({"registrados": len(creados), "total": sum(float(e.valor) for e in creados)}, status=201)
