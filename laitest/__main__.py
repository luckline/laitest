from __future__ import annotations

import argparse
import sys

from .cli import run_cli
from .server import serve


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)

    # Default behavior: run the web server (TestHub-like UX).
    # Provide `cli` subcommand for environments where binding a port is not allowed.
    if not argv or (argv and argv[0] not in ("serve", "cli")):
        argv = ["serve", *argv]

    ap = argparse.ArgumentParser(prog="laitest")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("serve", help="Run web UI + JSON API server")
    sp.add_argument("--host", default="127.0.0.1")
    sp.add_argument("--port", type=int, default=8080)

    sub.add_parser("cli", help="Run CLI commands (no server)")

    args, rest = ap.parse_known_args(argv)
    if args.cmd == "serve":
        try:
            serve(host=args.host, port=args.port)
            return 0
        except PermissionError as e:
            sys.stderr.write(
                "ERROR: cannot bind/listen on a TCP port in this environment.\n"
                "Try running in a normal terminal, or use `python3 -m laitest cli ...`.\n"
                f"Details: {e}\n"
            )
            return 2
    if args.cmd == "cli":
        return run_cli(rest)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
