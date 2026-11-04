import io
import zipfile
from decimal import Decimal
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from cuentas.models import Perfil
from finanzas.models import Configuracion, Egreso

from .factura_parser import leer_factura
from .models import Insumo, Producto, RecetaItem, precio_sugerido

XML = (Path(__file__).parent / "tests_data" / "invoice.xml").read_bytes()


def attached(xml):
    return (
        b'<?xml version="1.0" encoding="UTF-8"?><AttachedDocument xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2" '
        b'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" '
        b'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cac:Attachment><cac:ExternalReference>'
        b"<cbc:MimeCode>text/xml</cbc:MimeCode><cbc:Description><![CDATA[" + xml + b"]]></cbc:Description>"
        b"</cac:ExternalReference></cac:Attachment></AttachedDocument>"
    )


class ParserTests(TestCase):
    def test_invoice_directo(self):
        d = leer_factura(XML, "f.xml")
        self.assertEqual(d["numero"], "FE1234")
        self.assertEqual(d["nit"], "900123456")
        self.assertEqual(d["total"], Decimal("179000.00"))
        self.assertEqual(len(d["items"]), 2)
        self.assertEqual(d["items"][1]["unidad_factura"], "caja")
        self.assertEqual(d["items"][0]["impuesto"], Decimal("19000.00"))

    def test_attached_document_en_zip(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("ad.xml", attached(XML))
            z.writestr("factura.pdf", b"%PDF-1.4")
        d = leer_factura(buf.getvalue(), "factura.zip")
        self.assertEqual(d["proveedor"], "Distribuidora Ejemplo SAS")


class PrecioTests(TestCase):
    def test_cerveza_con_servilleta_y_envio(self):
        # 2500 + 150 + 600 = 3250; con 40% de margen: 3250 / 0,6 = 5416,67 -> 5500 redondeado a 500
        self.assertEqual(precio_sugerido(Decimal("3250"), Decimal("40"), 500), Decimal("5500"))
        self.assertEqual(precio_sugerido(Decimal("3250"), Decimal("40"), 1), Decimal("5417"))


class FlujoCompletoTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user("admin", password="clave-segura-123")
        self.admin.perfil.rol = Perfil.ADMIN
        self.admin.perfil.save()
        self.colab = User.objects.create_user("colab", password="clave-segura-123")
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def test_cierre_reparte_caja_y_bolsillos(self):
        r = self.api.post("/api/cierres/", {"fecha": "2026-11-02", "ventas_bold": 500000, "efectivo": 200000}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["caja_vueltas"], 30000)
        self.assertEqual(r.data["transferir"], 170000)
        self.assertEqual(r.data["ingreso_cuenta"], 670000)
        self.assertEqual(r.data["a_bolsillos"], 335000)
        # Guardar el mismo día lo actualiza
        r = self.api.post("/api/cierres/", {"fecha": "2026-11-02", "ventas_bold": 100000, "efectivo": 0}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["a_bolsillos"], 50000)
        saldos = self.api.get("/api/reportes/saldos/").data
        self.assertEqual(saldos[0]["nombre"], "Caja")

    def test_colaborador_no_cambia_configuracion(self):
        c = APIClient()
        c.force_authenticate(self.colab)
        self.assertEqual(c.patch("/api/configuracion/", {"porcentaje_caja": 20}, format="json").status_code, 403)
        self.assertEqual(c.post("/api/egresos/", {"fecha": "2026-11-02", "origen": "caja", "categoria": "otros", "descripcion": "Hielo", "valor": 8000}, format="json").status_code, 201)
        eg = Egreso.objects.get()
        self.assertEqual(c.delete(f"/api/egresos/{eg.id}/").status_code, 403)

    def test_factura_botella_a_onzas_y_venta_descuenta(self):
        Configuracion.objects.filter(pk=1).update(ml_por_onza=30, iva_es_costo=True)
        ron = Insumo.objects.create(nombre="Ron blanco", categoria="licor", unidad="oz")
        serv = Insumo.objects.create(nombre="Servilleta", categoria="desechable", unidad="unidad")
        r = self.api.post("/api/facturas/leer/", {"archivo": SimpleUploadedFile("f.xml", XML, "text/xml")}, format="multipart")
        self.assertEqual(r.status_code, 201, r.data)
        items = r.data["items"]
        items[0].update(insumo=ron.id, contenido_por_unidad=750, unidad_contenido="ml")
        items[1].update(insumo=serv.id, contenido_por_unidad=100, unidad_contenido="unidad")
        r = self.api.patch(f"/api/facturas/{r.data['id']}/", {"items": items}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        r = self.api.post(f"/api/facturas/{r.data['id']}/aplicar/", {"registrar_egreso": {"origen": "cuenta"}}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        ron.refresh_from_db()
        serv.refresh_from_db()
        self.assertEqual(ron.stock, Decimal("25"))  # 750 ml / 30 ml
        self.assertEqual(ron.costo_unitario, Decimal("4760.0000"))  # 119.000 / 25 oz
        self.assertEqual(serv.costo_unitario, Decimal("300.0000"))  # 60.000 / 200
        self.assertEqual(Egreso.objects.get().valor, Decimal("179000.00"))
        # Repetir la misma factura se rechaza
        r = self.api.post("/api/facturas/leer/", {"archivo": SimpleUploadedFile("f.xml", XML, "text/xml")}, format="multipart")
        self.assertEqual(r.status_code, 409)

        p = Producto.objects.create(nombre="Mojito", categoria="coctel", precio_venta=25000)
        RecetaItem.objects.create(producto=p, insumo=ron, cantidad=2)
        RecetaItem.objects.create(producto=p, insumo=serv, cantidad=1)
        r = self.api.get(f"/api/productos/{p.id}/")
        self.assertAlmostEqual(r.data["costeo"]["costo"], 9820.0)
        self.assertEqual(r.data["costeo"]["precio_sugerido"], 16500.0)  # 9820 / 0,6 = 16366,67
        r = self.api.post("/api/ventas-producto/", {"fecha": "2026-11-02", "items": [{"producto": p.id, "cantidad": 3}]}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        ron.refresh_from_db()
        self.assertEqual(ron.stock, Decimal("19"))
        a = self.api.get("/api/analitica/productos/").data
        self.assertEqual(a["productos"][0]["cantidad"], 3)
        self.assertAlmostEqual(a["totales"]["utilidad"], 75000 - 3 * 9820)
        venta_id = self.api.get("/api/ventas-producto/").data[0]["id"]
        self.assertEqual(self.api.delete(f"/api/ventas-producto/{venta_id}/").status_code, 204)
        ron.refresh_from_db()
        self.assertEqual(ron.stock, Decimal("25"))

    def test_insumo_por_presentacion(self):
        r = self.api.post("/api/insumos/", {"nombre": "Ginebra", "categoria": "licor", "unidad": "oz",
                                             "contenido_presentacion": 700, "unidad_presentacion": "ml",
                                             "costo_presentacion": 84000, "stock_inicial": 46.667}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertAlmostEqual(float(r.data["costo_unitario"]), 3600.0, places=2)  # 84000 / (700/30)
        r = self.api.get(f"/api/insumos/{r.data['id']}/")
        self.assertAlmostEqual(r.data["presentaciones_en_stock"], 2.0, places=2)


class CambiosNoviembreTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user("admin2", password="clave-segura-123")
        self.admin.perfil.rol = Perfil.ADMIN
        self.admin.perfil.save()
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def test_categorias_crear_renombrar_y_borrar_moviendo(self):
        r = self.api.post("/api/categorias/", {"ambito": "producto", "nombre": "Shots"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        shots = r.data
        self.assertEqual(self.api.post("/api/categorias/", {"ambito": "producto", "nombre": "shots"}, format="json").status_code, 400)
        p = self.api.post("/api/productos/", {"nombre": "Shot de tequila", "categoria": shots["slug"], "tipo": "reventa",
                                               "costo_compra": 90000, "unidades_por_compra": 25, "precio_venta": 8000}, format="json")
        self.assertEqual(p.status_code, 201, p.data)
        self.assertEqual(p.data["categoria_nombre"], "Shots")
        self.assertAlmostEqual(p.data["costeo"]["costo"], 3600.0)
        self.assertAlmostEqual(p.data["costeo"]["margen_actual"], 55.0)
        self.assertEqual(self.api.patch(f"/api/categorias/{shots['id']}/", {"nombre": "Shots y chupitos"}, format="json").status_code, 200)
        r = self.api.delete(f"/api/categorias/{shots['id']}/")
        self.assertEqual(r.status_code, 409)
        otro = self.api.get("/api/categorias/?ambito=producto").data
        destino = next(c for c in otro if c["slug"] == "otro")
        self.assertEqual(self.api.delete(f"/api/categorias/{shots['id']}/?mover_a={destino['id']}").status_code, 204)
        self.assertEqual(Producto.objects.get().categoria, "otro")
        self.assertEqual(self.api.post("/api/productos/", {"nombre": "X", "categoria": "no-existe"}, format="json").status_code, 400)

    def test_cierre_con_saldos_de_inicio_y_cierre(self):
        self.api.post("/api/egresos/", {"fecha": "2026-11-04", "origen": "caja", "categoria": "otros", "descripcion": "Hielo", "valor": 4000}, format="json")
        r = self.api.post("/api/cierres/", {"fecha": "2026-11-04", "inicio_bold": 50000, "inicio_caja": 100000,
                                             "final_bold": 650000, "final_caja": 296000}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["ventas_bold"], 600000)
        self.assertEqual(r.data["efectivo"], 200000)  # 296.000 − 100.000 + 4.000 de hielo
        self.assertEqual(r.data["caja_vueltas"], 30000)
        self.assertEqual(r.data["transferir"], 170000)
        self.assertEqual(r.data["queda_en_caja"], 126000)  # 296.000 − 170.000
        s = self.api.get("/api/cierres/sugerencia/?fecha=2026-11-05").data
        self.assertEqual(s["inicio_caja"], 126000.0)
        r = self.api.post("/api/cierres/", {"fecha": "2026-11-05", "inicio_caja": 126000, "final_caja": 100000}, format="json")
        self.assertEqual(r.status_code, 400)
