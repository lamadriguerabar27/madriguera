"""Liquidación de un periodo: ventas, egresos, nómina, provisiones y reparto entre socios."""
from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum

from finanzas.models import Categoria, Cierre, Configuracion, Egreso

from .models import Socio, Trabajador, Turno

NOMINA, RETIRO, ARRIENDO = "nomina", "retiro_socios", "arriendo_servicios"


def _f(v):
    return float(v or 0)


def meses_del_periodo(desde, hasta, tipo):
    if tipo == "mes":
        return 1.0
    if tipo == "quincena":
        return 0.5
    return ((hasta - desde).days + 1) / 30


def nomina(desde, hasta, tipo):
    dias = (hasta - desde).days + 1
    meses = meses_del_periodo(desde, hasta, tipo)
    horas = defaultdict(Decimal)
    for t in Turno.objects.filter(fecha__gte=desde, fecha__lte=hasta):
        horas[t.trabajador_id] += t.horas
    pagado = defaultdict(float)
    for e in Egreso.objects.filter(fecha__gte=desde, fecha__lte=hasta, trabajador__isnull=False).values("trabajador").annotate(s=Sum("valor")):
        pagado[e["trabajador"]] = _f(e["s"])
    filas = []
    for t in Trabajador.objects.all():
        h = _f(horas.get(t.id))
        v = _f(t.valor_pago)
        if t.tipo_pago == Trabajador.HORA:
            calc, detalle = h * v, f"{h:g} h × ${v:,.0f}".replace(",", ".")
        elif t.tipo_pago == Trabajador.SEMANAL:
            calc, detalle = v * dias / 7, f"{dias / 7:.2f} semanas".replace(".", ",")
        elif t.tipo_pago == Trabajador.QUINCENAL:
            calc, detalle = v * meses * 2, f"{meses * 2:.2f} quincenas".replace(".", ",")
        else:
            calc, detalle = v * meses, f"{meses:.2f} meses".replace(".", ",")
        if t.tipo_pago != Trabajador.HORA and t.fecha_ingreso and t.fecha_ingreso > hasta:
            calc = 0
        if not t.activo and not h and not pagado.get(t.id):
            continue
        if calc == 0 and not pagado.get(t.id) and not h:
            continue
        p = pagado.get(t.id, 0.0)
        filas.append({"id": t.id, "nombre": t.nombre, "tipo_pago": t.get_tipo_pago_display(), "horas": h, "detalle": detalle,
                      "calculado": round(calc), "pagado": p, "pendiente": max(round(calc) - p, 0)})
    return filas


def liquidar(desde, hasta, tipo="otro", provisionar_arriendo=True):
    cfg = Configuracion.actual()
    nombres = Categoria.nombres(Categoria.EGRESO)
    cierres = Cierre.objects.filter(fecha__gte=desde, fecha__lte=hasta)
    t = cierres.aggregate(b=Sum("ventas_bold"), e=Sum("efectivo"))
    ventas = _f(t["b"]) + _f(t["e"])
    egresos = Egreso.objects.filter(fecha__gte=desde, fecha__lte=hasta)

    por_cat = []
    for r in egresos.exclude(categoria__in=[NOMINA, RETIRO]).values("categoria").annotate(s=Sum("valor")).order_by("-s"):
        por_cat.append({"categoria": r["categoria"], "nombre": nombres.get(r["categoria"], r["categoria"]), "total": _f(r["s"])})
    gastos = sum(c["total"] for c in por_cat)

    filas_nomina = nomina(desde, hasta, tipo)
    pagado_nomina = _f(egresos.filter(categoria=NOMINA).aggregate(s=Sum("valor"))["s"])
    pendiente_nomina = sum(f["pendiente"] for f in filas_nomina)
    costo_nomina = pagado_nomina + pendiente_nomina

    meses = meses_del_periodo(desde, hasta, tipo)
    arriendo_pagado = _f(egresos.filter(categoria=ARRIENDO).aggregate(s=Sum("valor"))["s"])
    provision = max(_f(cfg.arriendo_mensual) * meses - arriendo_pagado, 0) if provisionar_arriendo else 0.0

    neto = ventas - gastos - costo_nomina - provision
    retiros = defaultdict(float)
    for r in egresos.filter(categoria=RETIRO, socio__isnull=False).values("socio").annotate(s=Sum("valor")):
        retiros[r["socio"]] = _f(r["s"])
    socios = []
    for s in Socio.objects.filter(activo=True):
        parte = neto * _f(s.porcentaje) / 100 if neto > 0 else 0.0
        socios.append({"id": s.id, "nombre": s.nombre, "porcentaje": _f(s.porcentaje), "parte": round(parte),
                       "retirado": retiros.get(s.id, 0.0), "por_pagar": max(round(parte) - retiros.get(s.id, 0.0), 0)})
    pct_socios = sum(s["porcentaje"] for s in socios)
    return {
        "desde": desde.isoformat(), "hasta": hasta.isoformat(), "tipo": tipo, "dias_con_cierre": cierres.count(),
        "ventas": ventas, "gastos": gastos, "gastos_por_categoria": por_cat,
        "nomina": filas_nomina, "nomina_pagada": pagado_nomina, "nomina_pendiente": pendiente_nomina, "nomina_total": costo_nomina,
        "provision_arriendo": provision, "arriendo_pagado": arriendo_pagado, "provisionar_arriendo": provisionar_arriendo,
        "neto": neto, "socios": socios, "porcentaje_sin_asignar": max(100 - pct_socios, 0),
        "sin_asignar": round(neto * max(100 - pct_socios, 0) / 100) if neto > 0 else 0,
    }


@transaction.atomic
def registrar_pagos(items, fecha, origen, bolsillo, categoria, usuario, campo, descripcion):
    """Crea un egreso por cada pago (nómina a trabajadores o retiro de socios)."""
    creados = []
    for it in items:
        valor = Decimal(str(it["valor"]))
        if valor <= 0:
            continue
        creados.append(Egreso.objects.create(
            fecha=fecha, origen=origen, bolsillo_id=bolsillo if origen == Egreso.BOLSILLO else None, categoria=categoria,
            descripcion=f"{descripcion} {it['nombre']}"[:200], valor=valor, creado_por=usuario, **{f"{campo}_id": it["id"]},
        ))
    return creados
