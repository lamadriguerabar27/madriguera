from decimal import Decimal

from django.db import migrations

BOLSILLOS = [
    ("Arriendo y Servicios", Decimal("35"), True),
    ("Salvavidas", Decimal("2"), False),
    ("Proveedores", Decimal("8"), True),
    ("Ahorro", Decimal("5"), False),
]


def crear(apps, schema_editor):
    Configuracion = apps.get_model("finanzas", "Configuracion")
    Bolsillo = apps.get_model("finanzas", "Bolsillo")
    Configuracion.objects.get_or_create(pk=1)
    if not Bolsillo.objects.exists():
        for i, (nombre, pct, vacia) in enumerate(BOLSILLOS):
            Bolsillo.objects.create(nombre=nombre, porcentaje=pct, se_vacia_cada_mes=vacia, orden=i)


class Migration(migrations.Migration):
    dependencies = [("finanzas", "0001_initial")]
    operations = [migrations.RunPython(crear, migrations.RunPython.noop)]
