import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))

from web_server import ApiError, browse, list_outputs, output_file, summarize_entry  # noqa: E402


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
