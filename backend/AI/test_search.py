from AI.search import search_recipes

query = "Healthy vegetarian Indian school tiffin recipes"
results = search_recipes(query)

for index, recipe in enumerate(results, start=1):
    print(f"\nRecipe {index}")
    print("Title:", recipe["title"])
    print("Link:", recipe["url"])
    print("Description:", recipe["content"])