# ---- WeatherGPT production image: React build + FastAPI in one container ----
FROM node:22-alpine AS web
WORKDIR /web
COPY weathergpt/frontend-react/package.json weathergpt/frontend-react/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY weathergpt/frontend-react ./
RUN npm run build

FROM python:3.11-slim AS api
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY weathergpt/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY weathergpt/backend ./backend
COPY weathergpt/demo ./demo
COPY --from=web /web/dist ./frontend-react/dist
# Writable runtime stores (JSON cache, emergency inbox, reports)
VOLUME ["/app/data"]
ENV CACHE_FILE=/app/data/weathergpt_cache.json DEMO_MODE=false PORT=8003
EXPOSE 8003
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://localhost:%d/api/health' % int(os.environ.get('PORT','8003')))"
CMD ["sh", "-c", "cd /app && DEMO_MODE=${DEMO_MODE:-false} CACHE_FILE=${CACHE_FILE} python -m uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8003}"]
