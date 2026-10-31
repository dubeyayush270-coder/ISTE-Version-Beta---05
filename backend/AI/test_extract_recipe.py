from AI.extract_recipe import extract_recipe

url = url = "https://www.indianhealthyrecipes.com/veg-sandwich-recipe-vegetable-sandwich/"

result = extract_recipe(url)

print("\nStructured Recipe Extraction")
print("----------------------------")

if "error" in result:
    print("Error:", result["error"])

elif not result["recipes"]:
    print("No individual recipe data found on this page.")

else:
    for recipe in result["recipes"]:
        print("\nRecipe:", recipe["title"])
        print("Ingredients:", recipe["ingredients"])
        print("Cooking Time:", recipe["cooking_time"])
        print("Servings:", recipe["servings"])
        print("Instructions:", recipe["instructions"])
    