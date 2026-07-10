#!/usr/bin/env sh

# Precompress static text assets after a SIS runtime/public sync.
# Nginx serves the generated files through gzip_static and brotli_static.

set -eu

ADMIN_ROOT=${ADMIN_ROOT:-/home/admin.eagles.edu.vn/public_html}
TEST_ROOT=${TEST_ROOT:-/home/test.eagles.edu.vn/public_html}
ADMIN_URL=${ADMIN_URL:-https://admin.eagles.edu.vn/}
TEST_URL=${TEST_URL:-https://test.eagles.edu.vn/}
SKIP_VERIFY=${SKIP_VERIFY:-0}
GZIP_LEVEL=${GZIP_LEVEL:-6}
BROTLI_LEVEL=${BROTLI_LEVEL:-5}

usage() {
    echo "Usage: $0 admin|test"
    echo "  admin  precompress and verify admin.eagles.edu.vn"
    echo "  test   precompress and verify test.eagles.edu.vn"
}

case "${1:-}" in
    admin)
        MIRROR_LABEL=admin
        MIRROR_ROOT=$ADMIN_ROOT
        MIRROR_URL=$ADMIN_URL
        ;;
    test)
        MIRROR_LABEL=test
        MIRROR_ROOT=$TEST_ROOT
        MIRROR_URL=$TEST_URL
        ;;
    -h|--help)
        usage
        exit 0
        ;;
    *)
        usage >&2
        exit 2
        ;;
esac

if ! command -v gzip >/dev/null 2>&1; then
    echo "ERROR: gzip is required" >&2
    exit 1
fi

if ! command -v brotli >/dev/null 2>&1; then
    echo "ERROR: brotli is required; install it with: sudo apt-get install brotli" >&2
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "ERROR: curl is required for negotiation checks" >&2
    exit 1
fi

case "$GZIP_LEVEL" in
    1|2|3|4|5|6|7|8|9) ;;
    *) echo "ERROR: GZIP_LEVEL must be 1-9" >&2; exit 1 ;;
esac

case "$BROTLI_LEVEL" in
    0|1|2|3|4|5|6|7|8|9|10|11) ;;
    *) echo "ERROR: BROTLI_LEVEL must be 0-11" >&2; exit 1 ;;
esac

if [ ! -d "$MIRROR_ROOT" ]; then
    echo "ERROR: public root does not exist: $MIRROR_ROOT" >&2
    exit 1
fi

compress_root() {
    root=$1
    label=$2
    manifest=$(mktemp)
    stats_file=$(mktemp)
    trap 'rm -f "$manifest" "$stats_file"' 0 1 2 3 15

    find "$root" -type f \
        \( -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.mjs' \
           -o -name '*.json' -o -name '*.svg' -o -name '*.xml' \
           -o -name '*.txt' -o -name '*.webmanifest' \) \
        -print >"$manifest"

    files=0
    gzip_bytes=0
    brotli_bytes=0
    source_bytes=0

    while IFS= read -r file; do
        [ -n "$file" ] || continue

        gzip -n -k -f -"$GZIP_LEVEL" -- "$file"
        brotli -f -q "$BROTLI_LEVEL" -o "$file.br" -- "$file"

        source_size=$(stat -c '%s' "$file")
        gzip_size=$(stat -c '%s' "$file.gz")
        brotli_size=$(stat -c '%s' "$file.br")
        source_bytes=$((source_bytes + source_size))
        gzip_bytes=$((gzip_bytes + gzip_size))
        brotli_bytes=$((brotli_bytes + brotli_size))
        files=$((files + 1))

        file_type=${file##*.}
        printf '%s %s %s %s\n' "$file_type" "$source_size" "$gzip_size" "$brotli_size" >>"$stats_file"
    done <"$manifest"

    rm -f "$manifest"

    echo "[$label] compression totals"
    printf '  %-12s %8s %14s %14s %14s\n' type files source gzip brotli
    printf '  %-12s %8s %14s %14s %14s\n' '------------' '--------' '--------------' '--------------' '--------------'
    awk '
        {
            count[$1]++
            source[$1] += $2
            gzip[$1] += $3
            brotli[$1] += $4
            total_count++
            total_source += $2
            total_gzip += $3
            total_brotli += $4
        }
        function pct(value, total) {
            return total ? int(100 * value / total) : 0
        }
        END {
            for (type in count) {
                printf "  %-12s %8d %14d %10dB (%3d%%) %10dB (%3d%%)\n", \
                    type, count[type], source[type], gzip[type], pct(gzip[type], source[type]), \
                    brotli[type], pct(brotli[type], source[type])
            }
            printf "  %-12s %8d %14d %10dB (%3d%%) %10dB (%3d%%)\n", \
                "TOTAL", total_count, total_source, total_gzip, pct(total_gzip, total_source), \
                total_brotli, pct(total_brotli, total_source)
        }
    ' "$stats_file"

    rm -f "$stats_file"
    trap - 0 1 2 3 15
}

verify_encoding() {
    url=$1
    encoding=$2
    expected=$3
    headers=$(mktemp)
    trap 'rm -f "$headers"' 0 1 2 3 15

    if ! curl -sS --http2 --fail \
        -H "Accept-Encoding: $encoding" \
        -o /dev/null -D "$headers" "$url"; then
        echo "ERROR: request failed for $url with Accept-Encoding: $encoding" >&2
        rm -f "$headers"
        trap - 0 1 2 3 15
        return 1
    fi

    actual=$(awk 'BEGIN { IGNORECASE=1 } /^content-encoding:/ { gsub(/[\r ]/, "", $2); print tolower($2); exit }' "$headers")
    rm -f "$headers"
    trap - 0 1 2 3 15

    if [ "$actual" != "$expected" ]; then
        echo "ERROR: $url expected Content-Encoding: $expected, got: ${actual:-none}" >&2
        return 1
    fi

    echo "[verify] $url encoding=$expected OK"
}

echo "Precompressing SIS web assets"
echo "gzip level=$GZIP_LEVEL, Brotli level=$BROTLI_LEVEL"
compress_root "$MIRROR_ROOT" "$MIRROR_LABEL"

if [ "$SKIP_VERIFY" = "1" ]; then
    echo "[verify] skipped because SKIP_VERIFY=1"
    exit 0
fi

verify_encoding "$MIRROR_URL" br br
verify_encoding "$MIRROR_URL" gzip gzip

echo "Precompression and negotiation verification completed successfully"
