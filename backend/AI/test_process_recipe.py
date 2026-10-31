from AI.process_recipe import process_recipe

url = "https://www.indianveggiedelight.com/healthy-kids-lunch-box-recipes-indian/"

preferences = {
    "exclude": ["carrot"],
    "cooking_time": 20
}

result = process_recipe(url, preferences)

print("\nRecipe Extraction Details")
print("-------------------------")

print("Processing Status:", result["status"])

if result["status"] == "success":

    for item in result["recipes"]:

        recipe = item["recipe"]

        print("\nTitle:", recipe["title"])
        print("Ingredients:", recipe["ingredients"])
        print("Total Time:", recipe.get("cooking_time"))
        print("Preparation Time:", recipe.get("prep_time"))
        print("Cooking Time:", recipe.get("cook_time"))
        print("Instructions:", recipe["instructions"])

        print("\nValidation:", item["validation"])

else:
    print("Message:", result.get("message"))