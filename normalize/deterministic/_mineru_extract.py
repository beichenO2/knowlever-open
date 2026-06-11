"""MinerU PDF extraction helper - called by normalize-pdf.js
Uses MinerU's Python API directly (no HTTP server needed).
"""
import sys, json, os, tempfile, glob

def main():
    pdf_path = sys.argv[1]
    assets_dir = sys.argv[2]

    from pathlib import Path
    from mineru.cli.common import do_parse

    pdf_bytes = Path(pdf_path).read_bytes()
    pdf_stem = Path(pdf_path).stem
    output_dir = tempfile.mkdtemp(prefix="mineru_")

    do_parse(
        output_dir=output_dir,
        pdf_file_names=[pdf_stem],
        pdf_bytes_list=[pdf_bytes],
        p_lang_list=["ch"],
        backend="pipeline",
        parse_method="auto",
        formula_enable=True,
        table_enable=True,
        f_draw_layout_bbox=False,
        f_draw_span_bbox=False,
        f_dump_md=True,
        f_dump_middle_json=False,
        f_dump_model_output=False,
        f_dump_orig_pdf=False,
        f_dump_content_list=False,
    )

    md_files = glob.glob(os.path.join(output_dir, "**", "*.md"), recursive=True)
    md = ""
    for mf in md_files:
        md += Path(mf).read_text(encoding="utf-8")

    img_dir_candidates = glob.glob(os.path.join(output_dir, "**", "images"), recursive=True)
    img_count = 0
    for img_dir in img_dir_candidates:
        if not os.path.isdir(img_dir):
            continue
        for fname in os.listdir(img_dir):
            src = os.path.join(img_dir, fname)
            if not os.path.isfile(src):
                continue
            size = os.path.getsize(src)
            if size > 5120:
                import shutil
                dst = os.path.join(assets_dir, f"mineru-{fname}")
                shutil.copy2(src, dst)
                img_count += 1

    sep = chr(10) + "---" + chr(10)
    pages = md.count(sep) + 1
    print(json.dumps({"markdown": md, "pages": pages, "images": img_count}))

    import shutil
    shutil.rmtree(output_dir, ignore_errors=True)

if __name__ == "__main__":
    main()
