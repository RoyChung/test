# AI Builder / Koyeb: single process (FastAPI + static Next export). See deployment-prompt.md patterns.
# Build frontend first, then run uvicorn with PORT from the platform.

FROM node:20-alpine AS frontend
WORKDIR /app
COPY chatgpt-clone/package.json chatgpt-clone/package-lock.json ./
RUN npm ci
COPY chatgpt-clone/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY static ./static
COPY --from=frontend /app/out ./chatgpt-clone/out

EXPOSE 8000

CMD sh -c "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"
