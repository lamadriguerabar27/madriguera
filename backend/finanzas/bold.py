"""Importación del historial de ventas exportado desde el panel de Bold."""
import uuid
from collections import Counter, defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum

from . import services
from .models import Cierre, VentaBold
from .tabla import a_decimal, a_fecha_hora, buscar_columna

ESTADOS_OK = ("aprob", "exitos", "pagad", "approved", "success", "complet", "abonad")


def detectar(encabezados):
    return {
        "fecha": buscar_columna(encabezados, "fecha de la transac", "fecha transac", "fecha de venta", "fecha de pago", "fecha", "date"),
        "valor": buscar_columna(encabezados, "monto total", "valor total", "valor de la venta", "valor venta", "monto", "valor",
                                "total", "amount", excluir=("comisi", "iva", "retenc", "neto", "impuesto")),
        "estado": buscar_columna(encabezados, "estado", "status"),
        "referencia": buscar_columna(encabezados, "id de la transac", "id transac", "referencia", "transacci", "código", "codigo", "id"),
        "metodo": buscar_columna(encabezados, "método", "metodo", "medio de pago", "tipo de pago", "franquicia"),
    }


def _estado_ok(estado, estados_validos):
    e = (estado or "").strip()
    if estados_validos is not None:
        return e in estados_validos
    return e == "" or any(k in e.lower() for k in ESTADOS_OK)


def procesar(filas, mapa, estados_validos=None):
    """Convierte filas en transacciones; devuelve (transacciones, resumen)."""
    trans, descartadas, sin_dato = [], 0, 0
    conteo_estados = Counter()
    for f in filas:
        estado = str(f.get(mapa["estado"]) or "").strip() if mapa.get("estado") else ""
        conteo_estados[estado or "(sin estado)"] += 1
        fecha, hora = a_fecha_hora(f.get(mapa["fecha"])) if mapa.get("fecha") else (None, None)
        valor = a_decimal(f.get(mapa["valor"])) if mapa.get("valor") else None
        if not fecha or valor is None:
            sin_dato += 1
            continue
        if mapa.get("estado") and not _estado_ok(estado, estados_validos):
            descartadas += 1
            continue
        trans.append({
            "fecha": fecha, "hora": hora, "valor": valor, "estado": estado[:60],
            "referencia": str(f.get(mapa["referencia"]) or "").strip()[:120] if mapa.get("referencia") else "",
            "metodo": str(f.get(mapa["metodo"]) or "").strip()[:60] if mapa.get("metodo") else "",
        })
    por_dia = defaultdict(lambda: {"total": Decimal(0), "n": 0})
    for t in trans:
        por_dia[t["fecha"]]["total"] += t["valor"]
        por_dia[t["fecha"]]["n"] += 1
    resumen = {
        "validas": len(trans), "descartadas_por_estado": descartadas, "sin_fecha_o_valor": sin_dato,
        "estados": [{"estado": e, "filas": n} for e, n in conteo_estados.most_common()],
        "dias": [{"fecha": d.isoformat(), "total": float(v["total"]), "transacciones": v["n"]} for d, v in sorted(por_dia.items())],
        "total": float(sum((t["valor"] for t in trans), Decimal(0))),
    }
    return trans, resumen


@transaction.atomic
def aplicar(trans, usuario, actualizar_cierres=True):
    lote = uuid.uuid4().hex[:12]
    existentes = set(VentaBold.objects.exclude(referencia="").values_list("referencia", flat=True))
    nuevas, repetidas = [], 0
    for t in trans:
        if t["referencia"] and t["referencia"] in existentes:
            repetidas += 1
            continue
        if t["referencia"]:
            existentes.add(t["referencia"])
        nuevas.append(VentaBold(importacion=lote, **t))
    VentaBold.objects.bulk_create(nuevas)
    dias = sorted({v.fecha for v in nuevas})
    actualizados = creados = 0
    if actualizar_cierres:
        for d in dias:
            total = VentaBold.objects.filter(fecha=d).aggregate(s=Sum("valor"))["s"] or Decimal(0)
            cierre = Cierre.objects.filter(fecha=d).first()
            if cierre:
                cierre.ventas_bold = total
                cierre.final_bold = None
                services.guardar_cierre(cierre, usuario, recalcular_porcentajes=False)
                actualizados += 1
            elif total > 0:
                services.guardar_cierre(Cierre(fecha=d, ventas_bold=total, efectivo=0), usuario, recalcular_porcentajes=True)
                creados += 1
    return {"importacion": lote, "guardadas": len(nuevas), "repetidas": repetidas, "dias": len(dias),
            "cierres_actualizados": actualizados, "cierres_creados": creados}
