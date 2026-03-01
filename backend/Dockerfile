# FitMe backend image (uv-native, reproducible from uv.lock).
FROM python:3.13-slim

# Bring in the uv binary.
COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# Install dependencies first (cached layer) from the lockfile, without the project.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

# Install the project itself against the locked dependencies.
RUN uv sync --frozen --no-dev

# Use the virtualenv created by uv.
ENV PATH="/app/.venv/bin:$PATH"

# Persisted SQLite database and any imported files live here.
VOLUME ["/app/storage"]

EXPOSE 8000

# Apply migrations, then serve.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
