from django.contrib import admin

from .models import AliasProveedor, Factura, FacturaItem, Insumo, MovimientoInventario, Producto, RecetaItem, VentaProducto


class RecetaInline(admin.TabularInline):
    model = RecetaItem
    extra = 1


@admin.register(Producto)
class ProductoAdmin(admin.ModelAdmin):
    list_display = ["nombre", "categoria", "precio_venta", "activo"]
    inlines = [RecetaInline]


@admin.register(Insumo)
class InsumoAdmin(admin.ModelAdmin):
    list_display = ["nombre", "categoria", "unidad", "costo_unitario", "stock", "activo"]
    list_filter = ["categoria", "activo"]


class FacturaItemInline(admin.TabularInline):
    model = FacturaItem
    extra = 0


@admin.register(Factura)
class FacturaAdmin(admin.ModelAdmin):
    list_display = ["fecha", "proveedor", "numero", "total", "estado"]
    inlines = [FacturaItemInline]


admin.site.register(AliasProveedor)
admin.site.register(VentaProducto)
admin.site.register(MovimientoInventario)
