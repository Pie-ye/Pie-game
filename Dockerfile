FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 1000 pie-game \
    && useradd --uid 1000 --gid 1000 --create-home pie-game \
    && mkdir -p /srv/pie-content \
    && chown -R 1000:1000 /app /srv/pie-content

COPY --chown=1000:1000 server/ /app/server/
COPY --chown=1000:1000 site/shell/ /app/site/shell/

USER 1000:1000

EXPOSE 54460 54461

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:54460/healthz', timeout=2)"]

CMD ["python","-m","server.app"]
