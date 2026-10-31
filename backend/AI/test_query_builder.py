
from AI.config import create_user_configuration
from AI.query_builder import build_search_queries

configuration = create_user_configuration(
    "kids_tiffin",
    {
        "budget": 80,
        "food_type": "vegetarian",
        "exclude": ["carrot"],
        "cooking_time": 20
    }
)

queries = build_search_queries(configuration)

print("\nKitchenSync - Generated Search Queries")
print("---------------------------------------")

for index, query in enumerate(queries, start=1):
    print(f"\nQuery {index}: {query}")
