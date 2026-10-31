
const cookingTimelines = {
  paneerMasala: [
    {
      title: "Heat the oil",
      instruction:
        "Add the measured oil to a pan over medium heat.",
      durationSeconds: 60,
      reminders: [],
      question: "Is the oil gently heated?",
      hint: "Look for a slight shimmer. The oil should not be smoking."
    },
    {
      title: "Cook the onions",
      instruction:
        "Add chopped onions and sauté, stirring occasionally.",
      durationSeconds: 180,
      reminders: [
        {
          at: 60,
          message: "Stir the onions to cook them evenly."
        },
        {
          at: 120,
          message: "Check that the onions are not burning."
        }
      ],
      question:
        "Have the onions softened and turned light golden?",
      hint:
        "Look for soft onions with light golden edges."
    },
    {
      title: "Cook tomatoes and spices",
      instruction:
        "Add the prepared tomatoes and measured spices.",
      durationSeconds: 180,
      reminders: [
        {
          at: 90,
          message:
            "Stir the masala and check the bottom of the pan."
        }
      ],
      question: "Have the tomatoes softened?",
      hint:
        "The tomatoes should be soft and easy to mash."
    },
    {
      title: "Simmer the gravy",
      instruction:
        "Add the recipe's measured water and simmer gently.",
      durationSeconds: 240,
      reminders: [
        {
          at: 90,
          message: "Stir the gravy gently."
        },
        {
          at: 180,
          message: "Check the consistency of the gravy."
        }
      ],
      question: "Is the gravy at your desired consistency?",
      hint:
        "The gravy should be evenly mixed and gently simmering."
    },
    {
      title: "Add paneer",
      instruction:
        "Add the prepared paneer cubes and stir gently.",
      durationSeconds: 180,
      reminders: [
        {
          at: 90,
          message: "Gently stir the paneer and gravy."
        }
      ],
      question: "Is the paneer heated through?",
      hint:
        "Check that the paneer is heated through before serving."
    }
  ],

  vegetablePoha: [
    {
      title: "Prepare the poha",
      instruction:
        "Rinse the poha briefly and let excess water drain.",
      durationSeconds: 120,
      reminders: [],
      question: "Has the poha softened without becoming mushy?",
      hint:
        "The flakes should be soft but still hold their shape."
    },
    {
      title: "Cook the vegetables",
      instruction:
        "Heat oil, add the prepared tempering ingredients and vegetables, and cook according to your recipe.",
      durationSeconds: 240,
      reminders: [
        {
          at: 120,
          message:
            "Stir the vegetables and check that they are cooking evenly."
        }
      ],
      question: "Are the vegetables cooked sufficiently?",
      hint:
        "Check that the vegetables have softened and are not raw."
    },
    {
      title: "Mix in the poha",
      instruction:
        "Add the softened poha and gently mix with the cooked vegetables and seasonings.",
      durationSeconds: 120,
      reminders: [
        {
          at: 60,
          message:
            "Gently stir the poha without crushing the flakes."
        }
      ],
      question: "Is the poha evenly mixed and heated through?",
      hint:
        "The poha should be warm, evenly seasoned, and not excessively wet."
    }
  ]
};

export function getCookingTimeline(recipe) {
  if (!recipe?.name) return null;

  const name = recipe.name.toLowerCase();

  if (name.includes("paneer") && name.includes("masala")) {
    return cookingTimelines.paneerMasala;
  }

  if (name.includes("poha")) {
    return cookingTimelines.vegetablePoha;
  }

  return null;
}
