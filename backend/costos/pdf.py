"""PDF de facturas: XML adjunto, lectura con IA o, como último recurso, lectura del texto."""
import io
import re
from datetime import date

from finanzas.tabla import a_decimal, a_fecha_hora

from . import ia
from .factura_parser import FacturaInvalida, leer_factura


def _lector(contenido):
    from pypdf import PdfReader

    try:
        return PdfReader(io.BytesIO(contenido))
    except Exception as e:  # noqa: BLE001
        raise FacturaInvalida("El PDF está dañado o protegido con contraseña.") from e


def xml_adjunto(lector):
    try:
        adjuntos = lector.attachments or {}
    except Exception:  # noqa: BLE001
        return None
    for nombre, datos in adjuntos.items():
        if nombre.lower().endswith((".xml", ".zip")):
            for d in datos:
                try:
                    return leer_factura(d, nombre)
                except FacturaInvalida:
                    continue
    return None


def _texto(lector):
    return "\n".join((p.extract_text() or "") for p in lector.pages[:10])


NUM = r"\$?\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\$?\s?\d+(?:[.,]\d{1,2})?"


def por_texto(texto):
    """Lectura aproximada: encabezado por expresiones regulares y líneas con cantidad y valores."""
    nit = re.search(r"NIT[:.\s]*([\d.\-\s]{6,20})", texto, re.I)
    numero = re.search(r"(?:factura[^\n]{0,30}?(?:No\.?|N[°º]|#|número)\s*:?\s*)([A-Z0-9\-]{3,20})", texto, re.I)
    fecha = None
    for m in re.finditer(r"\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4}", texto):
        fecha, _ = a_fecha_hora(m.group(0))
        if fecha:
            break
    items = []
    for linea in texto.splitlines():
        nums = re.findall(NUM, linea)
        texto_linea = re.sub(NUM, " ", linea)
        palabras = re.sub(r"\s+", " ", texto_linea).strip(" -|:")
        if len(nums) < 2 or len(re.sub(r"[^A-Za-zÁÉÍÓÚÑáéíóúñ]", "", palabras)) < 3:
            continue
        valores = [a_decimal(n) for n in nums]
        valores = [v for v in valores if v is not None]
        if len(valores) < 2:
            continue
        total = valores[-1]
        cantidad = next((v for v in valores if 0 < v <= 500 and v == v.to_integral_value()), None) or 1
        if total < 100 or re.search(r"total|subtotal|iva|nit|tel|fecha|cufe|resoluci", palabras, re.I):
            continue
        items.append({"descripcion": palabras[:250], "codigo": "", "cantidad": cantidad, "unidad_factura": "unidad",
                      "subtotal": total, "impuesto": 0})
    proveedor = next((l.strip() for l in texto.splitlines() if len(l.strip()) > 4 and not re.search(r"\d{5,}", l)), "")
    return {
        "proveedor": proveedor[:200], "nit": re.sub(r"\s", "", nit.group(1))[:30] if nit else "", "numero": numero.group(1)[:60] if numero else "",
        "fecha": fecha or date.today(), "subtotal": sum((i["subtotal"] for i in items), 0), "impuestos": 0,
        "total": sum((i["subtotal"] for i in items), 0), "items": items[:80],
    }


def leer_factura_pdf(contenido):
    """Devuelve (datos, metodo). metodo: 'xml', 'ia' o 'texto'."""
    lector = _lector(contenido)
    datos = xml_adjunto(lector)
    if datos:
        return datos, "xml"
    if ia.disponible():
        d = ia.extraer_json(contenido, ia.INSTRUCCIONES_FACTURA)
        f, _ = a_fecha_hora(d.get("fecha"))
        items = [{
            "descripcion": str(i.get("descripcion") or "Producto")[:250], "codigo": str(i.get("codigo") or "")[:80],
            "cantidad": a_decimal(i.get("cantidad")) or 1, "unidad_factura": str(i.get("unidad_factura") or "unidad")[:20],
            "subtotal": a_decimal(i.get("subtotal")) or 0, "impuesto": a_decimal(i.get("impuesto")) or 0,
        } for i in d.get("items") or []]
        if not items:
            raise FacturaInvalida("No se encontraron productos en el PDF. Regístrala a mano.")
        return {
            "proveedor": str(d.get("proveedor") or "")[:200], "nit": str(d.get("nit") or "")[:30], "numero": str(d.get("numero") or "")[:60],
            "fecha": f or date.today(), "subtotal": a_decimal(d.get("subtotal")) or sum(i["subtotal"] for i in items),
            "impuestos": a_decimal(d.get("impuestos")) or 0, "total": a_decimal(d.get("total")) or sum(i["subtotal"] + i["impuesto"] for i in items),
            "items": items,
        }, "ia"
    texto = _texto(lector)
    if len(texto.strip()) < 30:
        raise FacturaInvalida(
            "Este PDF es una imagen escaneada y no tiene texto para leer. Activa la lectura con IA (ANTHROPIC_API_KEY) o regístrala a mano."
        )
    datos = por_texto(texto)
    if not datos["items"]:
        raise FacturaInvalida("No pudimos identificar los productos en el PDF. Regístrala a mano o activa la lectura con IA.")
    return datos, "texto"
