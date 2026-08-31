#!/usr/bin/env bash
# Generate the kontier-ri 100M-row scale-proof dataset (billing_events).
# 24 hive partitions (month=2024-01 .. month=2025-12), ZSTD, row groups of 1M rows.
# Requires the DuckDB CLI (`brew install duckdb`). Deterministic via per-month setseed.
#
# Usage: ./scripts/generate-scale-data.sh [OUT_DIR] [TOTAL_ROWS]
set -euo pipefail

OUT_DIR="${1:-/tmp/kontier-scale-data}"
TOTAL_ROWS="${2:-100000000}"
MONTHS=24
mkdir -p "$OUT_DIR/events"

# Linear month-over-month growth: n_m = base + slope*m, adjusted so the sum is exactly TOTAL_ROWS.
BASE=$(( TOTAL_ROWS * 624 / 1000 / MONTHS ))   # first month ~62.4% of the flat average
read -r -a COUNTS <<< "$(python3 - "$TOTAL_ROWS" "$MONTHS" "$BASE" <<'PY'
import sys
total, months, base = map(int, sys.argv[1:4])
slope = (total - months * base) / (months * (months - 1) / 2)
counts = [base + round(slope * m) for m in range(months)]
counts[-1] += total - sum(counts)
print(" ".join(map(str, counts)))
PY
)"

GRAND_TOTAL=0
for m in $(seq 0 $((MONTHS - 1))); do
  MONTH=$(python3 -c "import sys;y,mo=2024+int(sys.argv[1])//12,int(sys.argv[1])%12+1;print(f'{y}-{mo:02d}')" "$m")
  N=${COUNTS[$m]}
  GRAND_TOTAL=$((GRAND_TOTAL + N))
  DIR="$OUT_DIR/events/month=$MONTH"
  FILE="$DIR/part-0.parquet"
  if [ -f "$FILE" ]; then echo "skip $MONTH (exists)"; continue; fi
  mkdir -p "$DIR"
  SEED=$(python3 -c "print(($m + 1) / 100)")
  echo "generating month=$MONTH rows=$N ..."
  duckdb -c "
SET threads=10;
SELECT setseed($SEED);
COPY (
  SELECT
    event_ts,
    customer_id,
    ['DE','DE','DE','DE','DE','DE','DE','DE','DE','DE','DE',
     'US','US','US','US','US','US','US','US','US','US',
     'GB','GB','GB','GB','GB','GB','FR','FR','FR','FR','FR',
     'NL','NL','NL','NL','SE','SE','SE','PL','PL','PL',
     'ES','ES','ES','IT','IT','IT','CH','CH'][country_i] AS country,
    ['starter','starter','starter','starter','growth','growth','growth','scale','scale','enterprise'][plan_i] AS plan,
    ['stripe','stripe','stripe','stripe','stripe','stripe','stripe','stripe','stripe','stripe','stripe',
     'adyen','adyen','adyen','adyen','paypal','paypal','paypal','wire','wire'][gateway_i] AS gateway,
    CASE
      WHEN r_status < CASE gateway_i
        WHEN 19 THEN 0.115 WHEN 20 THEN 0.115           -- wire
        WHEN 16 THEN 0.068 WHEN 17 THEN 0.068 WHEN 18 THEN 0.068  -- paypal
        WHEN 12 THEN 0.034 WHEN 13 THEN 0.034 WHEN 14 THEN 0.034 WHEN 15 THEN 0.034 -- adyen
        ELSE 0.021 END                                   -- stripe
      THEN 'failed'
      WHEN r_status > 0.98 THEN 'refunded'
      ELSE 'succeeded'
    END AS status,
    CAST([2900,2900,2900,2900,9900,9900,9900,29900,29900,99000][plan_i]
      * [1.0,1.0,1.0,1.0,1.0,1.0,0.95,0.9,0.85,0.8][disc_i] AS BIGINT) AS amount_cents
  FROM (
    SELECT
      date_trunc('minute', TIMESTAMP '$MONTH-01' + INTERVAL (CAST(floor(random() * date_diff('second', TIMESTAMP '$MONTH-01', TIMESTAMP '$MONTH-01' + INTERVAL 1 MONTH)) AS BIGINT)) SECOND) AS event_ts,
      1 + CAST(floor(random() * 2000000) AS BIGINT) AS customer_id,
      1 + CAST(floor(random() * 50) AS INT) AS country_i,
      1 + CAST(floor(random() * 10) AS INT) AS plan_i,
      1 + CAST(floor(random() * 20) AS INT) AS gateway_i,
      1 + CAST(floor(random() * 10) AS INT) AS disc_i,
      random() AS r_status
    FROM (SELECT unnest(generate_series(1::BIGINT, ${N}::BIGINT)) AS i)
  )
  ORDER BY event_ts
) TO '$FILE' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 1000000);
"
done

echo "grand total rows: $GRAND_TOTAL"
echo "verifying with DuckDB ..."
duckdb -c "
SELECT count(*) AS total_rows FROM read_parquet('$OUT_DIR/events/month=*/part-0.parquet', hive_partitioning=1);
SELECT country, ROUND(SUM(amount_cents)/100.0/1e6, 1) AS revenue_m, count(*) AS n
FROM read_parquet('$OUT_DIR/events/month=*/part-0.parquet', hive_partitioning=1)
WHERE status = 'succeeded' GROUP BY country ORDER BY revenue_m DESC;
"
du -sh "$OUT_DIR/events"
