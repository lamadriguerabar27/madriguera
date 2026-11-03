from django.contrib.auth import get_user_model
from rest_framework import status, viewsets
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .permissions import EsAdmin
from .serializers import CambioPasswordSerializer, UsuarioSerializer

User = get_user_model()


@api_view(["GET"])
def yo(request):
    return Response(UsuarioSerializer(request.user).data)


@api_view(["POST"])
def cambiar_password(request):
    s = CambioPasswordSerializer(data=request.data, context={"request": request})
    s.is_valid(raise_exception=True)
    request.user.set_password(s.validated_data["nueva"])
    request.user.save()
    return Response({"ok": True})


class UsuarioViewSet(viewsets.ModelViewSet):
    queryset = User.objects.select_related("perfil").order_by("username")
    serializer_class = UsuarioSerializer
    permission_classes = [EsAdmin]

    def destroy(self, request, *args, **kwargs):
        user = self.get_object()
        if user == request.user:
            return Response({"detail": "No puedes desactivar tu propia cuenta."}, status=status.HTTP_400_BAD_REQUEST)
        user.is_active = False
        user.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)
