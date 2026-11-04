from django.utils.text import slugify
from rest_framework import serializers

from .models import Bolsillo, Categoria, Cierre, CierreBolsillo, Configuracion, Egreso


class CategoriaCampoMixin(serializers.Serializer):
    """Valida que la categoría exista en la tabla editable y devuelve su nombre."""

    AMBITO = None
    categoria_nombre = serializers.SerializerMethodField()

    def _mapa(self):
        clave = f"_cats_{self.AMBITO}"
        raiz = self.root
        if not hasattr(raiz, clave):
            setattr(raiz, clave, Categoria.nombres(self.AMBITO))
        return getattr(raiz, clave)

    def get_categoria_nombre(self, obj):
        return self._mapa().get(obj.categoria, obj.categoria)

    def validate_categoria(self, value):
        if value not in self._mapa():
            raise serializers.ValidationError("Esa categoría no existe. Créala primero en Administración → Categorías.")
        return value


class CategoriaSerializer(serializers.ModelSerializer):
    en_uso = serializers.SerializerMethodField()

    class Meta:
        model = Categoria
        fields = ["id", "ambito", "slug", "nombre", "orden", "en_uso"]
        read_only_fields = ["slug"]

    def get_en_uso(self, obj):
        from .services import usos_categoria
        return usos_categoria(obj)

    def validate_nombre(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Escribe un nombre.")
        return value

    def validate(self, data):
        ambito = data.get("ambito", getattr(self.instance, "ambito", None))
        if self.instance and "ambito" in data and data["ambito"] != self.instance.ambito:
            raise serializers.ValidationError("No se puede cambiar el tipo de una categoría.")
        nombre = data.get("nombre", getattr(self.instance, "nombre", ""))
        repetida = Categoria.objects.filter(ambito=ambito, nombre__iexact=nombre)
        if self.instance:
            repetida = repetida.exclude(pk=self.instance.pk)
        if repetida.exists():
            raise serializers.ValidationError({"nombre": "Ya existe una categoría con ese nombre."})
        return data

    def create(self, validated_data):
        base = slugify(validated_data["nombre"])[:36] or "categoria"
        slug, n = base, 2
        while Categoria.objects.filter(ambito=validated_data["ambito"], slug=slug).exists():
            slug, n = f"{base}-{n}", n + 1
        return Categoria.objects.create(slug=slug, **validated_data)


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
    ventas_bold = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, required=False)
    efectivo = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, required=False)
    total_ventas = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    creado_por_nombre = serializers.SerializerMethodField()

    class Meta:
        model = Cierre
        fields = [
            "id", "fecha", "inicio_bold", "inicio_caja", "final_bold", "final_caja", "egresos_caja_dia", "queda_en_caja",
            "ventas_bold", "efectivo", "total_ventas", "porcentaje_caja", "caja_vueltas", "transferir",
            "ingreso_cuenta", "a_bolsillos", "disponible_cuenta", "notas", "repartos", "creado_por_nombre",
            "creado", "actualizado",
        ]
        read_only_fields = [
            "porcentaje_caja", "caja_vueltas", "transferir", "ingreso_cuenta", "a_bolsillos", "disponible_cuenta",
            "egresos_caja_dia", "queda_en_caja",
        ]
        validators = []  # la unicidad por fecha se maneja como "guardar o actualizar"
        extra_kwargs = {"fecha": {"validators": []}}

    def get_creado_por_nombre(self, obj):
        u = obj.creado_por
        return (u.get_full_name() or u.username) if u else None

    def validate(self, data):
        """Si llegan los saldos de cierre, las ventas se calculan como cierre − inicio (+ egresos pagados de la caja)."""
        from .services import egresos_caja

        actual = lambda k, d=0: data.get(k, getattr(self.instance, k, d) if self.instance else d)  # noqa: E731
        inicio_bold, inicio_caja = actual("inicio_bold") or 0, actual("inicio_caja") or 0
        final_bold, final_caja = actual("final_bold", None), actual("final_caja", None)
        if final_bold is not None:
            if final_bold < inicio_bold:
                raise serializers.ValidationError({"final_bold": "El saldo de Bold al cerrar es menor que al abrir. Revisa los valores."})
            data["ventas_bold"] = final_bold - inicio_bold
        if final_caja is not None:
            pagado = egresos_caja(data.get("fecha") or self.instance.fecha)
            ventas_ef = final_caja - inicio_caja + pagado
            if ventas_ef < 0:
                raise serializers.ValidationError({"final_caja": "El efectivo al cerrar es menor que al abrir, incluso sumando los egresos pagados de la caja. Revisa los valores."})
            data["efectivo"] = ventas_ef
        bold = actual("ventas_bold") or 0
        efectivo = actual("efectivo") or 0
        if bold + efectivo <= 0:
            raise serializers.ValidationError("Escribe las ventas del día: saldos de cierre mayores que los de inicio, o las ventas directamente.")
        return data


class EgresoSerializer(CategoriaCampoMixin, serializers.ModelSerializer):
    AMBITO = Categoria.EGRESO
    origen_nombre = serializers.SerializerMethodField()
    creado_por_nombre = serializers.SerializerMethodField()

    class Meta:
        model = Egreso
        fields = [
            "id", "fecha", "origen", "bolsillo", "origen_nombre", "categoria", "categoria_nombre", "descripcion",
            "valor", "factura", "trabajador", "trabajador_nombre", "socio", "socio_nombre", "creado_por_nombre", "creado",
        ]

    trabajador_nombre = serializers.CharField(source="trabajador.nombre", read_only=True, default=None)
    socio_nombre = serializers.CharField(source="socio.nombre", read_only=True, default=None)

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
