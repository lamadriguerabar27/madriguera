from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import Perfil, es_admin

User = get_user_model()


class UsuarioSerializer(serializers.ModelSerializer):
    rol = serializers.ChoiceField(choices=Perfil.ROLES, source="perfil.rol", default=Perfil.COLABORADOR)
    password = serializers.CharField(write_only=True, required=False, allow_blank=False)
    es_admin = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "email", "is_active", "rol", "es_admin", "password", "last_login"]
        read_only_fields = ["last_login"]

    def get_es_admin(self, obj):
        return es_admin(obj)

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        perfil = validated_data.pop("perfil", {})
        password = validated_data.pop("password", None)
        if not password:
            raise serializers.ValidationError({"password": "Escribe una contraseña para el nuevo usuario."})
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        user.perfil.rol = perfil.get("rol", Perfil.COLABORADOR)
        user.perfil.save()
        return user

    def update(self, instance, validated_data):
        perfil = validated_data.pop("perfil", None)
        password = validated_data.pop("password", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        if password:
            instance.set_password(password)
        instance.save()
        if perfil and "rol" in perfil:
            instance.perfil.rol = perfil["rol"]
            instance.perfil.save()
        return instance


class CambioPasswordSerializer(serializers.Serializer):
    actual = serializers.CharField()
    nueva = serializers.CharField()

    def validate(self, data):
        user = self.context["request"].user
        if not user.check_password(data["actual"]):
            raise serializers.ValidationError({"actual": "La contraseña actual no coincide."})
        validate_password(data["nueva"], user)
        return data
