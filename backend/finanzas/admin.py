from django.contrib import admin

from .models import Bolsillo, Cierre, CierreBolsillo, Configuracion, Egreso

admin.site.register(Configuracion)
admin.site.register(Bolsillo)


class CierreBolsilloInline(admin.TabularInline):
    model = CierreBolsillo
    extra = 0
    readonly_fields = ["bolsillo", "nombre", "porcentaje", "monto"]


@admin.register(Cierre)
class CierreAdmin(admin.ModelAdmin):
    list_display = ["fecha", "ventas_bold", "efectivo", "ingreso_cuenta", "a_bolsillos", "caja_vueltas"]
    inlines = [CierreBolsilloInline]


@admin.register(Egreso)
class EgresoAdmin(admin.ModelAdmin):
    list_display = ["fecha", "descripcion", "categoria", "origen", "bolsillo", "valor"]
    list_filter = ["categoria", "origen"]
