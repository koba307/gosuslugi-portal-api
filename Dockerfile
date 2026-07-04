FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt portal_api.py config.json ./
COPY data ./data

ENV PORT=8080
EXPOSE 8080

CMD ["python", "portal_api.py"]
