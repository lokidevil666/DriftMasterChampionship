PYTHON ?= python3

.PHONY: install run test

install:
	$(PYTHON) -m pip install -r requirements.txt

run:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

test:
	pytest -q
