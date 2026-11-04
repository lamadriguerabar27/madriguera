from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import es_admin


class EsAdmin(BasePermission):
    message = "Solo los administradores pueden hacer esto."

    def has_permission(self, request, view):
        return es_admin(request.user)


class LecturaOAdmin(BasePermission):
    """Cualquiera con sesión lee; solo administradores crean, editan o borran."""

    message = "Solo los administradores pueden hacer cambios aquí."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return request.method in SAFE_METHODS or es_admin(request.user)


class RegistroColaborador(BasePermission):
    """Cualquiera con sesión lee y registra; solo administradores editan o borran."""

    message = "Solo los administradores pueden editar o borrar registros."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS or request.method == "POST":
            return True
        return es_admin(request.user)
