# One-origin KitchenSync deployment: build Vite, serve with FastAPI.
# Keep the frontend API base unset for the hosted website so /api stays same-origin.
FROM node:24-bookworm-slim AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_BASE_URL=""
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY --from=frontend-builder /build/frontend/dist/ ./frontend/dist/
RUN mkdir -p /var/data
EXPOSE 10000
CMD ["sh", "-c", "python -m uvicorn app:app --app-dir backend --host 0.0.0.0 --port ${PORT:-10000}"]
