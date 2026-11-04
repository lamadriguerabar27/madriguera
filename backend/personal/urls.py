from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("trabajadores", views.TrabajadorViewSet, basename="trabajadores")
router.register("turnos", views.TurnoViewSet, basename="turnos")
router.register("socios", views.SocioViewSet, basename="socios")
router.register("liquidaciones", views.LiquidacionViewSet, basename="liquidaciones")

urlpatterns = [
    path("liquidacion/", views.liquidacion),
    path("liquidacion/pagos/", views.registrar_pagos),
] + router.urls
