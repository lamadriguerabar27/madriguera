"""Carga de inventario inicial o conteos desde CSV, Excel o PDF."""
from decimal import Decimal

from django.db import transaction

from finanzas.models import Categoria
from finanzas.tabla import a_decimal, buscar_columna

from . import ia, services
from .models import Insumo
from .unidades import UNIDADES

UNIDADES_OK = {u for u, _ in UNIDADES}
SINONIMOS = {"und": "unidad", "un": "unidad", "unid": "unidad", "unidades": "unidad", "u": "unidad", "botella": "unidad",
             "onza": "oz", "onzas": "oz", "mililitros": "ml", "gramos": "g", "gr": "g"}


def _unidad(v):
    t = str(v or "").strip().lower().rstrip(".")
    t = SINONIMOS.get(t, t)
    return t if t in UNIDADES_OK else "unidad"


def desde_tabla(encabezados, filas):
    col = {
        "nombre": buscar_columna(encabezados, "nombre", "producto", "insumo", "descrip", "articulo", "artículo", "item"),
        "cantidad": buscar_columna(encabezados, "cantidad", "stock", "existencia", "inventario", "conteo"),
        "unidad": buscar_columna(encabezados, "unidad", "medida"),
        "costo": buscar_columna(encabezados, "costo unit", "costo", "precio unit", "valor unit", "precio", "valor"),
        "categoria": buscar_columna(encabezados, "categor", "tipo", "grupo"),
    }
    if not col["nombre"] or not col["cantidad"]:
        raise ValueError("El archivo necesita al menos las columnas nombre (o producto) y cantidad (o stock).")
    items = []
    for f in filas:
        nombre = str(f.get(col["nombre"]) or "").strip()
        cant = a_decimal(f.get(col["cantidad"]))
        if not nombre or cant is None:
            continue
        items.append({"nombre": nombre[:120], "cantidad": float(cant), "unidad": _unidad(f.get(col["unidad"])) if col["unidad"] else "unidad",
                      "costo_unitario": float(a_decimal(f.get(col["costo"])) or 0) if col["costo"] else None,
                      "categoria": str(f.get(col["categoria"]) or "").strip() if col["categoria"] else ""})
    return items


def desde_pdf(contenido):
    d = ia.extraer_json(contenido, ia.INSTRUCCIONES_INVENTARIO)
    items = []
    for i in d.get("items") or []:
        if not i.get("nombre"):
            continue
        items.append({"nombre": str(i["nombre"])[:120], "cantidad": float(a_decimal(i.get("cantidad")) or 0), "unidad": _unidad(i.get("unidad")),
                      "costo_unitario": float(a_decimal(i.get("costo_unitario")) or 0) or None, "categoria": "",
                      "contenido_presentacion": float(a_decimal(i.get("contenido_presentacion")) or 0) or None,
                      "unidad_presentacion": _unidad(i.get("unidad_presentacion")) if i.get("unidad_presentacion") else "",
                      "costo_presentacion": float(a_decimal(i.get("costo_presentacion")) or 0) or None})
    return items


def emparejar(items):
    """Marca cuáles ya existen (por nombre) y sugiere la categoría."""
    existentes = {services.normalizar(i.nombre): i for i in Insumo.objects.all()}
    cats = {services.normalizar(n): s for s, n in Categoria.nombres(Categoria.INSUMO).items()}
    cats.update({services.normalizar(s): s for s in Categoria.nombres(Categoria.INSUMO)})
    for it in items:
        ins = existentes.get(services.normalizar(it["nombre"]))
        it["insumo"] = ins.id if ins else None
        it["stock_actual"] = float(ins.stock) if ins else None
        if ins:
            it["unidad"] = ins.unidad
            it["categoria"] = ins.categoria
        else:
            it["categoria"] = cats.get(services.normalizar(it.get("categoria", "")), "otro" if "otro" in cats.values() else next(iter(cats.values()), "otro"))
    return items


@transaction.atomic
def aplicar(items, fecha, usuario, actualizar_costos=True):
    creados = ajustados = 0
    for it in items:
        cantidad = Decimal(str(it.get("cantidad") or 0))
        costo = it.get("costo_unitario")
        ins = Insumo.objects.filter(pk=it.get("insumo")).first() if it.get("insumo") else None
        if not ins:
            ins = Insumo.objects.filter(nombre__iexact=it["nombre"].strip()).first()
        if not ins:
            ins = Insumo.objects.create(
                nombre=it["nombre"].strip()[:120], categoria=it.get("categoria") or "otro", unidad=_unidad(it.get("unidad")),
                costo_unitario=Decimal(str(costo or 0)), contenido_presentacion=it.get("contenido_presentacion") or None,
                unidad_presentacion=it.get("unidad_presentacion") or "", costo_presentacion=it.get("costo_presentacion") or None,
            )
            nuevo_costo = services.costo_desde_presentacion(ins)
            if nuevo_costo is not None:
                ins.costo_unitario = nuevo_costo
                ins.save(update_fields=["costo_unitario"])
            creados += 1
        elif actualizar_costos and costo:
            ins.costo_unitario = Decimal(str(costo))
            ins.save(update_fields=["costo_unitario", "actualizado"])
        services.ajustar_stock(ins, cantidad, f"Inventario cargado al {fecha.isoformat()}", usuario, fecha=fecha)
        ajustados += 1
    return {"creados": creados, "ajustados": ajustados}
