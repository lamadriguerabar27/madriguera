"""Lectura de archivos CSV y Excel, y conversión de montos y fechas en formatos colombianos."""
import csv
import io
import re
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation


class ArchivoInvalido(ValueError):
    pass


def leer_tabla(contenido, nombre):
    """Devuelve (encabezados, filas) con las filas como diccionarios. Acepta .csv, .xlsx y .xls modernos."""
    nombre = (nombre or "").lower()
    if nombre.endswith((".xlsx", ".xlsm")) or contenido[:2] == b"PK":
        try:
            from openpyxl import load_workbook

            libro = load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
        except Exception as e:  # noqa: BLE001
            raise ArchivoInvalido("No se pudo abrir el Excel. Guárdalo como .xlsx o exporta a .csv.") from e
        hoja = libro.worksheets[0]
        filas = [list(f) for f in hoja.iter_rows(values_only=True)]
        libro.close()
        # El encabezado es la primera fila con al menos dos celdas de texto
        inicio = next((i for i, f in enumerate(filas[:30]) if sum(isinstance(c, str) and c.strip() != "" for c in f) >= 2), 0)
        enc = [str(c).strip() if c is not None else f"col{j + 1}" for j, c in enumerate(filas[inicio])] if filas else []
        datos = [dict(zip(enc, f)) for f in filas[inicio + 1:] if any(c not in (None, "") for c in f)]
        return enc, datos
    if nombre.endswith(".xls"):
        raise ArchivoInvalido("El formato .xls antiguo no se puede leer. Ábrelo y guárdalo como .xlsx o .csv.")
    texto = None
    for cod in ("utf-8-sig", "latin-1"):
        try:
            texto = contenido.decode(cod)
            break
        except UnicodeDecodeError:
            continue
    muestra = texto[:4000]
    delim = max([",", ";", "\t", "|"], key=muestra.count)
    lector = csv.reader(io.StringIO(texto), delimiter=delim)
    filas = [f for f in lector if any(c.strip() for c in f)]
    if not filas:
        raise ArchivoInvalido("El archivo está vacío.")
    inicio = next((i for i, f in enumerate(filas[:30]) if sum(bool(c.strip()) for c in f) >= 2), 0)
    enc = [c.strip() or f"col{j + 1}" for j, c in enumerate(filas[inicio])]
    return enc, [dict(zip(enc, f)) for f in filas[inicio + 1:]]


def a_decimal(valor):
    """Convierte '$ 12.000', '12000.50', '12.000,50', '1,234,567.00' o números de Excel a Decimal."""
    if valor is None:
        return None
    if isinstance(valor, (int, float, Decimal)):
        return Decimal(str(valor))
    t = re.sub(r"[^\d,.\-]", "", str(valor))
    if not t or t in "-.,":
        return None
    if "," in t and "." in t:
        t = t.replace(".", "").replace(",", ".") if t.rfind(",") > t.rfind(".") else t.replace(",", "")
    elif "," in t:
        partes = t.split(",")
        t = t.replace(",", ".") if len(partes) == 2 and len(partes[1]) in (1, 2) else t.replace(",", "")
    elif t.count(".") > 1 or (t.count(".") == 1 and len(t.split(".")[1]) == 3):
        t = t.replace(".", "")
    try:
        return Decimal(t)
    except InvalidOperation:
        return None


FORMATOS = ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d/%m/%y", "%m/%d/%Y", "%d.%m.%Y"]


def a_fecha_hora(valor):
    """Devuelve (fecha, hora) o (None, None)."""
    if valor is None or valor == "":
        return None, None
    if isinstance(valor, datetime):
        return valor.date(), valor.time().replace(microsecond=0)
    if isinstance(valor, date):
        return valor, None
    t = str(valor).strip()
    t = re.sub(r"\s*(a\.?\s*m\.?|p\.?\s*m\.?)$", lambda m: " AM" if "a" in m.group(0).lower() else " PM", t, flags=re.I)
    m = re.match(r"^(\S+)(?:[ T](.+))?$", t)
    if not m:
        return None, None
    parte_fecha, parte_hora = m.group(1), m.group(2)
    fecha = None
    for f in FORMATOS:
        try:
            fecha = datetime.strptime(parte_fecha, f).date()
            break
        except ValueError:
            continue
    if not fecha:
        return None, None
    hora = None
    if parte_hora:
        ph = parte_hora.strip().replace("Z", "").split("+")[0].split(".")[0]
        for f in ("%H:%M:%S", "%H:%M", "%I:%M:%S %p", "%I:%M %p"):
            try:
                hora = datetime.strptime(ph, f).time()
                break
            except ValueError:
                continue
    return fecha, hora


def buscar_columna(encabezados, *claves, excluir=()):
    norm = {h: re.sub(r"\s+", " ", str(h).lower()) for h in encabezados}
    for clave in claves:
        for h, n in norm.items():
            if clave in n and not any(x in n for x in excluir):
                return h
    return None
