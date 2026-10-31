from AI.gemini import ask_gemini

response = ask_gemini(
    "Suggest 3 healthy vegetarian Indian school tiffin ideas for kids. Keep the answer short."
)

print("\nKitchenSync - Gemini AI Test")
print("-----------------------------")
print(response)