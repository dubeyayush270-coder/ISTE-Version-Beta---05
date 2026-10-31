
from ddgs import DDGS
from urllib.parse import urlparse


BLOCKED_DOMAINS = [
    "youtube.com",
    "youtu.be",
    "scribd.com",
    "pinterest.com",
    "facebook.com",
    "instagram.com"
]

COLLECTION_KEYWORDS = [
    "collection",
    "collections",
    "recipes-for-kids",
    "lunch-box-recipes",
    "tiffin-recipes",
    "recipe-roundup",
    "recipe-ideas",
    "100-plus",
    "75-plus"
]


def is_individual_recipe(title, url, content):

    text = f"{title} {url} {content}".lower()

    domain = urlparse(url).netloc.lower()

    # Reject irrelevant platforms
    if any(blocked in domain for blocked in BLOCKED_DOMAINS):
        return False

    # Reject obvious collection pages
    if any(keyword in text for keyword in COLLECTION_KEYWORDS):
        return False

    # Reject generic category pages
    if "/category/" in url.lower():
        return False

    return True


def search_recipes(query, max_results=5):

    try:
        results = DDGS().text(
            query,
            region="in-en",
            max_results=max_results * 5
        )

        recipes = []
        seen_urls = set()

        for result in results:

            title = result.get("title", "")
            url = result.get("href", "")
            content = result.get("body", "")

            if not url or not url.startswith("http"):
                continue

            if url in seen_urls:
                continue

            seen_urls.add(url)

            if not is_individual_recipe(title, url, content):
                continue

            recipes.append({
                "title": title,
                "url": url,
                "content": content
            })

            if len(recipes) >= max_results:
                break

        return recipes

    except Exception as error:
        print("Recipe search error:", error)
        return []


