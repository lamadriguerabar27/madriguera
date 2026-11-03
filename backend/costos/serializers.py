from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from finanzas.models import Configuracion

from . import services
from .models import Factura, FacturaItem, Insumo, MovimientoInventario, Producto, RecetaItem, VentaProducto
from .unidades import ConversionError, convertir


class InsumoSerializer(serializers.ModelSerializer):
    stock_bajo = serializers.SerializerMethodField()
    presentaciones_en_stock = serializers.SerializerMethodField()
    categoria_nombre = serializers.CharField(source="get_categoria_display", read_only=True)

    class Meta:
        model = Insumo
        fields = [
            "id", "nombre", "categoria", "categoria_nombre", "unidad", "costo_unitario", "contenido_presentacion",
            "unidad_presentacion", "costo_presentacion", "controla_stock", "stock", "stock_minimo", "stock_bajo",
            "presentaciones_en_stock", "activo", "actualizado",
        ]
        read_only_fields = ["stock", "actualizado"]

    def get_stock_bajo(self, obj):
        return obj.controla_stock and obj.stock <= obj.stock_minimo

    def get_presentaciones_en_stock(self, obj):
        if not (obj.contenido_presentacion and obj.unidad_presentacion):
            return None
        try:
            por = convertir(obj.contenido_presentacion, obj.unidad_presentacion, obj.unidad, self._ml())
        except ConversionError:
            return None
        return float(obj.stock / por) if por else None

    def _ml(self):
        if not hasattr(self, "_ml_cache"):
            self._ml_cache = Configuracion.actual().ml_por_onza
        return self._ml_cache

    def validate(self, data):
        campos = ["contenido_presentacion", "unidad_presentacion", "costo_presentacion"]
        valores = {c: data.get(c, getattr(self.instance, c, None)) for c in campos}
        if any(valores.values()) and not all(v not in (None, "") for v in valores.values()):
            raise serializers.ValidationError("Para calcular por presentación escribe el contenido, su unidad y el costo de la presentación.")
        if all(v not in (None, "") for v in valores.values()):
            unidad = data.get("unidad", getattr(self.instance, "unidad", "unidad"))
            try:
                convertir(1, valores["unidad_presentacion"], unidad, self._ml())
            except ConversionError as e:
                raise serializers.ValidationError({"unidad_presentacion": str(e)})
        return data

    def save(self, **kwargs):
        insumo = super().save(**kwargs)
        costo = services.costo_desde_presentacion(insumo)
        if costo is not None and costo != insumo.costo_unitario:
            insumo.costo_unitario = costo
            insumo.save(update_fields=["costo_unitario", "actualizado"])
        return insumo


class StockInicialMixin(serializers.Serializer):
    stock_inicial = serializers.DecimalField(max_digits=14, decimal_places=3, required=False, write_only=True)


class InsumoCrearSerializer(InsumoSerializer, StockInicialMixin):
    class Meta(InsumoSerializer.Meta):
        fields = InsumoSerializer.Meta.fields + ["stock_inicial"]

    def create(self, validated_data):
        inicial = validated_data.pop("stock_inicial", None)
        insumo = super().create(validated_data)
        if inicial:
            services.ajustar_stock(insumo, inicial, "Stock inicial", self.context["request"].user)
        return insumo


class RecetaItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecetaItem
        fields = ["insumo", "cantidad"]


class ProductoSerializer(serializers.ModelSerializer):
    receta = RecetaItemSerializer(many=True, required=False)
    costeo = serializers.SerializerMethodField()
    categoria_nombre = serializers.CharField(source="get_categoria_display", read_only=True)

    class Meta:
        model = Producto
        fields = ["id", "nombre", "categoria", "categoria_nombre", "descripcion", "precio_venta", "margen_objetivo",
                  "activo", "receta", "costeo", "actualizado"]

    def get_costeo(self, obj):
        return services.costeo_producto(obj, self.context.get("cfg"))

    def validate_receta(self, value):
        vistos = set()
        for r in value:
            if r["insumo"].id in vistos:
                raise serializers.ValidationError(f"«{r['insumo'].nombre}» está repetido en la receta.")
            vistos.add(r["insumo"].id)
        return value

    @transaction.atomic
    def create(self, validated_data):
        receta = validated_data.pop("receta", [])
        producto = Producto.objects.create(**validated_data)
        RecetaItem.objects.bulk_create([RecetaItem(producto=producto, **r) for r in receta])
        return producto

    @transaction.atomic
    def update(self, instance, validated_data):
        receta = validated_data.pop("receta", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if receta is not None:
            instance.receta.all().delete()
            RecetaItem.objects.bulk_create([RecetaItem(producto=instance, **r) for r in receta])
        return instance


class FacturaItemSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False)
    insumo_nombre = serializers.CharField(source="insumo.nombre", read_only=True, default=None)
    insumo_unidad = serializers.CharField(source="insumo.unidad", read_only=True, default=None)

    class Meta:
        model = FacturaItem
        fields = ["id", "descripcion", "codigo", "cantidad", "unidad_factura", "subtotal", "impuesto", "insumo",
                  "insumo_nombre", "insumo_unidad", "contenido_por_unidad", "unidad_contenido", "cantidad_insumo",
                  "costo_unitario_insumo"]
        read_only_fields = ["cantidad_insumo", "costo_unitario_insumo"]


class FacturaSerializer(serializers.ModelSerializer):
    items = FacturaItemSerializer(many=True)
    archivo_url = serializers.SerializerMethodField()
    egreso = serializers.SerializerMethodField()

    class Meta:
        model = Factura
        fields = ["id", "proveedor", "nit", "numero", "fecha", "subtotal", "impuestos", "total", "tipo", "estado",
                  "archivo_url", "items", "egreso", "creado", "aplicada_en"]
        read_only_fields = ["tipo", "estado", "creado", "aplicada_en"]

    def get_archivo_url(self, obj):
        return obj.archivo.url if obj.archivo else None

    def get_egreso(self, obj):
        e = obj.egresos.first()
        return {"id": e.id, "origen": e.origen, "valor": float(e.valor)} if e else None

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("Agrega al menos una línea a la factura.")
        return value

    def validate(self, data):
        if self.instance and self.instance.estado == Factura.APLICADA:
            raise serializers.ValidationError("La factura ya se aplicó al inventario y no se puede editar.")
        return data

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("items")
        if not validated_data.get("total"):
            sub = sum((Decimal(i.get("subtotal") or 0) for i in items), Decimal(0))
            imp = sum((Decimal(i.get("impuesto") or 0) for i in items), Decimal(0))
            validated_data.update(subtotal=sub, impuestos=imp, total=sub + imp)
        factura = Factura.objects.create(tipo=Factura.MANUAL, **validated_data)
        for i in items:
            i.pop("id", None)
            FacturaItem.objects.create(factura=factura, **i)
        services.sugerir_alias(factura)
        return factura

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if items is not None:
            conservar = []
            for i in items:
                iid = i.pop("id", None)
                if iid and instance.items.filter(pk=iid).exists():
                    instance.items.filter(pk=iid).update(**i)
                    conservar.append(iid)
                else:
                    conservar.append(FacturaItem.objects.create(factura=instance, **i).pk)
            instance.items.exclude(pk__in=conservar).delete()
        return instance


class VentaProductoSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.CharField(source="producto.nombre", read_only=True)
    categoria = serializers.CharField(source="producto.categoria", read_only=True)
    total = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    utilidad = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)

    class Meta:
        model = VentaProducto
        fields = ["id", "fecha", "producto", "producto_nombre", "categoria", "cantidad", "precio_unitario",
                  "costo_unitario", "total", "utilidad", "creado"]
        read_only_fields = ["precio_unitario", "costo_unitario"]


class LoteItemSerializer(serializers.Serializer):
    producto = serializers.PrimaryKeyRelatedField(queryset=Producto.objects.filter(activo=True))
    cantidad = serializers.IntegerField(min_value=1)
    precio = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True, min_value=0)


class LoteVentasSerializer(serializers.Serializer):
    fecha = serializers.DateField()
    items = LoteItemSerializer(many=True)

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("Agrega al menos un producto vendido.")
        return value


class MovimientoSerializer(serializers.ModelSerializer):
    insumo_nombre = serializers.CharField(source="insumo.nombre", read_only=True)
    unidad = serializers.CharField(source="insumo.unidad", read_only=True)

    class Meta:
        model = MovimientoInventario
        fields = ["id", "insumo", "insumo_nombre", "unidad", "fecha", "tipo", "cantidad", "costo_unitario", "referencia", "creado"]
