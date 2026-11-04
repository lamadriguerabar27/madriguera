"""Lectura de facturas electrónicas colombianas (DIAN, UBL 2.1).

Acepta el .zip que envía el proveedor, el AttachedDocument .xml (que trae la factura
embebida) o el Invoice .xml directo. Devuelve los datos listos para revisar.
"""
import io
import zipfile
from datetime import date
from decimal import Decimal, InvalidOperation

from defusedxml import ElementTree as ET

from .unidades import nombre_unidad_dian


class FacturaInvalida(ValueError):
    pass


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _hijos(el, nombre):
    return [c for c in el if _local(c.tag) == nombre]


def _hijo(el, *ruta):
    actual = el
    for nombre in ruta:
        if actual is None:
            return None
        encontrados = _hijos(actual, nombre)
        actual = encontrados[0] if encontrados else None
    return actual


def _texto(el, *ruta):
    n = _hijo(el, *ruta) if ruta else el
    return (n.text or "").strip() if n is not None and n.text else ""


def _dec(v):
    try:
        return Decimal(str(v).strip() or "0")
    except (InvalidOperation, AttributeError):
        return Decimal(0)


def _xml_desde_bytes(contenido, nombre):
    nombre = (nombre or "").lower()
    if nombre.endswith(".zip") or contenido[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(contenido)) as z:
                xmls = [n for n in z.namelist() if n.lower().endswith(".xml")]
                if not xmls:
                    raise FacturaInvalida("El .zip no trae ningún archivo .xml. Sube el XML de la factura o regístrala a mano.")
                return z.read(xmls[0])
        except zipfile.BadZipFile as e:
            raise FacturaInvalida("El archivo .zip está dañado.") from e
    if nombre.endswith(".pdf") or contenido[:4] == b"%PDF":
        raise FacturaInvalida(
            "El PDF no trae los datos de la factura en un formato que se pueda leer. "
            "Sube el .zip o el .xml que llega en el correo del proveedor, o regístrala a mano."
        )
    return contenido


def _raiz_invoice(xml_bytes):
    try:
        raiz = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        raise FacturaInvalida("El archivo no es un XML válido.") from e
    if _local(raiz.tag) == "AttachedDocument":
        # La factura viene como texto dentro de cac:Attachment/cac:ExternalReference/cbc:Description
        for el in raiz.iter():
            if _local(el.tag) == "Description" and el.text and "Invoice" in el.text:
                try:
                    interna = ET.fromstring(el.text.strip().encode("utf-8"))
                except ET.ParseError:
                    continue
                if _local(interna.tag) in ("Invoice", "CreditNote"):
                    return interna
        raise FacturaInvalida("El AttachedDocument no contiene una factura legible.")
    if _local(raiz.tag) not in ("Invoice", "CreditNote"):
        raise FacturaInvalida("El XML no es una factura electrónica.")
    return raiz


def leer_factura(contenido, nombre=""):
    inv = _raiz_invoice(_xml_desde_bytes(contenido, nombre))
    if _local(inv.tag) == "CreditNote":
        raise FacturaInvalida("Este archivo es una nota crédito, no una factura.")

    proveedor = _hijo(inv, "AccountingSupplierParty", "Party")
    nombre_prov = (
        _texto(proveedor, "PartyTaxScheme", "RegistrationName")
        or _texto(proveedor, "PartyLegalEntity", "RegistrationName")
        or _texto(proveedor, "PartyName", "Name")
    ) if proveedor is not None else ""
    nit = (_texto(proveedor, "PartyTaxScheme", "CompanyID") or _texto(proveedor, "PartyLegalEntity", "CompanyID")) if proveedor is not None else ""

    try:
        fecha = date.fromisoformat(_texto(inv, "IssueDate"))
    except ValueError:
        fecha = date.today()

    totales = _hijo(inv, "LegalMonetaryTotal")
    subtotal = _dec(_texto(totales, "LineExtensionAmount")) if totales is not None else Decimal(0)
    total = _dec(_texto(totales, "PayableAmount") or _texto(totales, "TaxInclusiveAmount")) if totales is not None else Decimal(0)
    impuestos = sum((_dec(_texto(t, "TaxAmount")) for t in _hijos(inv, "TaxTotal")), Decimal(0))

    items = []
    for linea in _hijos(inv, "InvoiceLine"):
        cant_el = _hijo(linea, "InvoicedQuantity")
        cantidad = _dec(cant_el.text if cant_el is not None else "1") or Decimal(1)
        unidad = nombre_unidad_dian(cant_el.get("unitCode") if cant_el is not None else "")
        item = _hijo(linea, "Item")
        descripcion = _texto(item, "Description") if item is not None else ""
        codigo = ""
        if item is not None:
            codigo = _texto(item, "SellersItemIdentification", "ID") or _texto(item, "StandardItemIdentification", "ID")
        sub = _dec(_texto(linea, "LineExtensionAmount"))
        imp = sum((_dec(_texto(t, "TaxAmount")) for t in _hijos(linea, "TaxTotal")), Decimal(0))
        items.append({
            "descripcion": descripcion[:250] or f"Ítem {_texto(linea, 'ID')}",
            "codigo": codigo[:80],
            "cantidad": cantidad,
            "unidad_factura": unidad,
            "subtotal": sub,
            "impuesto": imp,
        })
    if not items:
        raise FacturaInvalida("La factura no tiene líneas de productos.")

    return {
        "proveedor": nombre_prov[:200],
        "nit": nit[:30],
        "numero": _texto(inv, "ID")[:60],
        "fecha": fecha,
        "subtotal": subtotal or sum((i["subtotal"] for i in items), Decimal(0)),
        "impuestos": impuestos,
        "total": total or (subtotal + impuestos),
        "items": items,
    }
