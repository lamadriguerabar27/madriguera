from datetime import datetime, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

DINERO = {"max_digits": 14, "decimal_places": 2}


class Trabajador(models.Model):
    HORA, SEMANAL, QUINCENAL, MENSUAL = "hora", "semanal", "quincenal", "mensual"
    TIPOS_PAGO = [(HORA, "Por hora"), (SEMANAL, "Semanal"), (QUINCENAL, "Quincenal"), (MENSUAL, "Mensual")]

    nombre = models.CharField(max_length=120)
    documento = models.CharField("Documento o RUT", max_length=40, blank=True)
    cargo = models.CharField(max_length=80, blank=True)
    telefono = models.CharField(max_length=30, blank=True)
    tipo_pago = models.CharField(max_length=10, choices=TIPOS_PAGO, default=HORA)
    valor_pago = models.DecimalField(
        validators=[MinValueValidator(0)], help_text="Valor por hora, o el pago de cada semana, quincena o mes.", **DINERO
    )
    fecha_ingreso = models.DateField(null=True, blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["-activo", "nombre"]

    def __str__(self):
        return self.nombre


class Turno(models.Model):
    """Un turno trabajado. Sirve para la nómina por horas y para el arqueo de caja del turno."""

    fecha = models.DateField()
    trabajador = models.ForeignKey(Trabajador, on_delete=models.PROTECT, related_name="turnos")
    hora_inicio = models.TimeField(null=True, blank=True)
    hora_fin = models.TimeField(null=True, blank=True)
    horas = models.DecimalField(max_digits=5, decimal_places=2, default=0, validators=[MinValueValidator(0), MaxValueValidator(24)])
    efectivo_inicio = models.DecimalField(null=True, blank=True, validators=[MinValueValidator(0)], **DINERO)
    efectivo_fin = models.DecimalField(null=True, blank=True, validators=[MinValueValidator(0)], **DINERO)
    notas = models.CharField(max_length=200, blank=True)
    creado_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha", "hora_inicio", "id"]

    def calcular_horas(self):
        if self.hora_inicio and self.hora_fin:
            ini = datetime.combine(self.fecha, self.hora_inicio)
            fin = datetime.combine(self.fecha, self.hora_fin)
            if fin <= ini:  # turno que pasa la medianoche
                fin += timedelta(days=1)
            self.horas = Decimal(round((fin - ini).total_seconds() / 3600, 2))
        return self.horas


class Socio(models.Model):
    nombre = models.CharField(max_length=120)
    porcentaje = models.DecimalField(max_digits=5, decimal_places=2, validators=[MinValueValidator(0), MaxValueValidator(100)])
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["-porcentaje", "nombre"]

    def __str__(self):
        return f"{self.nombre} ({self.porcentaje}%)"


class Liquidacion(models.Model):
    """Foto guardada de una liquidación (semana, quincena o mes) para el histórico."""

    TIPOS = [("semana", "Semana"), ("quincena", "Quincena"), ("mes", "Mes"), ("otro", "Otro periodo")]

    desde = models.DateField()
    hasta = models.DateField()
    tipo = models.CharField(max_length=10, choices=TIPOS, default="otro")
    datos = models.JSONField()
    notas = models.CharField(max_length=300, blank=True)
    creado_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-hasta", "-id"]
