# syntax=docker/dockerfile:1

FROM python:3.13-slim
WORKDIR /app

# Copy the constraints file next to requirements.txt so pip can resolve the
# relative `-c constraints-tested.txt` reference on requirements.txt line 1.
COPY backend/requirements.txt backend/constraints-tested.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ /app/backend/

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
