"""Lectura de PDFs con la API de Claude (opcional: solo si existe ANTHROPIC_API_KEY)."""
import base64
import json
import re
import urllib.error
import urllib.request

from django.conf import settings


class IANoDisponible(RuntimeError):
    pass


def disponible():
    return bool(settings.ANTHROPIC_API_KEY)


def extraer_json(pdf_bytes, instrucciones, max_tokens=8000):
    if not disponible():
        raise IANoDisponible("La lectura de PDF con IA no está configurada (falta ANTHROPIC_API_KEY).")
    cuerpo = {
        "model": settings.ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                                "data": base64.standard_b64encode(pdf_bytes).decode()}},
                {"type": "text", "text": instrucciones + "\nResponde únicamente con el JSON, sin texto adicional ni bloques de código."},
            ],
        }],
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=json.dumps(cuerpo).encode(), method="POST",
        headers={"x-api-key": settings.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        detalle = e.read()[:300].decode(errors="replace")
        raise IANoDisponible(f"La API de Claude respondió con error {e.code}: {detalle}") from e
    except urllib.error.URLError as e:
        raise IANoDisponible("No se pudo conectar con la API de Claude.") from e
    texto = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()
    texto = re.sub(r"^```(?:json)?\s*|\s*```$", "", texto)
    try:
        return json.loads(texto)
    except ValueError as e:
        raise IANoDisponible("La respuesta de la IA no se pudo interpretar. Intenta de nuevo o registra los datos a mano.") from e


INSTRUCCIONES_FACTURA = """Esta es una factura de un proveedor de un bar en Colombia. Extrae sus datos en este JSON:
{"proveedor": str, "nit": str, "numero": str, "fecha": "AAAA-MM-DD", "subtotal": number, "impuestos": number, "total": number,
 "items": [{"descripcion": str, "codigo": str, "cantidad": number, "unidad_factura": str, "subtotal": number, "impuesto": number}]}
"subtotal" de cada línea es el valor total de la línea sin impuestos; "impuesto" es el IVA o impuesto al consumo de esa línea (0 si no aparece).
Los valores son números sin símbolos ni separadores de miles. Si un dato no aparece usa "" o 0."""

INSTRUCCIONES_INVENTARIO = """Este documento es un inventario o lista de productos de un bar en Colombia. Extrae cada producto en este JSON:
{"items": [{"nombre": str, "cantidad": number, "unidad": "oz"|"ml"|"unidad"|"g", "costo_unitario": number,
 "contenido_presentacion": number|null, "unidad_presentacion": "ml"|"oz"|"unidad"|"g"|null, "costo_presentacion": number|null}]}
"cantidad" es lo que hay en existencia en esa unidad. Si el producto es una botella de licor, usa "unidad": "oz" si el documento da onzas,
o deja la cantidad en botellas con "unidad": "unidad" y pon en contenido_presentacion los ml de la botella. Valores numéricos sin separadores."""
