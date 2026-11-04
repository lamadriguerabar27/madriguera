"""Crea el primer administrador a partir de variables de entorno, si aún no existe.

Usa ADMIN_USERNAME, ADMIN_PASSWORD y opcionalmente ADMIN_EMAIL.
"""
import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from cuentas.models import Perfil


class Command(BaseCommand):
    help = "Crea el administrador inicial desde variables de entorno."

    def handle(self, *args, **options):
        username = os.environ.get("ADMIN_USERNAME")
        password = os.environ.get("ADMIN_PASSWORD")
        if not username or not password:
            self.stdout.write("ADMIN_USERNAME o ADMIN_PASSWORD no están definidos; no se crea administrador.")
            return
        User = get_user_model()
        if User.objects.filter(username=username).exists():
            self.stdout.write(f"El usuario {username} ya existe.")
            return
        user = User.objects.create_superuser(username=username, password=password, email=os.environ.get("ADMIN_EMAIL", ""))
        user.perfil.rol = Perfil.ADMIN
        user.perfil.save()
        self.stdout.write(self.style.SUCCESS(f"Administrador {username} creado."))
