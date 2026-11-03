from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Perfil


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def crear_perfil(sender, instance, created, **kwargs):
    if created:
        rol = Perfil.ADMIN if instance.is_superuser else Perfil.COLABORADOR
        Perfil.objects.get_or_create(usuario=instance, defaults={"rol": rol})
