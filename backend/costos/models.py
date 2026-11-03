from decimal import ROUND_CEILING, Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from .unidades import UNIDADES

DINERO = {"max_digits": 14, "decimal_places": 2}
COSTO = {"max_digits": 16, "decimal_places": 4}
CANTIDAD = {"max_digits": 14, "decimal_places": 3}


class Insumo(models.Model):
    """Todo lo que se compra y se usa para vender: licores, cervezas, fruta, servilletas, pinchos, envío…"""

    CATEGORIAS = [
        ("licor", "Licor"), ("cerveza", "Cerveza"), ("bebida", "Bebida"), ("fruta", "Fruta y decoración"),
        ("desechable", "Desechables"), ("snack", "Snacks y comida"), ("servicio", "Servicio (envío, etc.)"), ("otro", "Otro"),
    ]

    nombre = models.CharField(max_length=120, unique=True)
    categoria = models.CharField(max_length=20, choices=CATEGORIAS, default="otro")
    unidad = models.CharField(max_length=10, choices=UNIDADES, default="unidad", help_text="Unidad en la que se usa y se cuenta el stock.")
    costo_unitario = models.DecimalField(default=0, validators=[MinValueValidator(0)], help_text="Costo por unidad de uso.", **COSTO)
    contenido_presentacion = models.DecimalField(
        null=True, blank=True, help_text="Ej.: 750 si la botella trae 750 ml.", validators=[MinValueValidator(Decimal("0.001"))], **CANTIDAD
    )
    unidad_presentacion = models.CharField(max_length=10, choices=UNIDADES, blank=True)
    costo_presentacion = models.DecimalField(null=True, blank=True, validators=[MinValueValidator(0)], **DINERO)
    controla_stock = models.BooleanField(default=True)
    stock = models.DecimalField(default=0, **CANTIDAD)
    stock_minimo = models.DecimalField(default=0, validators=[MinValueValidator(0)], **CANTIDAD)
    activo = models.BooleanField(default=True)
    actualizado = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["categoria", "nombre"]

    def __str__(self):
        return self.nombre


class Factura(models.Model):
    ELECTRONICA, MANUAL = "electronica", "manual"
    BORRADOR, APLICADA = "borrador", "aplicada"

    proveedor = models.CharField(max_length=200, blank=True)
    nit = models.CharField(max_length=30, blank=True)
    numero = models.CharField(max_length=60, blank=True)
    fecha = models.DateField()
    subtotal = models.DecimalField(default=0, **DINERO)
    impuestos = models.DecimalField(default=0, **DINERO)
    total = models.DecimalField(default=0, **DINERO)
    tipo = models.CharField(max_length=12, choices=[(ELECTRONICA, "Electrónica"), (MANUAL, "Manual")], default=MANUAL)
    estado = models.CharField(max_length=10, choices=[(BORRADOR, "Por revisar"), (APLICADA, "Aplicada")], default=BORRADOR)
    archivo = models.FileField(upload_to="facturas/%Y/%m/", null=True, blank=True)
    creado_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    creado = models.DateTimeField(auto_now_add=True)
    aplicada_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"{self.proveedor} {self.numero}"


class FacturaItem(models.Model):
    factura = models.ForeignKey(Factura, on_delete=models.CASCADE, related_name="items")
    descripcion = models.CharField(max_length=250)
    codigo = models.CharField(max_length=80, blank=True)
    cantidad = models.DecimalField(validators=[MinValueValidator(Decimal("0.001"))], **CANTIDAD)
    unidad_factura = models.CharField(max_length=20, blank=True, default="unidad")
    subtotal = models.DecimalField(default=0, **DINERO)
    impuesto = models.DecimalField(default=0, **DINERO)
    insumo = models.ForeignKey(Insumo, null=True, blank=True, on_delete=models.SET_NULL, related_name="items_factura")
    contenido_por_unidad = models.DecimalField(
        null=True, blank=True, help_text="Cuánto trae cada unidad facturada (ej.: 750 ml, 24 unidades).", **CANTIDAD
    )
    unidad_contenido = models.CharField(max_length=10, choices=UNIDADES, blank=True)
    cantidad_insumo = models.DecimalField(null=True, blank=True, **CANTIDAD)
    costo_unitario_insumo = models.DecimalField(null=True, blank=True, **COSTO)

    class Meta:
        ordering = ["id"]

    @property
    def total_linea(self):
        return self.subtotal + self.impuesto


class AliasProveedor(models.Model):
    """Recuerda cómo se llama un producto en las facturas para asignarlo solo la próxima vez."""

    texto = models.CharField(max_length=250, unique=True)
    insumo = models.ForeignKey(Insumo, on_delete=models.CASCADE, related_name="alias")
    contenido_por_unidad = models.DecimalField(null=True, blank=True, **CANTIDAD)
    unidad_contenido = models.CharField(max_length=10, choices=UNIDADES, blank=True)


class Producto(models.Model):
    """Lo que se vende en la carta: un cóctel, una cerveza, un snack…"""

    CATEGORIAS = [("coctel", "Cóctel"), ("cerveza", "Cerveza"), ("bebida", "Bebida"), ("snack", "Snack"), ("otro", "Otro")]

    nombre = models.CharField(max_length=120, unique=True)
    categoria = models.CharField(max_length=20, choices=CATEGORIAS, default="coctel")
    descripcion = models.CharField(max_length=300, blank=True)
    precio_venta = models.DecimalField(default=0, validators=[MinValueValidator(0)], **DINERO)
    margen_objetivo = models.DecimalField(
        null=True, blank=True, max_digits=5, decimal_places=2, validators=[MinValueValidator(0), MaxValueValidator(95)],
        help_text="Si está vacío se usa el margen de la configuración.",
    )
    activo = models.BooleanField(default=True)
    actualizado = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["categoria", "nombre"]

    def __str__(self):
        return self.nombre

    def costo(self):
        return sum((i.cantidad * i.insumo.costo_unitario for i in self.receta.select_related("insumo")), Decimal(0))

    def margen_usado(self, cfg):
        return self.margen_objetivo if self.margen_objetivo is not None else cfg.margen_objetivo


def precio_sugerido(costo, margen, redondeo):
    """Precio para que (precio - costo) / precio = margen. Se redondea hacia arriba."""
    costo, margen = Decimal(costo), Decimal(margen)
    if costo <= 0:
        return Decimal(0)
    bruto = costo / (1 - margen / 100)
    paso = Decimal(redondeo or 1)
    return (bruto / paso).to_integral_value(rounding=ROUND_CEILING) * paso


class RecetaItem(models.Model):
    producto = models.ForeignKey(Producto, on_delete=models.CASCADE, related_name="receta")
    insumo = models.ForeignKey(Insumo, on_delete=models.PROTECT, related_name="en_recetas")
    cantidad = models.DecimalField(validators=[MinValueValidator(Decimal("0.001"))], **CANTIDAD)

    class Meta:
        ordering = ["id"]
        unique_together = [("producto", "insumo")]


class VentaProducto(models.Model):
    fecha = models.DateField()
    producto = models.ForeignKey(Producto, on_delete=models.PROTECT, related_name="ventas")
    cantidad = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    precio_unitario = models.DecimalField(**DINERO)
    costo_unitario = models.DecimalField(**COSTO)
    creado_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha", "-id"]

    @property
    def total(self):
        return self.precio_unitario * self.cantidad

    @property
    def utilidad(self):
        return (self.precio_unitario - self.costo_unitario) * self.cantidad


class MovimientoInventario(models.Model):
    ENTRADA, SALIDA, AJUSTE = "entrada", "salida", "ajuste"

    insumo = models.ForeignKey(Insumo, on_delete=models.CASCADE, related_name="movimientos")
    fecha = models.DateField()
    tipo = models.CharField(max_length=10, choices=[(ENTRADA, "Entrada"), (SALIDA, "Salida"), (AJUSTE, "Ajuste")])
    cantidad = models.DecimalField(help_text="Positiva entra, negativa sale.", **CANTIDAD)
    costo_unitario = models.DecimalField(default=0, **COSTO)
    referencia = models.CharField(max_length=200, blank=True)
    factura = models.ForeignKey(Factura, null=True, blank=True, on_delete=models.SET_NULL, related_name="movimientos")
    venta = models.ForeignKey(VentaProducto, null=True, blank=True, on_delete=models.CASCADE, related_name="movimientos")
    creado_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha", "-id"]
