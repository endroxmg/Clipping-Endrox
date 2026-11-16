#!/bin/zsh
cd "${0:A:h}" || exit 1
if curl -fsS --max-time 2 http://127.0.0.1:8767/healthz >/dev/null 2>&1; then
  open http://127.0.0.1:8767/app
  exit
fi
runtime=.venv/bin/python
if [[ ! -x "$runtime" ]]; then
  echo 'Install the Python dependencies in .venv first. See README.md.'
  exit 1
fi
( for try in {1..50}; do
    if curl -fsS --max-time 1 http://127.0.0.1:8767/healthz >/dev/null 2>&1; then open http://127.0.0.1:8767/app; break; fi
    sleep .3
  done ) &
PEAKCUT_PORT=8767 exec "$runtime" -m studio.server
