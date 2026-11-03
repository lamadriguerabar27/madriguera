"""Reglas de costeo, inventario y analítica de productos."""
import re
import unicodedata
from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from finanzas.models import Categoria, Configuracion, Egreso

from .models import AliasProveedor, Factura, Insumo, MovimientoInventario, Producto, VentaProducto, precio_sugerido
from .unidades import ConversionError, convertir

CUATRO = Decimal("0.0001")


def normalizar(texto):
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", t)).strip()


def costo_desde_presentacion(insumo, cfg=None):
    """Si hay costo de presentación (ej. botella de 750 ml a $80.000) calcula el costo por unidad de uso (oz)."""
    if not (insumo.contenido_presentacion and insumo.costo_presentacion is not None and insumo.unidad_presentacion):
        return None
    cfg = cfg or Configuracion.actual()
    unidades = convertir(insumo.contenido_presentacion, insumo.unidad_presentacion, insumo.unidad, cfg.ml_por_onza)
    if unidades <= 0:
        return None
    return (Decimal(insumo.costo_presentacion) / unidades).quantize(CUATRO)


def sugerir_alias(factura):
    """Asigna insumo y contenido a las líneas que coinciden con facturas anteriores."""
    alias = {a.texto: a for a in AliasProveedor.objects.select_related("insumo")}
    insumos = {normalizar(i.nombre): i for i in Insumo.objects.filter(activo=True)}
    for item in factura.items.all():
        if item.insumo_id:
            continue
        clave = normalizar(item.descripcion)
        a = alias.get(clave)
        if a:
            item.insumo = a.insumo
            item.contenido_por_unidad = a.contenido_por_unidad
            item.unidad_contenido = a.unidad_contenido
            item.save()
        elif clave in insumos:
            item.insumo = insumos[clave]
            item.save()


@transaction.atomic
def aplicar_factura(factura, usuario, registrar_egreso=None):
    """Suma al inventario y actualiza el costo de cada insumo (promedio ponderado)."""
    factura = Factura.objects.select_for_update().get(pk=factura.pk)
    if factura.estado == Factura.APLICADA:
        raise ValueError("Esta factura ya se aplicó al inventario.")
    cfg = Configuracion.actual()
    aplicados = 0
    for item in factura.items.select_related("insumo"):
        if not item.insumo:
            continue
        insumo = Insumo.objects.select_for_update().get(pk=item.insumo_id)
        contenido = item.contenido_por_unidad or Decimal(1)
        unidad_cont = item.unidad_contenido or insumo.unidad
        try:
            por_unidad = convertir(contenido, unidad_cont, insumo.unidad, cfg.ml_por_onza)
        except ConversionError as e:
            raise ValueError(f"«{item.descripcion}»: {e}") from e
        cantidad_base = item.cantidad * por_unidad
        if cantidad_base <= 0:
            continue
        costo_linea = item.total_linea if cfg.iva_es_costo else item.subtotal
        costo_unit = (costo_linea / cantidad_base).quantize(CUATRO)
        if insumo.controla_stock and insumo.stock > 0:
            nuevo = (insumo.stock * insumo.costo_unitario + cantidad_base * costo_unit) / (insumo.stock + cantidad_base)
        else:
            nuevo = costo_unit
        insumo.costo_unitario = nuevo.quantize(CUATRO)
        if insumo.controla_stock:
            insumo.stock = insumo.stock + cantidad_base
        insumo.save()
        item.cantidad_insumo = cantidad_base
        item.costo_unitario_insumo = costo_unit
        item.save()
        MovimientoInventario.objects.create(
            insumo=insumo, fecha=factura.fecha, tipo=MovimientoInventario.ENTRADA, cantidad=cantidad_base,
            costo_unitario=costo_unit, referencia=f"Factura {factura.numero} {factura.proveedor}".strip(),
            factura=factura, creado_por=usuario,
        )
        AliasProveedor.objects.update_or_create(
            texto=normalizar(item.descripcion),
            defaults={"insumo": insumo, "contenido_por_unidad": item.contenido_por_unidad, "unidad_contenido": item.unidad_contenido},
        )
        aplicados += 1
    if not aplicados:
        raise ValueError("Ninguna línea tiene un insumo asignado. Asigna al menos una antes de aplicar.")
    factura.estado = Factura.APLICADA
    factura.aplicada_en = timezone.now()
    factura.save()
    if registrar_egreso:
        Egreso.objects.create(
            fecha=factura.fecha, origen=registrar_egreso.get("origen", Egreso.CUENTA), bolsillo_id=registrar_egreso.get("bolsillo"),
            categoria="proveedores", descripcion=f"Factura {factura.numero} {factura.proveedor}".strip()[:200],
            valor=factura.total, factura=factura, creado_por=usuario,
        )
    return factura


@transaction.atomic
def registrar_ventas(fecha, items, usuario):
    """items: [(producto, cantidad, precio|None)]. Descuenta del inventario según la receta."""
    creadas = []
    for producto, cantidad, precio in items:
        receta = list(producto.receta.select_related("insumo"))
        costo = producto.costo_directo() + sum((r.cantidad * r.insumo.costo_unitario for r in receta), Decimal(0))
        venta = VentaProducto.objects.create(
            fecha=fecha, producto=producto, cantidad=cantidad,
            precio_unitario=precio if precio is not None else producto.precio_venta,
            costo_unitario=costo.quantize(CUATRO), creado_por=usuario,
        )
        for r in receta:
            if not r.insumo.controla_stock:
                continue
            usado = r.cantidad * cantidad
            Insumo.objects.filter(pk=r.insumo_id).update(stock=F("stock") - usado)
            MovimientoInventario.objects.create(
                insumo=r.insumo, fecha=fecha, tipo=MovimientoInventario.SALIDA, cantidad=-usado,
                costo_unitario=r.insumo.costo_unitario, referencia=f"Venta {cantidad} × {producto.nombre}",
                venta=venta, creado_por=usuario,
            )
        creadas.append(venta)
    return creadas


@transaction.atomic
def borrar_venta(venta):
    """Devuelve al inventario lo que la venta había descontado."""
    for m in venta.movimientos.all():
        Insumo.objects.filter(pk=m.insumo_id).update(stock=F("stock") - m.cantidad)
    venta.delete()


@transaction.atomic
def ajustar_stock(insumo, stock_real, nota, usuario):
    insumo = Insumo.objects.select_for_update().get(pk=insumo.pk)
    diferencia = Decimal(stock_real) - insumo.stock
    if diferencia == 0:
        return insumo
    insumo.stock = Decimal(stock_real)
    insumo.save(update_fields=["stock", "actualizado"])
    MovimientoInventario.objects.create(
        insumo=insumo, fecha=timezone.localdate(), tipo=MovimientoInventario.AJUSTE, cantidad=diferencia,
        costo_unitario=insumo.costo_unitario, referencia=(nota or "Conteo físico")[:200], creado_por=usuario,
    )
    return insumo


def costeo_producto(producto, cfg=None):
    cfg = cfg or Configuracion.actual()
    lineas = []
    directo = producto.costo_directo()
    costo = directo
    for r in producto.receta.select_related("insumo"):
        c = r.cantidad * r.insumo.costo_unitario
        costo += c
        lineas.append({"id": r.id, "insumo": r.insumo_id, "nombre": r.insumo.nombre, "unidad": r.insumo.unidad,
                       "cantidad": float(r.cantidad), "costo_unitario": float(r.insumo.costo_unitario), "costo": float(c)})
    margen = producto.margen_usado(cfg)
    precio = Decimal(producto.precio_venta)
    return {
        "costo": float(costo),
        "costo_directo": float(directo),
        "margen_objetivo": float(margen),
        "precio_sugerido": float(precio_sugerido(costo, margen, cfg.redondeo_precio)),
        "utilidad": float(precio - costo),
        "margen_actual": float((precio - costo) / precio * 100) if precio > 0 else None,
        "lineas": lineas,
    }


def analitica(desde=None, hasta=None):
    ventas = VentaProducto.objects.select_related("producto")
    if desde:
        ventas = ventas.filter(fecha__gte=desde)
    if hasta:
        ventas = ventas.filter(fecha__lte=hasta)
    por_producto = defaultdict(lambda: {"cantidad": 0, "ingresos": 0.0, "costo": 0.0})
    por_categoria = defaultdict(lambda: {"cantidad": 0, "ingresos": 0.0, "costo": 0.0})
    serie = defaultdict(lambda: {"ingresos": 0.0, "costo": 0.0, "cantidad": 0})
    nombres_cat = Categoria.nombres(Categoria.PRODUCTO)
    info = {}
    for v in ventas:
        ingreso = float(v.precio_unitario) * v.cantidad
        costo = float(v.costo_unitario) * v.cantidad
        for bucket in (por_producto[v.producto_id], por_categoria[v.producto.categoria], serie[v.fecha.isoformat()]):
            bucket["cantidad"] += v.cantidad
            bucket["ingresos"] += ingreso
            bucket["costo"] += costo
        info[v.producto_id] = (v.producto.nombre, v.producto.categoria)

    def cerrar(d):
        d["utilidad"] = d["ingresos"] - d["costo"]
        d["margen"] = d["utilidad"] / d["ingresos"] * 100 if d["ingresos"] else None
        return d

    productos = [cerrar({"producto": pid, "nombre": info[pid][0], "categoria": info[pid][1],
                         "categoria_nombre": nombres_cat.get(info[pid][1], info[pid][1]), **d}) for pid, d in por_producto.items()]
    productos.sort(key=lambda x: -x["cantidad"])
    categorias = [cerrar({"categoria": c, "nombre": nombres_cat.get(c, c), **d}) for c, d in por_categoria.items()]
    categorias.sort(key=lambda x: -x["ingresos"])
    totales = cerrar({
        "cantidad": sum(p["cantidad"] for p in productos),
        "ingresos": sum(p["ingresos"] for p in productos),
        "costo": sum(p["costo"] for p in productos),
    })
    return {
        "totales": totales,
        "productos": productos,
        "categorias": categorias,
        "serie": [cerrar({"fecha": k, **v}) for k, v in sorted(serie.items())],
    }
