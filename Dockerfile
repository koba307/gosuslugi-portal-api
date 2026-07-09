FROM python:3.12-slim

WORKDIR /app

# API
COPY requirements.txt portal_api.py config.json ./
COPY data ./data

# Frontend (portal + admin + assets)
COPY index.html verification.html admin.html app.js admin.js favicon.ico ./
COPY portal-*.css portal-*.js admin.css admin-photo-editor.js ./
COPY copi_files ./copi_files

ENV PORT=8080
ENV PORTAL_DATA_DIR=/data
EXPOSE 8080

CMD ["python", "portal_api.py"]
