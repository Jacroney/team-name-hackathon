#!/bin/sh
set -eu

: "${AWS_ACCESS_KEY_ID:?missing R2 access key}"
: "${AWS_SECRET_ACCESS_KEY:?missing R2 secret key}"
: "${R2_ACCOUNT_ID:?missing R2 account ID}"
: "${R2_BUCKET_NAME:?missing R2 bucket name}"

mkdir -p /mnt/r2
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
/usr/local/bin/tigrisfs --endpoint "${endpoint}" -o ro -f "${R2_BUCKET_NAME}" /mnt/r2 &

attempt=0
until mountpoint -q /mnt/r2; do
  attempt=$((attempt + 1))
  if [ "${attempt}" -ge 30 ]; then
    exit 1
  fi
  sleep 1
done

exec python /app/server.py
