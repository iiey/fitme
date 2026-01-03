# StraStat — developer convenience targets.
# Run `make help` to list available commands.

# Use bash for recipes.
SHELL := /bin/bash

BACKEND  := backend
FRONTEND := frontend
SAMPLE   := sample-data/strava-export

# Default Strava export to import (override: `make import SOURCE=/path/to/export.zip`).
SOURCE ?= $(SAMPLE)

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help.
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

.PHONY: install
install: install-backend install-frontend ## Install backend and frontend dependencies.

.PHONY: install-backend
install-backend: ## Create the backend venv and install deps from uv.lock.
	cd $(BACKEND) && uv sync

.PHONY: install-frontend
install-frontend: ## Install frontend node modules.
	cd $(FRONTEND) && npm install

# ---------------------------------------------------------------------------
# Database & data
# ---------------------------------------------------------------------------

.PHONY: migrate
migrate: ## Apply database migrations (creates the SQLite DB).
	cd $(BACKEND) && uv run alembic upgrade head

.PHONY: sample-data
sample-data: ## Generate a synthetic Strava export under sample-data/.
	cd $(BACKEND) && uv run python scripts/generate_sample_export.py

.PHONY: import
import: ## Import a Strava export. Override with `make import SOURCE=/path/export.zip`.
	cd $(BACKEND) && uv run python -m app.cli import ../$(SOURCE)

.PHONY: seed
seed: migrate sample-data ## Migrate, generate sample data and import it.
	cd $(BACKEND) && uv run python -m app.cli import ../$(SAMPLE)

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

.PHONY: backend
backend: ## Run the FastAPI backend (http://localhost:8000).
	cd $(BACKEND) && uv run uvicorn app.main:app --reload --port 8000

.PHONY: frontend
frontend: ## Run the Next.js frontend (http://localhost:3000).
	cd $(FRONTEND) && npm run dev

.PHONY: dev
dev: ## Run backend and frontend together (Ctrl-C stops both).
	@echo "Starting backend on :8000 and frontend on :3000…"
	@trap 'kill 0' EXIT; \
		( cd $(BACKEND) && uv run uvicorn app.main:app --port 8000 ) & \
		( cd $(FRONTEND) && npm run dev ) & \
		wait

# ---------------------------------------------------------------------------
# Quality
# ---------------------------------------------------------------------------

.PHONY: test
test: ## Run backend tests.
	cd $(BACKEND) && uv run pytest

.PHONY: lint
lint: ## Lint backend (ruff) and frontend (eslint + tsc).
	cd $(BACKEND) && uv run ruff check app
	cd $(FRONTEND) && npm run lint && npm run typecheck

.PHONY: format
format: ## Auto-fix backend lint issues.
	cd $(BACKEND) && uv run ruff check app --fix

.PHONY: build
build: ## Production-build the frontend.
	cd $(FRONTEND) && npm run build

.PHONY: check
check: lint test build ## Run all checks (lint, tests, build).

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------

.PHONY: docker-up
docker-up: ## Build and start both services with Docker Compose.
	docker compose up --build

.PHONY: docker-down
docker-down: ## Stop and remove Docker Compose services.
	docker compose down

# ---------------------------------------------------------------------------
# Housekeeping
# ---------------------------------------------------------------------------

.PHONY: clean
clean: ## Remove caches, build artifacts and the local database.
	rm -rf $(BACKEND)/.venv $(BACKEND)/.ruff_cache $(BACKEND)/.pytest_cache
	rm -rf $(BACKEND)/storage/*.db
	rm -rf $(FRONTEND)/.next $(FRONTEND)/node_modules
	find $(BACKEND) -type d -name __pycache__ -prune -exec rm -rf {} +
