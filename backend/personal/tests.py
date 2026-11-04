import io
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from costos.models import Insumo, MovimientoInventario, Producto, RecetaItem
from cuentas.models import Perfil
from finanzas.models import Cierre, Egreso, VentaBold

BOLD_CSV = """ID de la transacción;Fecha de la transacción;Estado;Método de pago;Monto total;Comisión
TX1;31/10/2026 20:15;Aprobada;Tarjeta;$ 45.000;1.200
TX2;31/10/2026 22:40;Aprobada;Nequi;30.000,00;800
TX3;31/10/2026 23:10;Rechazada;Tarjeta;$ 99.000;0
TX4;01/11/2026 19:05;Aprobada;Tarjeta;$ 120.500;3.000
"""


class Base(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user("admin3", password="clave-segura-123")
        self.admin.perfil.rol = Perfil.ADMIN
        self.admin.perfil.save()
        self.api = APIClient()
        self.api.force_authenticate(self.admin)


class BoldTests(Base):
    def test_previsualizar_aplicar_y_no_duplicar(self):
        archivo = lambda: SimpleUploadedFile("bold.csv", BOLD_CSV.encode(), "text/csv")  # noqa: E731
        r = self.api.post("/api/bold/importar/", {"archivo": archivo()}, format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["mapa"]["valor"], "Monto total")
        self.assertEqual(r.data["resumen"]["validas"], 3)
        self.assertEqual(r.data["resumen"]["descartadas_por_estado"], 1)
        self.assertEqual(r.data["resumen"]["dias"][0], {"fecha": "2026-10-31", "total": 75000.0, "transacciones": 2})
        # Ya había un cierre del 31 con efectivo; se conserva y se actualiza Bold
        self.api.post("/api/cierres/", {"fecha": "2026-10-31", "ventas_bold": 10000, "efectivo": 50000}, format="json")
        r = self.api.post("/api/bold/importar/", {"archivo": archivo(), "aplicar": "1"}, format="multipart")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data["cierres_actualizados"], r.data["cierres_creados"]), (1, 1))
        c = Cierre.objects.get(fecha="2026-10-31")
        self.assertEqual((c.ventas_bold, c.efectivo), (Decimal("75000"), Decimal("50000")))
        r = self.api.post("/api/bold/importar/", {"archivo": archivo(), "aplicar": "1"}, format="multipart")
        self.assertEqual(r.data["repetidas"], 3)
        self.assertEqual(VentaBold.objects.count(), 3)
        lote = self.api.get("/api/bold/ventas/").data["importaciones"][-1]["importacion"]
        self.assertEqual(self.api.delete(f"/api/bold/importaciones/{lote}/").status_code, 204)
        self.assertEqual(Cierre.objects.get(fecha="2026-10-31").ventas_bold, Decimal("0"))

    def test_excel(self):
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.append(["Reporte de ventas Bold"])
        ws.append(["Fecha", "Valor", "Estado"])
        from datetime import datetime
        ws.append([datetime(2026, 11, 2, 21, 0), 50000, "APROBADA"])
        buf = io.BytesIO()
        wb.save(buf)
        r = self.api.post("/api/bold/importar/", {"archivo": SimpleUploadedFile("b.xlsx", buf.getvalue())}, format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["resumen"]["total"], 50000.0)


class LiquidacionTests(Base):
    def test_quincena_con_nomina_provision_y_socios(self):
        t1 = self.api.post("/api/trabajadores/", {"nombre": "Ana", "documento": "123", "tipo_pago": "hora", "valor_pago": 10000}, format="json").data
        self.api.post("/api/trabajadores/", {"nombre": "Luis", "tipo_pago": "mensual", "valor_pago": 1600000}, format="json")
        r = self.api.post("/api/turnos/", {"fecha": "2026-11-01", "trabajador": t1["id"], "hora_inicio": "18:00", "hora_fin": "02:00",
                                            "efectivo_inicio": 100000, "efectivo_fin": 380000}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(float(r.data["horas"]), 8.0)
        self.assertEqual(r.data["diferencia_caja"], 280000.0)
        self.api.post("/api/socios/", {"nombre": "Paula", "porcentaje": 50}, format="json")
        s2 = self.api.post("/api/socios/", {"nombre": "Jhonnier", "porcentaje": 50}, format="json").data
        self.assertEqual(self.api.post("/api/socios/", {"nombre": "Otro", "porcentaje": 10}, format="json").status_code, 400)
        self.api.post("/api/cierres/", {"fecha": "2026-11-01", "ventas_bold": 6000000, "efectivo": 2000000}, format="json")
        self.api.post("/api/egresos/", {"fecha": "2026-11-02", "origen": "cuenta", "categoria": "proveedores", "descripcion": "Licores", "valor": 1000000}, format="json")
        self.api.post("/api/egresos/", {"fecha": "2026-11-03", "origen": "cuenta", "categoria": "retiro_socios", "descripcion": "Adelanto", "valor": 100000, "socio": s2["id"]}, format="json")
        d = self.api.get("/api/liquidacion/?desde=2026-11-01&hasta=2026-11-15&tipo=quincena").data
        self.assertEqual(d["ventas"], 8000000.0)
        self.assertEqual(d["gastos"], 1000000.0)  # el retiro de socio no es gasto
        self.assertEqual(d["nomina_total"], 80000 + 800000)
        self.assertEqual(d["provision_arriendo"], 3000000.0)
        self.assertEqual(d["neto"], 8000000 - 1000000 - 880000 - 3000000)
        jh = next(s for s in d["socios"] if s["nombre"] == "Jhonnier")
        self.assertEqual((jh["parte"], jh["retirado"], jh["por_pagar"]), (1560000, 100000.0, 1460000))
        r = self.api.post("/api/liquidacion/pagos/", {"tipo": "nomina", "fecha": "2026-11-15", "origen": "cuenta",
                                                      "items": [{"id": t1["id"], "valor": 80000}]}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        d = self.api.get("/api/liquidacion/?desde=2026-11-01&hasta=2026-11-15&tipo=quincena").data
        ana = next(f for f in d["nomina"] if f["nombre"] == "Ana")
        self.assertEqual(ana["pendiente"], 0)
        self.assertEqual(d["nomina_total"], 880000)
        r = self.api.post("/api/liquidaciones/", {"desde": "2026-11-01", "hasta": "2026-11-15", "tipo": "quincena"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)


class EdicionYFechasTests(Base):
    def test_inventario_con_fecha_pasada_y_edicion_de_venta(self):
        csv = "Producto,Cantidad,Unidad,Costo unitario\nRon blanco,50,oz,3200\nLimón,40,und,400\n"
        r = self.api.post("/api/insumos/importar/", {"archivo": SimpleUploadedFile("inv.csv", csv.encode())}, format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        items = r.data["items"]
        self.assertEqual(items[1]["unidad"], "unidad")
        r = self.api.post("/api/insumos/importar/aplicar/", {"fecha": "2026-10-31", "items": items}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        ron = Insumo.objects.get(nombre="Ron blanco")
        self.assertEqual(ron.stock, Decimal("50"))
        self.assertEqual(str(MovimientoInventario.objects.filter(insumo=ron).first().fecha), "2026-10-31")
        p = Producto.objects.create(nombre="Cuba libre", categoria="coctel", precio_venta=18000)
        RecetaItem.objects.create(producto=p, insumo=ron, cantidad=2)
        v = self.api.post("/api/ventas-producto/", {"fecha": "2026-10-31", "items": [{"producto": p.id, "cantidad": 5}]}, format="json").data[0]
        ron.refresh_from_db()
        self.assertEqual(ron.stock, Decimal("40"))
        r = self.api.patch(f"/api/ventas-producto/{v['id']}/", {"cantidad": 3}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        ron.refresh_from_db()
        self.assertEqual(ron.stock, Decimal("44"))
        c = self.api.post("/api/cierres/", {"fecha": "2026-10-31", "ventas_bold": 1000, "efectivo": 0}, format="json").data
        self.assertEqual(self.api.delete(f"/api/cierres/{c['id']}/").status_code, 204)
        e = self.api.post("/api/egresos/", {"fecha": "2026-10-31", "origen": "caja", "categoria": "otros", "descripcion": "Hielo", "valor": 4000}, format="json").data
        self.assertEqual(self.api.patch(f"/api/egresos/{e['id']}/", {"valor": 4500}, format="json").data["valor"], 4500)
        self.assertEqual(Egreso.objects.get().valor, Decimal("4500"))

    def test_factura_pdf_con_xml_adjunto(self):
        from pathlib import Path

        from pypdf import PdfWriter
        xml = (Path(__file__).resolve().parent.parent / "costos" / "tests_data" / "invoice.xml").read_bytes()
        w = PdfWriter()
        w.add_blank_page(200, 200)
        w.add_attachment("factura.xml", xml)
        buf = io.BytesIO()
        w.write(buf)
        r = self.api.post("/api/facturas/leer/", {"archivo": SimpleUploadedFile("f.pdf", buf.getvalue(), "application/pdf")}, format="multipart")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["metodo_lectura"], "xml")
        self.assertEqual(r.data["numero"], "FE1234")

    def test_factura_pdf_escaneado_sin_ia(self):
        from pypdf import PdfWriter
        w = PdfWriter()
        w.add_blank_page(200, 200)
        buf = io.BytesIO()
        w.write(buf)
        r = self.api.post("/api/facturas/leer/", {"archivo": SimpleUploadedFile("f.pdf", buf.getvalue(), "application/pdf")}, format="multipart")
        self.assertEqual(r.status_code, 400)
        self.assertIn("escaneada", r.data["detail"])
