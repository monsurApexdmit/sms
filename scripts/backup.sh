#!/usr/bin/env bash
# Database and uploads backups for the school management system.
#
#   backup.sh [once]              one backup now (default)
#   backup.sh loop                backup every BACKUP_INTERVAL_HOURS (the docker-compose `backup` service)
#   backup.sh check               exit 0 if the last backup succeeded within 2 intervals (health check)
#   backup.sh restore FILE --yes  load a .sql.gz dump into the database (overwrites its tables)
#
# Settings (environment):
#   DATABASE_URL           mysql+pymysql://user:password@host:port/db?... (as used by the API), or
#   DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME, which override the matching parts of DATABASE_URL
#   BACKUP_ROOT            where backups go (default /backups)
#   UPLOADS_DIR            uploads folder to archive (default /data/uploads)
#   BACKUP_INTERVAL_HOURS  hours between backups in loop mode (default 24)
#   BACKUP_START_DELAY     seconds before the first backup in loop mode (default 120)
#   BACKUP_KEEP_DAILY      daily backups kept (default 14)
#   BACKUP_KEEP_WEEKLY     weekly backups kept (default 8)
#   BACKUP_WEEKLY_DAY      day of week (1 = Monday ... 7 = Sunday) whose backup is also kept as weekly (default 7)
#   BACKUP_UPLOADS         daily | weekly | off: how often the uploads folder is archived (default weekly)
#
# Layout:  $BACKUP_ROOT/daily/sms-YYYY-MM-DD_HHMM.sql.gz   (+ uploads-....tar.gz when BACKUP_UPLOADS=daily)
#          $BACKUP_ROOT/weekly/...                          (hard links to the weekly day's files)
#          $BACKUP_ROOT/.last_success                       (time of the last good backup)
#
# The password is passed to mysqldump in a temporary option file readable only by this
# process, never on the command line. Legacy MyISAM tables are not covered by
# --single-transaction; dumps taken while the old app writes may be slightly inconsistent
# across those tables.

set -Eeuo pipefail
umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-/data/uploads}"
BACKUP_INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
BACKUP_START_DELAY="${BACKUP_START_DELAY:-120}"
BACKUP_KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}"
BACKUP_KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}"
BACKUP_WEEKLY_DAY="${BACKUP_WEEKLY_DAY:-7}"
BACKUP_UPLOADS="${BACKUP_UPLOADS:-weekly}"

log() { printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

urldecode() { printf '%b' "${1//%/\\x}"; }

# Fill DB_* from DATABASE_URL; explicit DB_* variables win.
read_db_settings() {
    local url creds hostport path user="" password="" host="" port="" name=""
    if [[ -n "${DATABASE_URL:-}" ]]; then
        url="${DATABASE_URL#*://}"
        if [[ "$url" == *@* ]]; then
            creds="${url%@*}"  # up to the last "@"
            url="${url##*@}"
            user="$(urldecode "${creds%%:*}")"
            [[ "$creds" == *:* ]] && password="$(urldecode "${creds#*:}")"
        fi
        hostport="${url%%/*}"
        path="${url#*/}"
        [[ "$path" == "$url" ]] && path=""
        name="$(urldecode "${path%%\?*}")"
        host="${hostport%%:*}"
        [[ "$hostport" == *:* ]] && port="${hostport##*:}"
    fi
    DB_HOST="${DB_HOST:-${host:-127.0.0.1}}"
    DB_PORT="${DB_PORT:-${port:-3306}}"
    DB_USER="${DB_USER:-$user}"
    DB_PASSWORD="${DB_PASSWORD:-$password}"
    DB_NAME="${DB_NAME:-$name}"
    [[ -n "$DB_USER" && -n "$DB_NAME" ]] || die "set DATABASE_URL (or DB_USER and DB_NAME)"
}

# Option file with the credentials; removed on exit.
write_option_file() {
    local escaped="${DB_PASSWORD//\\/\\\\}"
    escaped="${escaped//\"/\\\"}"
    OPTION_FILE="$(mktemp)"
    trap 'rm -f "$OPTION_FILE"' EXIT
    printf '[client]\nuser="%s"\npassword="%s"\nhost="%s"\nport=%s\n' "$DB_USER" "$escaped" "$DB_HOST" "$DB_PORT" >"$OPTION_FILE"
}

dump_command() {
    local bin
    bin="$(command -v mysqldump || command -v mariadb-dump)" || die "mysqldump is not installed"
    DUMP=("$bin" --defaults-extra-file="$OPTION_FILE" --single-transaction --routines --triggers --hex-blob
          --no-tablespaces --default-character-set=utf8mb4)
    local help
    help="$("$bin" --help 2>/dev/null || true)"
    # MySQL 8+ clients: don't query column statistics (fails against MariaDB) or write GTID state.
    [[ "$help" == *column-statistics* ]] && DUMP+=(--column-statistics=0)
    [[ "$help" == *set-gtid-purged* ]] && DUMP+=(--set-gtid-purged=OFF)
    DUMP+=("$DB_NAME")
}

prune() {  # prune DIR PATTERN KEEP: delete all but the newest KEEP files matching PATTERN
    local dir="$1" pattern="$2" keep="$3"
    find "$dir" -maxdepth 1 -type f -name "$pattern" -printf '%T@ %p\n' 2>/dev/null \
        | sort -rn | tail -n +"$((keep + 1))" | cut -d' ' -f2- | while read -r old; do
            log "removing old backup $old"
            rm -f -- "$old"
        done
}

backup_once() {
    read_db_settings
    write_option_file
    dump_command
    local stamp weekly=0 daily_dir="$BACKUP_ROOT/daily" weekly_dir="$BACKUP_ROOT/weekly"
    stamp="$(date +%Y-%m-%d_%H%M)"
    [[ "$(date +%u)" == "$BACKUP_WEEKLY_DAY" ]] && weekly=1
    mkdir -p "$daily_dir" "$weekly_dir"

    local dump="$daily_dir/sms-$stamp.sql.gz"
    log "dumping database $DB_NAME from $DB_HOST:$DB_PORT"
    "${DUMP[@]}" | gzip -c >"$dump.tmp"
    gzip -t "$dump.tmp" || die "dump archive is corrupt"
    mv "$dump.tmp" "$dump"
    log "wrote $dump ($(du -h "$dump" | cut -f1))"

    local uploads_dir=""
    if [[ -d "$UPLOADS_DIR" ]]; then
        case "$BACKUP_UPLOADS" in
            daily) uploads_dir="$daily_dir" ;;
            # weekly, plus the very first run so there is always one copy
            weekly) if [[ $weekly == 1 ]] || ! compgen -G "$weekly_dir/uploads-*.tar.gz" >/dev/null; then uploads_dir="$weekly_dir"; fi ;;
            off) ;;
            *) die "BACKUP_UPLOADS must be daily, weekly or off" ;;
        esac
    fi
    if [[ -n "$uploads_dir" ]]; then
        local archive="$uploads_dir/uploads-$stamp.tar.gz"
        log "archiving $UPLOADS_DIR"
        tar -czf "$archive.tmp" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
        mv "$archive.tmp" "$archive"
        log "wrote $archive ($(du -h "$archive" | cut -f1))"
    fi

    if [[ $weekly == 1 ]]; then
        ln -f "$dump" "$weekly_dir/"
        [[ "$uploads_dir" == "$daily_dir" ]] && ln -f "$daily_dir/uploads-$stamp.tar.gz" "$weekly_dir/"
    fi
    prune "$daily_dir" 'sms-*.sql.gz' "$BACKUP_KEEP_DAILY"
    prune "$daily_dir" 'uploads-*.tar.gz' "$BACKUP_KEEP_DAILY"
    prune "$weekly_dir" 'sms-*.sql.gz' "$BACKUP_KEEP_WEEKLY"
    prune "$weekly_dir" 'uploads-*.tar.gz' "$BACKUP_KEEP_WEEKLY"
    date +%s >"$BACKUP_ROOT/.last_success"
    log "done"
}

check() {
    local last now
    last="$(cat "$BACKUP_ROOT/.last_success" 2>/dev/null || echo 0)"
    now="$(date +%s)"
    # healthy until two intervals (plus the start delay) pass without a good backup
    if [[ "$last" == 0 ]]; then
        local started
        started="$(stat -c %Y /proc/1 2>/dev/null || echo "$now")"
        (( now - started < BACKUP_START_DELAY + 2 * BACKUP_INTERVAL_HOURS * 3600 ))
    else
        (( now - last < 2 * BACKUP_INTERVAL_HOURS * 3600 ))
    fi
}

restore() {
    local file="${1:-}" confirm="${2:-}"
    [[ -f "$file" ]] || die "usage: backup.sh restore FILE.sql.gz --yes"
    [[ "$confirm" == "--yes" ]] || die "restoring replaces the tables in the database; add --yes to confirm"
    read_db_settings
    write_option_file
    local bin
    bin="$(command -v mysql || command -v mariadb)" || die "mysql client is not installed"
    log "restoring $file into $DB_NAME on $DB_HOST:$DB_PORT"
    gunzip -c "$file" | "$bin" --defaults-extra-file="$OPTION_FILE" --default-character-set=utf8mb4 "$DB_NAME"
    log "restore finished"
}

case "${1:-once}" in
    once) backup_once ;;
    loop)
        log "first backup in ${BACKUP_START_DELAY}s, then every ${BACKUP_INTERVAL_HOURS}h"
        sleep "$BACKUP_START_DELAY"
        while true; do
            # a failed run is logged and retried next interval; `check` reports it unhealthy
            ( backup_once ) || log "ERROR: backup failed"
            sleep "$((BACKUP_INTERVAL_HOURS * 3600))"
        done
        ;;
    check) check ;;
    restore) restore "${2:-}" "${3:-}" ;;
    *) die "usage: backup.sh [once|loop|check|restore FILE --yes]" ;;
esac
