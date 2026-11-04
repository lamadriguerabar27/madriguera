from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("usuarios", views.UsuarioViewSet, basename="usuarios")

urlpatterns = [
    path("yo/", views.yo),
    path("yo/password/", views.cambiar_password),
] + router.urls
