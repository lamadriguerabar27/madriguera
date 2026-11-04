from django.contrib import admin

from .models import Liquidacion, Socio, Trabajador, Turno

admin.site.register(Trabajador)
admin.site.register(Turno)
admin.site.register(Socio)
admin.site.register(Liquidacion)
