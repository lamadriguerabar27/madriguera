from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("bolsillos", views.BolsilloViewSet, basename="bolsillos")
router.register("categorias", views.CategoriaViewSet, basename="categorias")
router.register("cierres", views.CierreViewSet, basename="cierres")
router.register("egresos", views.EgresoViewSet, basename="egresos")

urlpatterns = [
    path("configuracion/", views.configuracion),
    path("opciones/finanzas/", views.opciones),
    path("reportes/flujo/", views.reporte_flujo),
    path("reportes/saldos/", views.reporte_saldos),
    path("reportes/historico/", views.reporte_historico),
    path("reportes/proyeccion/", views.reporte_proyeccion),
] + router.urls
