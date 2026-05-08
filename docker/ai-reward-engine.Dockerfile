FROM python:3.12-slim AS base
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

COPY apps/ai-reward-engine/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/ai-reward-engine/ ./

FROM base AS runner
RUN useradd -r -s /bin/false scatterx
USER scatterx
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
