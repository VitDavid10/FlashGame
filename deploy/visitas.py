#!/usr/bin/env python3
"""Resume el log de acceso de Caddy (deploy/Caddyfile): visitas totales e
IPs distintas por dia. Uso en el VPS:

    python3 deploy/visitas.py
    python3 deploy/visitas.py --dias 7

Lee /var/log/caddy/access.log (y sus rotados access.log.*.gz si hay que
mirar mas atras). No hace falta jq ni nada mas que python3, que ya esta
en el VPS.
"""
import sys, json, gzip, glob
from collections import defaultdict
from datetime import datetime, timezone, timedelta

LOG = '/var/log/caddy/access.log'
dias = int(sys.argv[sys.argv.index('--dias') + 1]) if '--dias' in sys.argv else 14
desde = datetime.now(timezone.utc) - timedelta(days=dias)

por_dia = defaultdict(lambda: {'requests': 0, 'ips': set()})
archivos = sorted(glob.glob(LOG + '*'))
for f in archivos:
    abrir = gzip.open if f.endswith('.gz') else open
    try:
        with abrir(f, 'rt', errors='ignore') as fh:
            for linea in fh:
                try:
                    e = json.loads(linea)
                except ValueError:
                    continue
                ts = e.get('ts')
                if ts is None:
                    continue
                t = datetime.fromtimestamp(ts, tz=timezone.utc)
                if t < desde:
                    continue
                ip = (e.get('request', {}).get('remote_ip')
                      or e.get('request', {}).get('client_ip') or '?')
                dia = t.strftime('%Y-%m-%d')
                por_dia[dia]['requests'] += 1
                por_dia[dia]['ips'].add(ip)
    except FileNotFoundError:
        continue

if not por_dia:
    print('Sin datos aun en', LOG, '(o el fichero no existe todavia: reinicia/recarga Caddy).')
    sys.exit(0)

print(f"{'DIA':<12}{'VISITAS (requests)':<22}{'IPs distintas':<15}")
for dia in sorted(por_dia):
    d = por_dia[dia]
    print(f"{dia:<12}{d['requests']:<22}{len(d['ips']):<15}")
