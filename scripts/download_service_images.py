import os
import re
import urllib.request
from urllib.parse import urlparse

BASE_DIR = r"C:\Users\PC\.openclaw\workspace\projects\greg_tracker"
OUT_BASE = os.path.join(BASE_DIR, "frontend", "assets", "services")

SERVICE_GALLERIES = {
    "service-Total-Home-Renovation": "https://rackettyboom.com/gallery-Total-Home-Renovations",
    "service-Kitchen-Renovation": "https://rackettyboom.com/gallery-Kitchen-Renovations",
    "service-Bathroom-Renovation": "https://rackettyboom.com/gallery-Interior-Renovations",
    "service-Painting-and-Staining": "https://rackettyboom.com/gallery-Interior-Renovations",
    "service-Interior-Remodeling": "https://rackettyboom.com/gallery-Interior-Renovations",
    "service-Deck---Patio-Installation": "https://rackettyboom.com/gallery-Exterior-Renovations",
    "service-General-Contractor-": "https://rackettyboom.com/gallery-All",
    "service-Flooring": "https://rackettyboom.com/gallery-Interior-Renovations",
    "service-Concrete": "https://rackettyboom.com/gallery-Exterior-Renovations",
    "service-Masonry": "https://rackettyboom.com/gallery-Exterior-Renovations",
    "service-SheetRock": "https://rackettyboom.com/gallery-Interior-Renovations",
    "service-Other-Repair-Services": "https://rackettyboom.com/gallery-All",
}

IMG_URL_RE = re.compile(
    r'https://d3p2r6ofnvoe67\.cloudfront\.net/fit-in/1000x1000/filters:strip_exif\(\)/filters:no_upscale\(\)/media/[^"\']+\.(?:png|jpe?g|webp)',
    re.IGNORECASE,
)


def fetch_html(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8", errors="ignore")


def download_file(url: str, out_path: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=45) as response, open(out_path, "wb") as f:
        f.write(response.read())


def main() -> None:
    os.makedirs(OUT_BASE, exist_ok=True)
    for slug, gallery_url in SERVICE_GALLERIES.items():
        print(f"\n== {slug} <= {gallery_url}")
        try:
            html = fetch_html(gallery_url)
        except Exception as exc:
            print(f"  [error] fetch gallery: {exc}")
            continue

        urls = []
        seen = set()
        for m in IMG_URL_RE.finditer(html):
            u = m.group(0)
            if u in seen:
                continue
            seen.add(u)
            urls.append(u)

        if not urls:
            print("  [warn] no image urls detected")
            continue

        os.makedirs(os.path.join(OUT_BASE, slug), exist_ok=True)
        for idx, u in enumerate(urls[:6], start=1):
            ext = os.path.splitext(urlparse(u).path)[1].lower() or ".jpg"
            out_path = os.path.join(OUT_BASE, slug, f"{idx:02d}{ext}")
            try:
                download_file(u, out_path)
                print(f"  saved {out_path}")
            except Exception as exc:
                print(f"  [error] download {u}: {exc}")


if __name__ == "__main__":
    main()

