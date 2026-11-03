from django.db import migrations
from django.db.models import F

INICIALES = {
    "egreso": [
        ("arriendo_servicios", "Arriendo y servicios"), ("proveedores", "Proveedores e insumos"), ("nomina", "Nómina"),
        ("mantenimiento", "Mantenimiento"), ("impuestos", "Impuestos y trámites"), ("retiro_socios", "Retiro de socios"),
        ("otros", "Otros"),
    ],
    "insumo": [
        ("licor", "Licor"), ("cerveza", "Cerveza"), ("bebida", "Bebida"), ("fruta", "Fruta y decoración"),
        ("desechable", "Desechables"), ("snack", "Snacks y comida"), ("servicio", "Servicio (envío, etc.)"), ("otro", "Otro"),
    ],
    "producto": [("coctel", "Cóctel"), ("cerveza", "Cerveza"), ("bebida", "Bebida"), ("snack", "Snack"), ("otro", "Otro")],
}


def crear(apps, schema_editor):
    Categoria = apps.get_model("finanzas", "Categoria")
    Egreso = apps.get_model("finanzas", "Egreso")
    Cierre = apps.get_model("finanzas", "Cierre")
    Insumo = apps.get_model("costos", "Insumo")
    Producto = apps.get_model("costos", "Producto")
    for ambito, lista in INICIALES.items():
        for i, (slug, nombre) in enumerate(lista):
            Categoria.objects.get_or_create(ambito=ambito, slug=slug, defaults={"nombre": nombre, "orden": i})
    # Cualquier valor que ya esté en uso y no tenga categoría, se crea para no perderlo.
    for ambito, modelo in [("egreso", Egreso), ("insumo", Insumo), ("producto", Producto)]:
        for slug in modelo.objects.values_list("categoria", flat=True).distinct():
            Categoria.objects.get_or_create(ambito=ambito, slug=slug, defaults={"nombre": slug.replace("_", " ").capitalize(), "orden": 99})
    Cierre.objects.update(queda_en_caja=F("caja_vueltas"))


class Migration(migrations.Migration):
    dependencies = [
        ("finanzas", "0003_cierre_egresos_caja_dia_cierre_final_bold_and_more"),
        ("costos", "0002_producto_costo_compra_producto_tipo_and_more"),
    ]
    operations = [migrations.RunPython(crear, migrations.RunPython.noop)]
