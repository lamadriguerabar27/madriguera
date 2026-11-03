# 1) Compilar la app de React
FROM node:20-alpine AS frontend
WORKDIR /front
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 2) Backend de Django que sirve la API y la app compilada
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY --from=frontend /front/dist ./frontend_dist
RUN SECRET_KEY=solo-para-compilar python manage.py collectstatic --noinput \
    && useradd --create-home madriguera && mkdir -p /app/media && chown -R madriguera /app/media
USER madriguera
EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py crear_admin && gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-3} --timeout 60"]
