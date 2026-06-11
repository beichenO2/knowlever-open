"""Marker PDF extraction helper - called by normalize-pdf.js"""
import sys, json, os, multiprocessing

def main():
    pdf_path = sys.argv[1]
    assets_dir = sys.argv[2]

    if sys.platform == "darwin":
        try:
            multiprocessing.set_start_method("fork", force=True)
        except RuntimeError:
            pass

    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict

    models = create_model_dict()
    converter = PdfConverter(artifact_dict=models)
    rendered = converter(pdf_path)
    text = rendered.markdown

    img_count = 0
    for name, img in rendered.images.items():
        out_path = os.path.join(assets_dir, name)
        img.save(out_path)
        if os.path.getsize(out_path) > 5120:
            img_count += 1
        else:
            os.unlink(out_path)

    sep = chr(10) + "---" + chr(10)
    pages = text.count(sep) + 1
    print(json.dumps({"markdown": text, "pages": pages, "images": img_count}))

if __name__ == "__main__":
    main()
