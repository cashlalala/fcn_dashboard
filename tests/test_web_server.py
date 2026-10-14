import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))

from web_server import ApiError, browse, build_compare_model, list_outputs, output_file, summarize_entry  # noqa: E402


class WebServerTests(unittest.TestCase):
    def test_summarize_entry_groups_products_by_stock(self):
        rows = [
            {"stock_id": "2330", "stock_name": "台積電", "product_type": "固定配息率觸及型", "quote_start_date": "2026-04-27", "quote_end_date": "2026-05-08"},
            {"stock_id": "2330", "stock_name": "台積電", "product_type": "上限型", "quote_start_date": "2026-04-27", "quote_end_date": "2026-05-08"},
            {"stock_id": "2454", "stock_name": "聯發科", "product_type": "固定配息率觸及型", "quote_start_date": "2026-04-27", "quote_end_date": "2026-05-08"},
        ]

        summary = summarize_entry({"rows": rows, "error": None})

        self.assertEqual(summary["rows"], 3)
        self.assertEqual(summary["stocks"]["2330"]["products"], ["固定配息率觸及型", "上限型"])
        self.assertEqual(summary["stocks"]["2454"]["name"], "聯發科")
        self.assertEqual(summary["quote_start_date"], "2026-04-27")

    def test_build_compare_model_keeps_max_rate_per_stock_date_and_bounds(self):
        def row(stock_id, name, date, lower, upper, rate, product_type="固定配息率觸及型"):
            return {
                "stock_id": stock_id, "stock_name": name, "product_type": product_type,
                "quote_start_date": date, "quote_end_date": date,
                "lower_bound_pct": lower, "upper_bound_pct": upper, "coupon_rate_pct": rate,
            }

        rows = [
            row("2454", "聯發科", "2026-05-04", 92.0, 105.0, 14.1),
            row("2330", "台積電", "2026-05-04", 92.0, 105.0, 12.3),
            row("2330", "台積電", "2026-05-04", 92.0, 105.0, 12.8),
            row("2330", "台積電", "2026-04-27", 92.0, 105.0, 11.5),
            row("2330", "台積電", "2026-04-27", 100.0, 104.0, 9.9, product_type="上限型"),
        ]

        model = build_compare_model(rows, "固定配息率觸及型")

        self.assertEqual(model["stocks"], {"2330": "台積電", "2454": "聯發科"})
        self.assertEqual(model["dates"], ["2026-04-27", "2026-05-04"])
        self.assertEqual(model["quotes"], [
            ["2330", "2026-04-27", 92.0, 105.0, 11.5],
            ["2330", "2026-05-04", 92.0, 105.0, 12.8],
            ["2454", "2026-05-04", 92.0, 105.0, 14.1],
        ])

    def test_browse_and_outputs_list_expected_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "sub").mkdir()
            (root / "a.pdf").write_bytes(b"%PDF")
            (root / "note.txt").write_text("x")
            (root / "2330_fcn_dashboard.html").write_text("<html>")
            (root / "2330_eln_dashboard.html").write_text("<html>")
            (root / "2330_xyz_dashboard.html").write_text("<html>")
            (root / "cathay_fcn_2330_rates.xlsx").write_bytes(b"x")

            listing = browse(str(root))
            outputs = list_outputs(str(root))

        self.assertEqual([d["name"] for d in listing["dirs"]], ["sub"])
        self.assertEqual([p["name"] for p in listing["pdfs"]], ["a.pdf"])
        self.assertEqual([(d["stock_id"], d["product"]) for d in outputs["dashboards"]], [("2330", "fcn"), ("2330", "eln")])
        self.assertEqual(outputs["dashboards"][0]["excel"], "cathay_fcn_2330_rates.xlsx")

    def test_output_file_rejects_traversal_and_other_types(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "secret.txt").write_text("x")
            for name in ["..\\x.html", "../x.html", "secret.txt"]:
                with self.assertRaises(ApiError):
                    output_file(tmp, name)


if __name__ == "__main__":
    unittest.main()
