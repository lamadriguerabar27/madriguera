from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

DINERO = {"max_digits": 14, "decimal_places": 2}
PORCENTAJE = {"max_digits": 5, "decimal_places": 2, "validators": [MinValueValidator(0), MaxValueValidator(100)]}


class Configuracion(models.Model):
    """Una sola fila (pk=1) con los parámetros del negocio que edita un administrador."""

    meta_mensual = models.DecimalField(default=Decimal("18000000"), **DINERO)
    dias_abiertos = models.PositiveSmallIntegerField(default=30, validators=[MinValueValidator(1), MaxValueValidator(31)])
    arriendo_mensual = models.DecimalField(default=Decimal("6000000"), **DINERO)
    porcentaje_caja = models.DecimalField(
        default=Decimal("15"), help_text="Porcentaje del efectivo que se queda en caja para vueltas.", **PORCENTAJE
    )
    tasa_ea = models.DecimalField(default=Decimal("10"), help_text="Tasa efectiva anual de los bolsillos.", **PORCENTAJE)
    margen_objetivo = models.DecimalField(
        default=Decimal("40"), help_text="Margen bruto objetivo sobre el precio de venta.", max_digits=5, decimal_places=2,
        validators=[MinValueValidator(0), MaxValueValidator(95)],
    )
    ml_por_onza = models.DecimalField(default=Decimal("30"), max_digits=6, decimal_places=3, validators=[MinValueValidator(1)])
    iva_es_costo = models.BooleanField(
        default=True, help_text="Si el negocio no descuenta IVA, el IVA de las facturas se suma al costo."
    )
    redondeo_precio = models.PositiveIntegerField(default=500, help_text="Redondear precios sugeridos hacia arriba a este múltiplo.")
    actualizado = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "configuración"
        verbose_name_plural = "configuración"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def actual(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Bolsillo(models.Model):
    nombre = models.CharField(max_length=80, unique=True)
    porcentaje = models.DecimalField(**PORCENTAJE)
    se_vacia_cada_mes = models.BooleanField(default=False, help_text="Se usa para pagar cada mes (para la proyección).")
    orden = models.PositiveSmallIntegerField(default=0)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["orden", "id"]

    def __str__(self):
        return f"{self.nombre} ({self.porcentaje}%)"


class Cierre(models.Model):
    """Cierre de caja de un día. Guarda los porcentajes con los que se calculó."""

    fecha = models.DateField(unique=True)
    ventas_bold = models.DecimalField(default=0, validators=[MinValueValidator(0)], **DINERO)
    efectivo = models.DecimalField(default=0, validators=[MinValueValidator(0)], **DINERO)
    porcentaje_caja = models.DecimalField(**PORCENTAJE)
    caja_vueltas = models.DecimalField(default=0, **DINERO)
    transferir = models.DecimalField(default=0, **DINERO)
    ingreso_cuenta = models.DecimalField(default=0, **DINERO)
    a_bolsillos = models.DecimalField(default=0, **DINERO)
    disponible_cuenta = models.DecimalField(default=0, **DINERO)
    notas = models.CharField(max_length=300, blank=True)
    creado_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    actualizado_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    creado = models.DateTimeField(auto_now_add=True)
    actualizado = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-fecha"]

    @property
    def total_ventas(self):
        return self.ventas_bold + self.efectivo

    def __str__(self):
        return f"Cierre {self.fecha}"


class CierreBolsillo(models.Model):
    cierre = models.ForeignKey(Cierre, on_delete=models.CASCADE, related_name="repartos")
    bolsillo = models.ForeignKey(Bolsillo, null=True, on_delete=models.SET_NULL, related_name="repartos")
    nombre = models.CharField(max_length=80)
    porcentaje = models.DecimalField(**PORCENTAJE)
    monto = models.DecimalField(**DINERO)

    class Meta:
        ordering = ["id"]


class Egreso(models.Model):
    CAJA, CUENTA, BOLSILLO = "caja", "cuenta", "bolsillo"
    ORIGENES = [(CAJA, "Caja"), (CUENTA, "Cuenta (disponible)"), (BOLSILLO, "Bolsillo")]
    CATEGORIAS = [
        ("arriendo_servicios", "Arriendo y servicios"),
        ("proveedores", "Proveedores e insumos"),
        ("nomina", "Nómina"),
        ("mantenimiento", "Mantenimiento"),
        ("impuestos", "Impuestos y trámites"),
        ("retiro_socios", "Retiro de socios"),
        ("otros", "Otros"),
    ]

    fecha = models.DateField()
    origen = models.CharField(max_length=10, choices=ORIGENES)
    bolsillo = models.ForeignKey(Bolsillo, null=True, blank=True, on_delete=models.PROTECT, related_name="egresos")
    categoria = models.CharField(max_length=30, choices=CATEGORIAS, default="otros")
    descripcion = models.CharField(max_length=200)
    valor = models.DecimalField(validators=[MinValueValidator(Decimal("0.01"))], **DINERO)
    factura = models.ForeignKey("costos.Factura", null=True, blank=True, on_delete=models.SET_NULL, related_name="egresos")
    creado_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"{self.fecha} {self.descripcion} {self.valor}"
