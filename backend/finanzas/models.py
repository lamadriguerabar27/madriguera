from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

DINERO = {"max_digits": 14, "decimal_places": 2}
PORCENTAJE = {"max_digits": 5, "decimal_places": 2, "validators": [MinValueValidator(0), MaxValueValidator(100)]}


class Categoria(models.Model):
    """Categorías editables por un administrador para egresos, insumos y productos."""

    EGRESO, INSUMO, PRODUCTO = "egreso", "insumo", "producto"
    AMBITOS = [(EGRESO, "Egresos"), (INSUMO, "Insumos"), (PRODUCTO, "Productos")]

    ambito = models.CharField(max_length=10, choices=AMBITOS)
    slug = models.SlugField(max_length=40)
    nombre = models.CharField(max_length=80)
    orden = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["ambito", "orden", "nombre"]
        unique_together = [("ambito", "slug")]

    def __str__(self):
        return f"{self.get_ambito_display()}: {self.nombre}"

    @classmethod
    def nombres(cls, ambito):
        return dict(cls.objects.filter(ambito=ambito).values_list("slug", "nombre"))


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
    inicio_bold = models.DecimalField(default=0, validators=[MinValueValidator(0)], help_text="Saldo en Bold al abrir.", **DINERO)
    inicio_caja = models.DecimalField(default=0, validators=[MinValueValidator(0)], help_text="Efectivo en caja al abrir.", **DINERO)
    final_bold = models.DecimalField(null=True, blank=True, validators=[MinValueValidator(0)], help_text="Saldo en Bold al cerrar.", **DINERO)
    final_caja = models.DecimalField(null=True, blank=True, validators=[MinValueValidator(0)], help_text="Efectivo en caja al cerrar.", **DINERO)
    egresos_caja_dia = models.DecimalField(default=0, help_text="Egresos pagados de la caja ese día al cerrar.", **DINERO)
    queda_en_caja = models.DecimalField(default=0, help_text="Lo que debe quedar en caja después de transferir.", **DINERO)
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
    CATEGORIAS_INICIALES = [
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
    categoria = models.CharField(max_length=40, default="otros")
    descripcion = models.CharField(max_length=200)
    valor = models.DecimalField(validators=[MinValueValidator(Decimal("0.01"))], **DINERO)
    factura = models.ForeignKey("costos.Factura", null=True, blank=True, on_delete=models.SET_NULL, related_name="egresos")
    trabajador = models.ForeignKey("personal.Trabajador", null=True, blank=True, on_delete=models.SET_NULL, related_name="pagos")
    socio = models.ForeignKey("personal.Socio", null=True, blank=True, on_delete=models.SET_NULL, related_name="retiros")
    creado_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"{self.fecha} {self.descripcion} {self.valor}"


class VentaBold(models.Model):
    """Transacción importada del historial de ventas de Bold."""

    fecha = models.DateField()
    hora = models.TimeField(null=True, blank=True)
    valor = models.DecimalField(**DINERO)
    referencia = models.CharField(max_length=120, blank=True, db_index=True)
    estado = models.CharField(max_length=60, blank=True)
    metodo = models.CharField(max_length=60, blank=True)
    importacion = models.CharField(max_length=40, db_index=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha", "-hora"]
