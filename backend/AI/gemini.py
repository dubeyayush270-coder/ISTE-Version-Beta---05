import os
from pathlib import Path

from dotenv import load_dotenv
from google import genai

# Load backend/.env
backend_folder = Path(__file__).resolve().parents[1]
load_dotenv(backend_folder / ".env")

api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    raise ValueError("GEMINI_API_KEY is missing from backend/.env")

client = genai.Client(api_key=api_key)


def ask_gemini(prompt):
    response = client.models.generate_content(
      model="gemini-3.8-flash",
        contents=prompt
    )

    return response.text
