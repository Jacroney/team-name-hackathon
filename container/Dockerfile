FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl fuse3 util-linux \
    && rm -rf /var/lib/apt/lists/*

RUN architecture="$(dpkg --print-architecture)" \
    && version="$(curl --fail --silent --show-error https://api.github.com/repos/tigrisdata/tigrisfs/releases/latest | python -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')" \
    && curl --fail --location --show-error \
      "https://github.com/tigrisdata/tigrisfs/releases/download/${version}/tigrisfs_${version#v}_linux_${architecture}.tar.gz" \
      --output /tmp/tigrisfs.tar.gz \
    && tar -xzf /tmp/tigrisfs.tar.gz -C /usr/local/bin \
    && chmod +x /usr/local/bin/tigrisfs \
    && rm /tmp/tigrisfs.tar.gz

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt

COPY server.py startup.sh ./
RUN chmod +x /app/startup.sh

EXPOSE 8080
CMD ["/app/startup.sh"]
