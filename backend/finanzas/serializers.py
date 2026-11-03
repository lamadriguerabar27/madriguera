from rest_framework import serializers

from .models import Bolsillo, Cierre, CierreBolsillo, Configuracion, Egreso


class ConfiguracionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Configuracion
        exclude = ["id"]
        read_only_fields = ["actualizado"]


class BolsilloSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bolsillo
        fields = ["id", "nombre", "porcentaje", "se_vacia_cada_mes", "orden", "activo"]


class CierreBolsilloSerializer(serializers.ModelSerializer):
    class Meta:
        model = CierreBolsillo
        fields = ["bolsillo", "nombre", "porcentaje", "monto"]


class CierreSerializer(serializers.ModelSerializer):
    repartos = CierreBolsilloSerializer(many=True, read_only=True)
    total_ventas = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    creado_por_nombre = serializers.SerializerMethodField()

    class Meta:
        model = Cierre
        fields = [
            "id", "fecha", "ventas_bold", "efectivo", "total_ventas", "porcentaje_caja", "caja_vueltas", "transferir",
            "ingreso_cuenta", "a_bolsillos", "disponible_cuenta", "notas", "repartos", "creado_por_nombre",
            "creado", "actualizado",
        ]
        read_only_fields = [
            "porcentaje_caja", "caja_vueltas", "transferir", "ingreso_cuenta", "a_bolsillos", "disponible_cuenta",
        ]
        validators = []  # la unicidad por fecha se maneja como "guardar o actualizar"
        extra_kwargs = {"fecha": {"validators": []}}

    def get_creado_por_nombre(self, obj):
        u = obj.creado_por
        return (u.get_full_name() or u.username) if u else None

    def validate(self, data):
        bold = data.get("ventas_bold", getattr(self.instance, "ventas_bold", 0))
        efectivo = data.get("efectivo", getattr(self.instance, "efectivo", 0))
        if (bold or 0) + (efectivo or 0) <= 0:
            raise serializers.ValidationError("Escribe al menos un valor de ventas (Bold o efectivo).")
        return data


class EgresoSerializer(serializers.ModelSerializer):
    origen_nombre = serializers.SerializerMethodField()
    categoria_nombre = serializers.CharField(source="get_categoria_display", read_only=True)
    creado_por_nombre = serializers.SerializerMethodField()

    class Meta:
        model = Egreso
        fields = [
            "id", "fecha", "origen", "bolsillo", "origen_nombre", "categoria", "categoria_nombre", "descripcion",
            "valor", "factura", "creado_por_nombre", "creado",
        ]

    def get_origen_nombre(self, obj):
        if obj.origen == Egreso.BOLSILLO and obj.bolsillo:
            return f"Bolsillo {obj.bolsillo.nombre}"
        return obj.get_origen_display()

    def get_creado_por_nombre(self, obj):
        u = obj.creado_por
        return (u.get_full_name() or u.username) if u else None

    def validate(self, data):
        origen = data.get("origen", getattr(self.instance, "origen", None))
        bolsillo = data.get("bolsillo", getattr(self.instance, "bolsillo", None))
        if origen == Egreso.BOLSILLO and not bolsillo:
            raise serializers.ValidationError({"bolsillo": "Elige de qué bolsillo salió la plata."})
        if origen != Egreso.BOLSILLO:
            data["bolsillo"] = None
        return data
