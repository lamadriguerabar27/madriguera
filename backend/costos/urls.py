from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("insumos", views.InsumoViewSet, basename="insumos")
router.register("productos", views.ProductoViewSet, basename="productos")
router.register("facturas", views.FacturaViewSet, basename="facturas")
router.register("ventas-producto", views.VentaProductoViewSet, basename="ventas-producto")
router.register("movimientos", views.MovimientoViewSet, basename="movimientos")

urlpatterns = [
    path("analitica/productos/", views.analitica_productos),
    path("opciones/costos/", views.opciones),
] + router.urls
