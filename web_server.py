from __future__ import annotations

import argparse
import json
import os
import re
import string
import threading
import webbrowser
from concurrent.futures import ProcessPoolExecutor, as_completed
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import generate_cathay_fcn_dashboard as gen


PROJECT_DIR = Path(__file__).resolve().parent
WEB_DIR = PROJECT_DIR / "web"
CACHE_PATH = PROJECT_DIR / ".cache" / "pdf_rows.json"
DEFAULT_STOCK_ID = "2330"
DASHBOARD_NAME_RE = re.compile(r"^(?P<stock_id>.+)_(?P<product>[a-z]+)_dashboard\.html$")

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
}
OUTPUT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
ALLOWED_HOSTS = {"127.0.0.1", "localhost"}


class ApiError(Exception):
    def __init__(self, message: str, status: HTTPStatus = HTTPStatus.BAD_REQUEST):
        super().__init__(message)
        self.status = status


def parse_pdf(path: str) -> tuple[list[dict], str | None]:
    """Process-pool worker: returns (rows, error)."""
    try:
        return gen.extract_rows_from_pdf(Path(path)), None
    except Exception as exc:  # noqa: BLE001 - surface any PDF failure to the UI
        return [], f"{type(exc).__name__}: {exc}"


class PdfRowCache:
    """Parsed rows per PDF, keyed by absolute path and invalidated by mtime/size."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.entries: dict[str, dict] = {}
        if path.exists():
            try:
                self.entries = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                self.entries = {}

    @staticmethod
    def _key(pdf: Path) -> tuple[str, int, int]:
        stat = pdf.stat()
        return str(pdf.resolve()), stat.st_mtime_ns, stat.st_size

    def lookup(self, pdf: Path) -> dict | None:
        key, mtime_ns, size = self._key(pdf)
        with self.lock:
            entry = self.entries.get(key)
        if entry and entry["mtime_ns"] == mtime_ns and entry["size"] == size:
            return entry
        return None

    def store(self, pdf: Path, rows: list[dict], error: str | None) -> dict:
        key, mtime_ns, size = self._key(pdf)
        entry = {"mtime_ns": mtime_ns, "size": size, "rows": rows, "error": error}
        with self.lock:
            self.entries[key] = entry
        return entry

    def save(self) -> None:
        with self.lock:
            data = json.dumps(self.entries, ensure_ascii=False)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(data, encoding="utf-8")
        tmp.replace(self.path)


def summarize_entry(entry: dict) -> dict:
    stocks: dict[str, dict] = {}
    for row in entry["rows"]:
        info = stocks.setdefault(row["stock_id"], {"name": row["stock_name"], "products": []})
        if row["product_type"] not in info["products"]:
            info["products"].append(row["product_type"])
    first = entry["rows"][0] if entry["rows"] else {}
    return {
        "rows": len(entry["rows"]),
        "stocks": stocks,
        "quote_start_date": first.get("quote_start_date"),
        "quote_end_date": first.get("quote_end_date"),
        "error": entry["error"],
    }


def build_compare_model(rows: list[dict], product_type: str) -> dict:
    """Max coupon rate per (stock, date, lower, upper) across every stock, for the compare page."""
    stocks: dict[str, str] = {}
    best: dict[tuple, float] = {}
    for row in rows:
        if row["product_type"] != product_type:
            continue
        date = row["quote_start_date"] or row["quote_end_date"]
        lower, upper, rate = row["lower_bound_pct"], row["upper_bound_pct"], row["coupon_rate_pct"]
        if date is None or lower is None or upper is None or rate is None:
            continue
        stocks.setdefault(row["stock_id"], row["stock_name"])
        key = (row["stock_id"], date, lower, upper)
        if key not in best or rate > best[key]:
            best[key] = rate
    return {
        "product_type": product_type,
        "stocks": dict(sorted(stocks.items())),
        "dates": sorted({key[1] for key in best}),
        # [stock_id, date, lower_bound_pct, upper_bound_pct, coupon_rate_pct]
        "quotes": [[*key, rate] for key, rate in sorted(best.items())],
    }


class ScanJob:
    """Parses every PDF in one directory in the background, using the cache when possible."""

    def __init__(self, directory: Path, cache: PdfRowCache):
        self.directory = directory
        self.cache = cache
        self.pdfs = sorted(directory.glob("*.pdf"))
        self.files: dict[str, dict] = {}
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    @property
    def running(self) -> bool:
        return self.thread.is_alive()

    def _record(self, pdf: Path, entry: dict) -> None:
        with self.lock:
            self.files[pdf.name] = summarize_entry(entry)

    def _run(self) -> None:
        pending = []
        for pdf in self.pdfs:
            entry = self.cache.lookup(pdf)
            if entry:
                self._record(pdf, entry)
            else:
                pending.append(pdf)
        if not pending:
            return

        workers = max(1, min(len(pending), (os.cpu_count() or 2) - 1))
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(parse_pdf, str(pdf)): pdf for pdf in pending}
            for done, future in enumerate(as_completed(futures), start=1):
                pdf = futures[future]
                rows, error = future.result()
                self._record(pdf, self.cache.store(pdf, rows, error))
                if done % 8 == 0:
                    self.cache.save()
        self.cache.save()

    def status(self) -> dict:
        with self.lock:
            files = dict(self.files)
        return {
            "dir": str(self.directory),
            "total": len(self.pdfs),
            "done": len(files),
            "running": self.running,
            "files": files,
        }

    def rows(self) -> list[dict]:
        self.thread.join()
        rows: list[dict] = []
        for pdf in self.pdfs:
            entry = self.cache.lookup(pdf) or self.cache.store(pdf, *parse_pdf(str(pdf)))
            rows.extend(entry["rows"])
        return rows


class App:
    def __init__(self, input_dir: Path, output_dir: Path, stock_id: str, product: str = "fcn"):
        self.defaults = {
            "input_dir": str(input_dir),
            "output_dir": str(output_dir),
            "stock_id": stock_id,
            "product": product,
            "products": [{"code": code, **info} for code, info in gen.PRODUCTS.items()],
        }
        self.cache = PdfRowCache(CACHE_PATH)
        self.jobs: dict[str, ScanJob] = {}
        self.jobs_lock = threading.Lock()
        self.generate_lock = threading.Lock()

    def scan_job(self, directory: Path, restart_if_stale: bool = True) -> ScanJob:
        key = str(directory.resolve())
        with self.jobs_lock:
            job = self.jobs.get(key)
            stale = job is not None and not job.running and restart_if_stale and (
                sorted(directory.glob("*.pdf")) != job.pdfs
                or any(self.cache.lookup(pdf) is None for pdf in job.pdfs)
            )
            if job is None or stale:
                job = ScanJob(directory, self.cache)
                self.jobs[key] = job
            return job

    def compare(self, input_dir: Path, product: str) -> dict:
        if product not in gen.PRODUCTS:
            raise ApiError(f"未知的商品類型：{product}")
        model = build_compare_model(self.scan_job(input_dir).rows(), gen.PRODUCTS[product]["product_type"])
        return {"dir": str(input_dir), "product": product, **model}

    def generate(self, input_dir: Path, output_dir: Path, stock_id: str, product: str) -> dict:
        if product not in gen.PRODUCTS:
            raise ApiError(f"未知的商品類型：{product}")
        rows = self.scan_job(input_dir).rows()
        if not rows:
            raise ApiError("來源目錄中沒有可解析的報價資料。")
        if not any(row["stock_id"] == stock_id for row in rows):
            raise ApiError(f"來源目錄中找不到股票 {stock_id} 的報價。")
        with self.generate_lock:
            try:
                result = gen.write_outputs(
                    input_dir, output_dir, stock_id=stock_id, rows=rows, product=product
                )
            except gen.NoQuotesError as exc:
                raise ApiError(str(exc)) from exc
            except PermissionError as exc:
                raise ApiError(f"無法寫入輸出檔（是否正在 Excel 中開啟？）：{exc.filename}") from exc
        return {
            "rows": result["rows"],
            "series": result["series"],
            "dates": result["dates"],
            "html": result["html"].name,
            "excel": result["excel"].name,
        }


def resolve_dir(value: str | None, must_exist: bool = True) -> Path:
    if not value or not value.strip():
        raise ApiError("請輸入目錄。")
    path = Path(value.strip().strip('"')).expanduser()
    if not path.is_absolute():
        path = (PROJECT_DIR / path).resolve()
    if must_exist and not path.is_dir():
        raise ApiError(f"目錄不存在：{path}", HTTPStatus.NOT_FOUND)
    return path


def list_drives() -> list[str]:
    return [f"{letter}:\\" for letter in string.ascii_uppercase if Path(f"{letter}:\\").exists()]


def browse(value: str | None) -> dict:
    if not value:
        return {"dir": "", "parent": None, "dirs": [{"name": d, "path": d} for d in list_drives()], "pdfs": []}
    directory = resolve_dir(value)
    dirs, pdfs = [], []
    try:
        children = sorted(directory.iterdir(), key=lambda p: p.name.lower())
    except PermissionError as exc:
        raise ApiError(f"無法讀取目錄：{directory}", HTTPStatus.FORBIDDEN) from exc
    for child in children:
        try:
            if child.is_dir():
                if not child.name.startswith((".", "$")):
                    dirs.append({"name": child.name, "path": str(child)})
            elif child.suffix.lower() == ".pdf":
                stat = child.stat()
                pdfs.append({"name": child.name, "size": stat.st_size, "mtime": stat.st_mtime})
        except OSError:
            continue
    parent = directory.parent
    return {
        "dir": str(directory),
        # At a drive root, "up" goes to the drive list.
        "parent": "" if parent == directory else str(parent),
        "dirs": dirs,
        "pdfs": pdfs,
    }


def list_outputs(value: str | None) -> dict:
    directory = resolve_dir(value, must_exist=False)
    dashboards = []
    if directory.is_dir():
        for html_path in directory.glob("*_dashboard.html"):
            match = DASHBOARD_NAME_RE.match(html_path.name)
            if not match or match["product"] not in gen.PRODUCTS:
                continue
            stock_id = match["stock_id"]
            excel = directory / f"cathay_fcn_{stock_id}_rates.xlsx"
            dashboards.append(
                {
                    "stock_id": stock_id,
                    "product": match["product"],
                    "product_label": gen.PRODUCTS[match["product"]]["label"],
                    "html": html_path.name,
                    "excel": excel.name if excel.exists() else None,
                    "mtime": html_path.stat().st_mtime,
                }
            )
    order = list(gen.PRODUCTS)
    dashboards.sort(key=lambda item: (item["stock_id"], order.index(item["product"])))
    return {"dir": str(directory), "dashboards": dashboards}


def output_file(dir_value: str | None, name: str | None) -> Path:
    directory = resolve_dir(dir_value)
    if not name or Path(name).name != name or Path(name).suffix.lower() not in OUTPUT_TYPES:
        raise ApiError("不允許的檔案。", HTTPStatus.FORBIDDEN)
    path = directory / name
    if not path.is_file():
        raise ApiError(f"檔案不存在：{path}", HTTPStatus.NOT_FOUND)
    return path


def make_handler(app: App) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args) -> None:  # noqa: A002
            if not self.path.startswith("/api/scan"):
                super().log_message(format, *args)

        def _host_ok(self) -> bool:
            # Guards against DNS-rebinding pages driving this local API.
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
            return host in ALLOWED_HOSTS

        def _send(self, status: HTTPStatus, body: bytes, content_type: str, extra: dict | None = None) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self._send(status, body, "application/json; charset=utf-8")

        def _dispatch(self, method: str) -> None:
            if not self._host_ok():
                self._json({"error": "Forbidden host"}, HTTPStatus.FORBIDDEN)
                return
            url = urlparse(self.path)
            query = {key: values[0] for key, values in parse_qs(url.query).items()}
            try:
                if method == "POST" and url.path == "/api/generate":
                    length = int(self.headers.get("Content-Length") or 0)
                    payload = json.loads(self.rfile.read(length) or b"{}")
                    stock_id = str(payload.get("stock_id", "")).strip()
                    if not stock_id:
                        raise ApiError("請輸入股票代號。")
                    result = app.generate(
                        resolve_dir(payload.get("input_dir")),
                        resolve_dir(payload.get("output_dir"), must_exist=False),
                        stock_id,
                        str(payload.get("product") or "fcn"),
                    )
                    self._json(result)
                elif method == "GET" and url.path == "/api/defaults":
                    self._json(app.defaults)
                elif method == "GET" and url.path == "/api/browse":
                    self._json(browse(query.get("dir")))
                elif method == "GET" and url.path == "/api/scan":
                    self._json(app.scan_job(resolve_dir(query.get("dir"))).status())
                elif method == "GET" and url.path == "/api/compare":
                    self._json(app.compare(resolve_dir(query.get("dir")), query.get("product") or "fcn"))
                elif method == "GET" and url.path == "/api/outputs":
                    self._json(list_outputs(query.get("dir")))
                elif method == "GET" and url.path == "/output":
                    path = output_file(query.get("dir"), query.get("name"))
                    extra = {}
                    if path.suffix.lower() == ".xlsx":
                        extra["Content-Disposition"] = f"attachment; filename*=UTF-8''{path.name}"
                    self._send(HTTPStatus.OK, path.read_bytes(), OUTPUT_TYPES[path.suffix.lower()], extra)
                elif method == "GET":
                    self._static(url.path)
                else:
                    raise ApiError("Not found", HTTPStatus.NOT_FOUND)
            except ApiError as exc:
                self._json({"error": str(exc)}, exc.status)
            except Exception as exc:  # noqa: BLE001 - report unexpected failures to the UI
                self._json({"error": f"{type(exc).__name__}: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

        def _static(self, url_path: str) -> None:
            name = "index.html" if url_path in ("", "/") else url_path.lstrip("/")
            path = (WEB_DIR / name).resolve()
            if path.parent != WEB_DIR or path.suffix not in STATIC_TYPES or not path.is_file():
                raise ApiError("Not found", HTTPStatus.NOT_FOUND)
            self._send(HTTPStatus.OK, path.read_bytes(), STATIC_TYPES[path.suffix])

        def do_GET(self) -> None:  # noqa: N802
            self._dispatch("GET")

        def do_POST(self) -> None:  # noqa: N802
            self._dispatch("POST")

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="啟動國泰 FCN/ELN 報價儀表板的本機 Web 介面。")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--input-dir", type=Path, default=gen.DEFAULT_INPUT_DIR)
    parser.add_argument("--output-dir", type=Path, default=gen.DEFAULT_OUTPUT_DIR)
    parser.add_argument("--stock-id", default=DEFAULT_STOCK_ID)
    parser.add_argument("--product", choices=sorted(gen.PRODUCTS), default="fcn")
    parser.add_argument("--no-browser", action="store_true", help="啟動後不自動開啟瀏覽器")
    args = parser.parse_args()

    app = App(args.input_dir, args.output_dir, args.stock_id, args.product)
    if args.input_dir.is_dir():
        app.scan_job(args.input_dir)  # warm the cache while the browser opens

    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(app))
    url = f"http://127.0.0.1:{args.port}/"
    print(f"FCN/ELN dashboard web UI: {url}  (Ctrl+C 結束)")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
