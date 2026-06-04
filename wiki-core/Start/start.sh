#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PORT="${WIKI_CORE_PORT:-3000}"
PID_FILE="$SCRIPT_DIR/.pid"

cd "$PROJECT_DIR"

usage() {
    echo "Usage: bash Start/start.sh [start|stop|restart|status]"
    echo ""
    echo "Commands:"
    echo "  start    Start the wiki-core dev server (default)"
    echo "  stop     Stop the running server"
    echo "  restart  Restart the server"
    echo "  status   Show server status"
}

get_port_pid() {
    lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t 2>/dev/null | head -1 || true
}

is_running() {
    local pid
    pid=$(get_port_pid)
    if [ -n "$pid" ]; then
        return 0
    fi
    # Fallback: check PID file
    if [ -f "$PID_FILE" ]; then
        local file_pid
        file_pid=$(cat "$PID_FILE" 2>/dev/null || true)
        if [ -n "$file_pid" ] && kill -0 "$file_pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

do_start() {
    # Idempotent: if already running, report and exit cleanly
    OCCUPANT_PID=$(get_port_pid)
    if [ -n "$OCCUPANT_PID" ]; then
        echo "pid=$OCCUPANT_PID"
        echo "port=$PORT"
        echo "wiki-core dev server is already running"
        exit 0
    fi

    # Clean up stale PID file
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
        if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
            echo "pid=$OLD_PID"
            echo "port=$PORT"
            echo "wiki-core dev server is already running"
            exit 0
        fi
        rm -f "$PID_FILE"
    fi

    # Install deps if needed
    if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
        echo "[start] Installing dependencies..."
        npm install 2>&1 || { echo "npm install failed" >&2; exit 1; }
    fi

    # Launch dev server in background
    # wiki-core is a library; the dev server is started via node with a launcher script
    # Check if there's a start script in the project or use node directly
    nohup node -e "
        const { startServer } = require('./serve');
        startServer({
            outputRoot: process.env.WIKI_OUTPUT_ROOT || './output',
            buildCommand: process.env.WIKI_BUILD_COMMAND || 'echo no build command',
            watchDirs: (process.env.WIKI_WATCH_DIRS || '').split(',').filter(Boolean),
            port: $PORT,
            mode: process.env.WIKI_MODE || 'build-on-save',
            serverName: 'wiki-core',
        });
    " > "$SCRIPT_DIR/wiki-core.log" 2>&1 &
    DAEMON_PID=$!
    echo "$DAEMON_PID" > "$PID_FILE"

    # Wait for port to become available (max 30s)
    for i in $(seq 1 30); do
        if lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t >/dev/null 2>&1; then
            ACTUAL_PID=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t 2>/dev/null | head -1 || echo "$DAEMON_PID")
            echo "pid=$ACTUAL_PID"
            echo "port=$PORT"
            echo "wiki-core dev server started"
            exit 0
        fi
        sleep 1
    done

    echo "Timed out waiting for port $PORT" >&2
    echo "Check logs: Start/wiki-core.log" >&2
    rm -f "$PID_FILE"
    exit 1
}

do_stop() {
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
        if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
            echo "Stopping wiki-core (pid=$OLD_PID)..."
            kill "$OLD_PID" 2>/dev/null || true
            # Wait for process to exit (max 10s)
            for i in $(seq 1 10); do
                if ! kill -0 "$OLD_PID" 2>/dev/null; then
                    break
                fi
                sleep 1
            done
            if kill -0 "$OLD_PID" 2>/dev/null; then
                echo "Force killing..."
                kill -9 "$OLD_PID" 2>/dev/null || true
            fi
            rm -f "$PID_FILE"
            echo "wiki-core stopped"
            exit 0
        fi
        rm -f "$PID_FILE"
    fi

    # Fallback: kill by port
    OCCUPANT_PID=$(get_port_pid)
    if [ -n "$OCCUPANT_PID" ]; then
        echo "Stopping wiki-core (pid=$OCCUPANT_PID, port=$PORT)..."
        kill "$OCCUPANT_PID" 2>/dev/null || true
        sleep 2
        if kill -0 "$OCCUPANT_PID" 2>/dev/null; then
            kill -9 "$OCCUPANT_PID" 2>/dev/null || true
        fi
        echo "wiki-core stopped"
        exit 0
    fi

    echo "wiki-core is not running"
    exit 0
}

do_restart() {
    do_stop
    sleep 1
    do_start
}

do_status() {
    OCCUPANT_PID=$(get_port_pid)
    if [ -n "$OCCUPANT_PID" ]; then
        echo "wiki-core is running (pid=$OCCUPANT_PID, port=$PORT)"
        exit 0
    fi

    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
        if [ -n "$OLD_PID" ]; then
            if kill -0 "$OLD_PID" 2>/dev/null; then
                echo "wiki-core is running (pid=$OLD_PID, port=unknown)"
                exit 0
            else
                echo "wiki-core is not running (stale pid=$OLD_PID)"
                exit 1
            fi
        fi
    fi

    echo "wiki-core is not running"
    exit 1
}

# Main dispatch
COMMAND="${1:-start}"

case "$COMMAND" in
    start)
        do_start
        ;;
    stop)
        do_stop
        ;;
    restart)
        do_restart
        ;;
    status)
        do_status
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        echo "Unknown command: $COMMAND" >&2
        usage >&2
        exit 1
        ;;
esac
