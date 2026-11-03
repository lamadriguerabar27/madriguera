"""Cálculos de reparto, saldos, histórico y proyección."""
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Sum
from django.db.models.functions import TruncMonth

from .models import Bolsillo, Cierre, CierreBolsillo, Configuracion, Egreso

CENT = Decimal("0.01")
CIEN = Decimal("100")


def r2(v):
    return Decimal(v).quantize(CENT, rounding=ROUND_HALF_UP)


def reparto(ventas_bold, efectivo, porcentaje_caja, bolsillos):
    """bolsillos: lista de (bolsillo|None, nombre, porcentaje). Devuelve el reparto completo."""
    ventas_bold, efectivo = Decimal(ventas_bold), Decimal(efectivo)
    caja = r2(efectivo * Decimal(porcentaje_caja) / CIEN)
    transferir = efectivo - caja
    ingreso = ventas_bold + transferir
    partes = [(b, nombre, Decimal(p), r2(ingreso * Decimal(p) / CIEN)) for b, nombre, p in bolsillos]
    a_bolsillos = sum((p[3] for p in partes), Decimal(0))
    return {
        "caja_vueltas": caja,
        "transferir": transferir,
        "ingreso_cuenta": ingreso,
        "a_bolsillos": a_bolsillos,
        "disponible_cuenta": ingreso - a_bolsillos,
        "partes": partes,
    }


@transaction.atomic
def guardar_cierre(cierre, usuario, recalcular_porcentajes):
    """Calcula y guarda el reparto. Al crear toma la configuración actual; al editar conserva la del día."""
    if recalcular_porcentajes or cierre.porcentaje_caja is None:
        cierre.porcentaje_caja = Configuracion.actual().porcentaje_caja
        fuente = [(b, b.nombre, b.porcentaje) for b in Bolsillo.objects.filter(activo=True)]
    else:
        fuente = [(rb.bolsillo, rb.nombre, rb.porcentaje) for rb in cierre.repartos.all()]
    datos = reparto(cierre.ventas_bold, cierre.efectivo, cierre.porcentaje_caja, fuente)
    for campo in ["caja_vueltas", "transferir", "ingreso_cuenta", "a_bolsillos", "disponible_cuenta"]:
        setattr(cierre, campo, datos[campo])
    if not cierre.pk:
        cierre.creado_por = usuario
    cierre.actualizado_por = usuario
    cierre.save()
    cierre.repartos.all().delete()
    CierreBolsillo.objects.bulk_create(
        [CierreBolsillo(cierre=cierre, bolsillo=b, nombre=n, porcentaje=p, monto=m) for b, n, p, m in datos["partes"]]
    )
    return cierre


def _f(v):
    return float(v or 0)


def flujo(desde=None, hasta=None):
    cierres = Cierre.objects.all()
    egresos = Egreso.objects.select_related("bolsillo")
    if desde:
        cierres, egresos = cierres.filter(fecha__gte=desde), egresos.filter(fecha__gte=desde)
    if hasta:
        cierres, egresos = cierres.filter(fecha__lte=hasta), egresos.filter(fecha__lte=hasta)

    tot = cierres.aggregate(
        bold=Sum("ventas_bold"), efectivo=Sum("efectivo"), caja=Sum("caja_vueltas"), transferir=Sum("transferir"),
        ingreso=Sum("ingreso_cuenta"), bolsillos=Sum("a_bolsillos"), disponible=Sum("disponible_cuenta"),
    )
    ventas = _f(tot["bold"]) + _f(tot["efectivo"])
    egresos_total = _f(egresos.aggregate(s=Sum("valor"))["s"])

    por_categoria = []
    nombres_cat = dict(Egreso.CATEGORIAS)
    for row in egresos.values("categoria").annotate(total=Sum("valor")).order_by("-total"):
        por_categoria.append({"categoria": row["categoria"], "nombre": nombres_cat.get(row["categoria"], row["categoria"]), "total": _f(row["total"])})

    serie = defaultdict(lambda: {"ventas": 0.0, "ingreso_cuenta": 0.0, "egresos": 0.0, "a_bolsillos": 0.0, "caja_vueltas": 0.0, "disponible_cuenta": 0.0})
    for c in cierres:
        d = serie[c.fecha.isoformat()]
        d["ventas"] += _f(c.ventas_bold + c.efectivo)
        d["ingreso_cuenta"] += _f(c.ingreso_cuenta)
        d["a_bolsillos"] += _f(c.a_bolsillos)
        d["caja_vueltas"] += _f(c.caja_vueltas)
        d["disponible_cuenta"] += _f(c.disponible_cuenta)
    for row in egresos.values("fecha").annotate(total=Sum("valor")):
        serie[row["fecha"].isoformat()]["egresos"] += _f(row["total"])
    serie_list = [{"fecha": k, **v} for k, v in sorted(serie.items())]

    return {
        "ventas": ventas,
        "ventas_bold": _f(tot["bold"]),
        "efectivo": _f(tot["efectivo"]),
        "caja_vueltas": _f(tot["caja"]),
        "transferir": _f(tot["transferir"]),
        "ingreso_cuenta": _f(tot["ingreso"]),
        "a_bolsillos": _f(tot["bolsillos"]),
        "disponible_cuenta": _f(tot["disponible"]),
        "egresos": egresos_total,
        "resultado": ventas - egresos_total,
        "egresos_por_categoria": por_categoria,
        "egresos_por_origen": por_origen(egresos, cierres),
        "serie": serie_list,
        "dias_con_cierre": cierres.count(),
    }


def por_origen(egresos, cierres):
    """Entradas y salidas del periodo para caja, cuenta disponible y cada bolsillo."""
    filas = []
    entra_caja = _f(cierres.aggregate(s=Sum("caja_vueltas"))["s"])
    sale_caja = _f(egresos.filter(origen=Egreso.CAJA).aggregate(s=Sum("valor"))["s"])
    filas.append({"clave": "caja", "nombre": "Caja", "entra": entra_caja, "sale": sale_caja, "saldo": entra_caja - sale_caja})
    entra_cuenta = _f(cierres.aggregate(s=Sum("disponible_cuenta"))["s"])
    sale_cuenta = _f(egresos.filter(origen=Egreso.CUENTA).aggregate(s=Sum("valor"))["s"])
    filas.append({"clave": "cuenta", "nombre": "Cuenta disponible", "entra": entra_cuenta, "sale": sale_cuenta, "saldo": entra_cuenta - sale_cuenta})
    entradas = {r["bolsillo"]: _f(r["s"]) for r in CierreBolsillo.objects.filter(cierre__in=cierres).values("bolsillo").annotate(s=Sum("monto"))}
    salidas = {r["bolsillo"]: _f(r["s"]) for r in egresos.filter(origen=Egreso.BOLSILLO).values("bolsillo").annotate(s=Sum("valor"))}
    for b in Bolsillo.objects.all():
        e, s = entradas.get(b.id, 0.0), salidas.get(b.id, 0.0)
        if b.activo or e or s:
            filas.append({"clave": f"bolsillo:{b.id}", "nombre": b.nombre, "entra": e, "sale": s, "saldo": e - s})
    return filas


def saldos(hasta=None):
    """Saldos acumulados desde el inicio: dónde está la plata hoy."""
    cierres, egresos = Cierre.objects.all(), Egreso.objects.all()
    if hasta:
        cierres, egresos = cierres.filter(fecha__lte=hasta), egresos.filter(fecha__lte=hasta)
    return por_origen(egresos, cierres)


def historico():
    ventas = {
        r["mes"].strftime("%Y-%m"): r
        for r in Cierre.objects.annotate(mes=TruncMonth("fecha")).values("mes").annotate(
            bold=Sum("ventas_bold"), efectivo=Sum("efectivo"), ingreso=Sum("ingreso_cuenta"),
            bolsillos=Sum("a_bolsillos"), caja=Sum("caja_vueltas"),
        )
    }
    egresos = {
        r["mes"].strftime("%Y-%m"): _f(r["s"])
        for r in Egreso.objects.annotate(mes=TruncMonth("fecha")).values("mes").annotate(s=Sum("valor"))
    }
    meses = sorted(set(ventas) | set(egresos), reverse=True)
    out = []
    for m in meses:
        v = ventas.get(m, {})
        total = _f(v.get("bold")) + _f(v.get("efectivo"))
        eg = egresos.get(m, 0.0)
        out.append({
            "mes": m, "ventas": total, "ingreso_cuenta": _f(v.get("ingreso")), "a_bolsillos": _f(v.get("bolsillos")),
            "caja_vueltas": _f(v.get("caja")), "egresos": eg, "resultado": total - eg,
        })
    return out


def proyeccion():
    cfg = Configuracion.actual()
    bolsillos = list(Bolsillo.objects.filter(activo=True))
    meta, dias = float(cfg.meta_mensual), max(1, cfg.dias_abiertos)
    pc = float(cfg.porcentaje_caja) / 100
    # Parte de las ventas que suele ser efectivo (últimos 90 cierres); sin datos se asume 0.
    ult = Cierre.objects.order_by("-fecha")[:90].aggregate(b=Sum("ventas_bold"), e=Sum("efectivo"))
    total = _f(ult["b"]) + _f(ult["e"])
    parte_efectivo = _f(ult["e"]) / total if total else 0.0
    ingreso_mes = meta * (1 - parte_efectivo * pc)
    tm = (1 + float(cfg.tasa_ea) / 100) ** (1 / 12) - 1
    filas = []
    for b in bolsillos:
        aporte = ingreso_mes * float(b.porcentaje) / 100
        saldo = total_int = mes1 = 0.0
        for mes in range(12):
            interes = (saldo + aporte / 2) * tm
            if mes == 0:
                mes1 = interes
            total_int += interes
            saldo = interes if b.se_vacia_cada_mes else saldo + aporte + interes
        filas.append({
            "id": b.id, "nombre": b.nombre, "porcentaje": float(b.porcentaje), "se_vacia_cada_mes": b.se_vacia_cada_mes,
            "aporte_mensual": aporte, "aporte_diario": aporte / dias, "rendimiento_mes1": mes1,
            "rendimiento_12m": total_int, "saldo_12m": None if b.se_vacia_cada_mes else saldo,
        })
    arriendo_b = next((f for f in filas if "arriendo" in f["nombre"].lower()), None)
    pct_arr = (arriendo_b["porcentaje"] / 100) if arriendo_b else 0
    factor = (1 - parte_efectivo * pc) * pct_arr
    return {
        "meta_mensual": meta,
        "dias_abiertos": dias,
        "meta_diaria": meta / dias,
        "parte_efectivo": parte_efectivo,
        "ingreso_cuenta_mensual": ingreso_mes,
        "tasa_mensual": tm,
        "arriendo_mensual": float(cfg.arriendo_mensual),
        "bolsillo_arriendo": arriendo_b["aporte_mensual"] if arriendo_b else None,
        "meta_para_arriendo": (float(cfg.arriendo_mensual) / factor) if factor else None,
        "a_bolsillos_mensual": sum(f["aporte_mensual"] for f in filas),
        "rendimiento_mes1": sum(f["rendimiento_mes1"] for f in filas),
        "rendimiento_12m": sum(f["rendimiento_12m"] for f in filas),
        "bolsillos": filas,
    }
