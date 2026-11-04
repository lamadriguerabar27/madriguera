"""Conversión entre unidades de medida usadas en barra y cocina."""
from decimal import Decimal

UNIDADES = [("oz", "Onzas"), ("ml", "Mililitros"), ("unidad", "Unidades"), ("g", "Gramos")]
VOLUMEN = {"oz", "ml", "l"}
PESO = {"g", "kg"}


class ConversionError(ValueError):
    pass


def convertir(cantidad, desde, hacia, ml_por_onza):
    """Convierte una cantidad entre unidades compatibles. ml_por_onza viene de la configuración."""
    cantidad, ml_por_onza = Decimal(cantidad), Decimal(ml_por_onza)
    if desde == hacia:
        return cantidad
    if desde in VOLUMEN and hacia in VOLUMEN:
        ml = {"ml": cantidad, "l": cantidad * 1000, "oz": cantidad * ml_por_onza}[desde]
        return {"ml": ml, "l": ml / 1000, "oz": ml / ml_por_onza}[hacia]
    if desde in PESO and hacia in PESO:
        g = cantidad * 1000 if desde == "kg" else cantidad
        return g / 1000 if hacia == "kg" else g
    raise ConversionError(f"No se puede convertir de {desde} a {hacia}.")


# Códigos de unidad de la DIAN (UN/ECE rec. 20) más comunes en facturas de proveedores.
CODIGOS_DIAN = {
    "94": "unidad", "NIU": "unidad", "EA": "unidad", "H87": "unidad", "C62": "unidad", "ZZ": "unidad",
    "BX": "caja", "CS": "caja", "PK": "paquete", "BO": "botella", "BG": "bolsa", "DZN": "docena",
    "LTR": "l", "MLT": "ml", "KGM": "kg", "GRM": "g", "OZA": "oz",
}


def nombre_unidad_dian(codigo):
    return CODIGOS_DIAN.get((codigo or "").upper(), (codigo or "unidad").lower())
