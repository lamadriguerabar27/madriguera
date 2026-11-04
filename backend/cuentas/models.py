from django.conf import settings
from django.db import models


class Perfil(models.Model):
    ADMIN = "admin"
    COLABORADOR = "colaborador"
    ROLES = [(ADMIN, "Administrador"), (COLABORADOR, "Colaborador")]

    usuario = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="perfil")
    rol = models.CharField(max_length=20, choices=ROLES, default=COLABORADOR)

    def __str__(self):
        return f"{self.usuario.get_username()} ({self.get_rol_display()})"


def es_admin(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    perfil = getattr(user, "perfil", None)
    return bool(perfil and perfil.rol == Perfil.ADMIN)
