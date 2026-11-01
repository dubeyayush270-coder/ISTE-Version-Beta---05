"""Source nutrition preview for reviewed TheMealDB imports.

Only fetches an original recipe HTTPS URL after checking it came from TheMealDB
and that its hostname is explicitly allowed. It does not modify the database.
"""
from html.parser import HTMLParser
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from fastapi import APIRouter, HTTPException

from online_recipes_api import _details, _get_details

router = APIRouter(prefix="/api/recipes/online", tags=["Source nutrition"])
ALLOWED_HOSTS = {"bbcgoodfood.com", "www.bbcgoodfood.com"}
MAX_BYTES = 1_000_000


class _Scripts(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active = False
        self.parts = []
        self.json_scripts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "script":
            attributes = dict(attrs)
            self.active = (attributes.get("type") or "").strip().lower() == "application/ld+json"
            self.parts = []

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "script":
            if self.active and len(self.json_scripts) < 32:
                self.json_scripts.append("".join(self.parts))
            self.active = False
            self.parts = []


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _validate_url(url):
    try:
        parts = urlsplit(url)
        if (parts.scheme != "https" or parts.hostname not in ALLOWED_HOSTS or
                parts.username or parts.password or parts.port not in (None, 443) or
                not parts.path.startswith("/recipes/")):
            raise ValueError("unsupported source")
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(422, "Automatic nutrition import is available only for supported HTTPS recipe sources")
    return url


def _download_html(url):
    opener = build_opener(_NoRedirect)
    current = _validate_url(url)
    for attempt in range(3):
        request = Request(current, headers={
            "User-Agent": "Mozilla/5.0 (compatible; KitchenSyncRecipePreview/1.0)",
            "Accept": "text/html", "Accept-Encoding": "identity"})
        try:
            with opener.open(request, timeout=6) as response:
                content_type = response.headers.get("Content-Type", "").lower()
                if "text/html" not in content_type:
                    raise HTTPException(422, "Recipe source did not return an HTML page")
                raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise HTTPException(422, "Recipe page is too large for safe import")
                return raw.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
        except HTTPError as exc:
            if exc.code in (301, 302, 303, 307, 308) and attempt < 2:
                next_url = exc.headers.get("Location")
                if next_url:
                    current = _validate_url(urljoin(current, next_url))
                    continue
            raise HTTPException(502, "Recipe source couldn't be loaded; enter nutrition manually") from exc
        except (URLError, TimeoutError, OSError, UnicodeError) as exc:
            raise HTTPException(502, "Recipe source is unavailable; enter nutrition manually") from exc
    raise HTTPException(502, "Recipe source redirects too many times")


def _recipe_nodes(obj):
    if isinstance(obj, list):
        for item in obj:
            yield from _recipe_nodes(item)
    elif isinstance(obj, dict):
        types = obj.get("@type", [])
        if isinstance(types, str):
            types = [types]
        if any(str(t).split("/")[-1].lower() == "recipe" for t in types):
            yield obj
        for key in ("@graph", "mainEntity", "mainEntityOfPage", "itemListElement"):
            if key in obj:
                yield from _recipe_nodes(obj[key])


def _value_with_unit(value, unit, limit):
    if isinstance(value, (int, float)):
        # Numeric-only quantities are ambiguous without a unit.
        return None
    text = str(value or "").strip().lower().replace(",", "")
    pattern = r"(\d+(?:\.\d+)?)\s*" + (r"(?:kcal|calories|calorie|cal)" if unit == "kcal" else r"(?:g|grams?|grammes?)")
    match = re.fullmatch(pattern, text)
    if not match:
        return None
    amount = float(match.group(1))
    return amount if 0 <= amount <= limit else None


def _servings_text(value):
    if isinstance(value, list):
        value = ", ".join(str(x) for x in value[:2])
    return str(value or "").strip()[:100]


def extract_schema_nutrition(html):
    """Return source-reported values only; never estimate nutrient values."""
    parser = _Scripts()
    parser.feed(html[:MAX_BYTES])
    for script in parser.json_scripts:
        try:
            parsed = json.loads(script)
        except (ValueError, TypeError):
            continue
        for recipe in _recipe_nodes(parsed):
            nutrition = recipe.get("nutrition")
            if isinstance(nutrition, list):
                nutrition = next((n for n in nutrition if isinstance(n, dict)), None)
            if not isinstance(nutrition, dict):
                continue
            values = {
                "calories_per_serving": _value_with_unit(nutrition.get("calories"), "kcal", 2500),
                "protein_g_per_serving": _value_with_unit(nutrition.get("proteinContent"), "g", 300),
                "carbs_g_per_serving": _value_with_unit(nutrition.get("carbohydrateContent"), "g", 500),
                "fat_g_per_serving": _value_with_unit(nutrition.get("fatContent"), "g", 200),
            }
            if any(v is not None for v in values.values()):
                return {
                    "values": values,
                    "title": str(recipe.get("name") or "")[:140],
                    "recipe_yield": _servings_text(recipe.get("recipeYield")),
                    "serving_size": _servings_text(nutrition.get("servingSize")),
                }
    return None


@router.get("/{meal_id}/source-nutrition")
def source_nutrition(meal_id: str):
    details = _details(_get_details(meal_id))
    source_url = _validate_url(details.get("source_url", ""))
    nutrition = extract_schema_nutrition(_download_html(source_url))
    if not nutrition:
        raise HTTPException(404, "No structured nutrition found on this source. Enter it manually")
    return {
        **nutrition, "source_url": source_url, "source": "BBC Good Food",
        "requires_review": True,
        "note": "Source-listed recipe nutrition. Verify recipe, yield and per-serving values before importing.",
    }
