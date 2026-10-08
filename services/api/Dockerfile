# IMPORTANT: Railway build context is the REPOSITORY ROOT (not /services/api).
# Railway Dockerfile path: services/api/Dockerfile; deployment remains tixbam-api.
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY services/api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services/api/app ./app
COPY services/api/seed ./seed
COPY services/mcp/tixbam_mcp ./tixbam_mcp
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
