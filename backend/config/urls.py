from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404, JsonResponse
from django.urls import include, path, re_path
from django.views.static import serve
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView


def salud(_request):
    return JsonResponse({"ok": True})


def app_react(_request):
    """Devuelve index.html de la app para cualquier ruta que no sea de la API (navegación del lado del cliente)."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        raise Http404("La app no está compilada. En desarrollo usa npm run dev en frontend/.")
    return FileResponse(open(index, "rb"), content_type="text/html")


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/salud/", salud),
    path("api/auth/login/", TokenObtainPairView.as_view(), name="login"),
    path("api/auth/refresh/", TokenRefreshView.as_view(), name="refresh"),
    path("api/", include("cuentas.urls")),
    path("api/", include("finanzas.urls")),
    path("api/", include("costos.urls")),
    path("api/", include("personal.urls")),
]

if settings.DEBUG:
    urlpatterns += [path("media/<path:path>", serve, {"document_root": settings.MEDIA_ROOT})]

urlpatterns += [re_path(r"^(?!api/|admin/|static/|media/).*$", app_react)]
