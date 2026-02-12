python3 -m venv .venv
C:\Users\loki_\Documents\GitHub\DriftMasterChampionship\.venv/bin/activate

pip install -r requirements.txt

cd frontend

npm --prefix frontend install

cd..

npm --prefix frontend run build

python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000