from django.apps import AppConfig


class CuentasConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "cuentas"
    verbose_name = "Cuentas y roles"

    def ready(self):
        from . import signals  # noqa: F401
