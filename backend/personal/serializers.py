from rest_framework import serializers

from .models import Liquidacion, Socio, Trabajador, Turno


class TrabajadorSerializer(serializers.ModelSerializer):
    tipo_pago_nombre = serializers.CharField(source="get_tipo_pago_display", read_only=True)

    class Meta:
        model = Trabajador
        fields = ["id", "nombre", "documento", "cargo", "telefono", "tipo_pago", "tipo_pago_nombre", "valor_pago", "fecha_ingreso", "activo"]


class TurnoSerializer(serializers.ModelSerializer):
    trabajador_nombre = serializers.CharField(source="trabajador.nombre", read_only=True)
    diferencia_caja = serializers.SerializerMethodField()

    class Meta:
        model = Turno
        fields = ["id", "fecha", "trabajador", "trabajador_nombre", "hora_inicio", "hora_fin", "horas", "efectivo_inicio",
                  "efectivo_fin", "diferencia_caja", "notas", "creado"]

    def get_diferencia_caja(self, obj):
        if obj.efectivo_inicio is None or obj.efectivo_fin is None:
            return None
        return float(obj.efectivo_fin - obj.efectivo_inicio)

    def validate(self, data):
        ini = data.get("hora_inicio", getattr(self.instance, "hora_inicio", None))
        fin = data.get("hora_fin", getattr(self.instance, "hora_fin", None))
        horas = data.get("horas", getattr(self.instance, "horas", 0))
        if not (ini and fin) and not horas:
            raise serializers.ValidationError("Escribe la hora de entrada y de salida, o el número de horas.")
        return data

    def _guardar(self, turno):
        turno.calcular_horas()
        turno.save()
        return turno

    def create(self, validated_data):
        return self._guardar(Turno(**validated_data))

    def update(self, instance, validated_data):
        for k, v in validated_data.items():
            setattr(instance, k, v)
        return self._guardar(instance)


class SocioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Socio
        fields = ["id", "nombre", "porcentaje", "activo"]

    def validate(self, data):
        pct = data.get("porcentaje", getattr(self.instance, "porcentaje", 0))
        activo = data.get("activo", getattr(self.instance, "activo", True))
        otros = Socio.objects.filter(activo=True)
        if self.instance:
            otros = otros.exclude(pk=self.instance.pk)
        total = sum(s.porcentaje for s in otros) + (pct if activo else 0)
        if total > 100:
            raise serializers.ValidationError({"porcentaje": f"Los socios activos sumarían {total}%. No puede pasar de 100%."})
        return data


class LiquidacionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Liquidacion
        fields = ["id", "desde", "hasta", "tipo", "datos", "notas", "creado"]
        read_only_fields = ["datos", "creado"]
