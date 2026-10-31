import TimedCookingGuide from "./TimedCookingGuide";
import { getCookingTimeline } from "../data/cookingTimelines";

import { useEffect, useRef, useState } from "react";
import {
  X, Clock3, UsersRound, Flame, ChefHat,
  Plus, Minus, CheckCircle2, AlertTriangle,
  ChevronLeft, ChevronRight, Volume2,
  VolumeX, Mic, MicOff, RefreshCw
} from "lucide-react";

import {
  recipeIcon,
  scaleRecipe,
  displayAmount
} from "../lib/api";

import "./MobileRecipeDetail.css";

export default function MobileRecipeDetail({
  recipe,
  defaultEaters = 2,
  inventory = [],
  onClose,
  onNotify
}) {
  const [eaters, setEaters] = useState(defaultEaters);
  const [step, setStep] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [timedOpen, setTimedOpen] = useState(false);

  const cookingTimeline = getCookingTimeline(recipe);

  const stepRef = useRef(0);
  const voiceRef = useRef(false);
  const recognitionRef = useRef(null);

  const ingredients = scaleRecipe(recipe, eaters);
  const steps = recipe.steps || [];

  const image = recipe.image_url || recipe.photo_url;

  const ingredientStatus = ingredients.map(ingredient => {
    const available = inventory
      .filter(item =>
        item.name.trim().toLowerCase() ===
          ingredient.name.trim().toLowerCase() &&
        item.unit === ingredient.unit &&
        item.usable !== false
      )
      .reduce(
        (total, item) => total + Number(item.quantity || 0),
        0
      );

    return {
      ...ingredient,
      available,
      missing: Math.max(
        0,
        ingredient.quantity - available
      )
    };
  });

  const missingCount = ingredientStatus.filter(
    item => item.missing > 0
  ).length;

  function speakStep(index) {
    if (!("speechSynthesis" in window)) {
      onNotify("Speech playback is unavailable.", true);
      return;
    }

    if (!steps[index]) return;

    window.speechSynthesis.cancel();

    const speech = new SpeechSynthesisUtterance(
      `Step ${index + 1}. ${steps[index]}`
    );

    speech.lang = "en-IN";
    speech.rate = 0.9;
    speech.pitch = 1;

    window.speechSynthesis.speak(speech);
  }

  function moveStep(delta) {
    const next = Math.max(
      0,
      Math.min(steps.length - 1, stepRef.current + delta)
    );

    stepRef.current = next;
    setStep(next);

    if (voiceRef.current) {
      speakStep(next);
    }
  }

  function toggleVoice() {
    const next = !voiceRef.current;

    voiceRef.current = next;
    setVoiceEnabled(next);

    if (next) {
      speakStep(stepRef.current);
    } else {
      window.speechSynthesis?.cancel();
    }
  }

  function stopListening() {
    if (recognitionRef.current) {
      const recognition = recognitionRef.current;
      recognition.onend = null;
      recognitionRef.current = null;

      try {
        recognition.stop();
      } catch {
        // Recognition may already have stopped.
      }
    }

    setListening(false);
  }

  function startListening() {
    const Recognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!Recognition) {
      onNotify(
        "Voice commands are not supported in this browser.",
        true
      );
      return;
    }

    if (recognitionRef.current) return;

    const recognition = new Recognition();

    recognition.lang = "en-IN";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = event => {
      const spoken = event.results[
        event.results.length - 1
      ][0].transcript.toLowerCase();

      if (spoken.includes("next")) {
        moveStep(1);
      } else if (
        spoken.includes("previous") ||
        spoken.includes("back")
      ) {
        moveStep(-1);
      } else if (spoken.includes("repeat")) {
        speakStep(stepRef.current);
      } else if (spoken.includes("stop")) {
        window.speechSynthesis?.cancel();
      }
    };

    recognition.onerror = () => {
      onNotify(
        "Microphone recognition failed or was denied.",
        true
      );
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);

      voiceRef.current = true;
      setVoiceEnabled(true);
    } catch {
      onNotify("Could not start the microphone.", true);
    }
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.speechSynthesis?.cancel();

      if (recognitionRef.current) {
        recognitionRef.current.onend = null;

        try {
          recognitionRef.current.stop();
        } catch {
          // Already stopped.
        }
      }

      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div
      className="kscook-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="kscook-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${recipe.name} cooking instructions`}
      >
        {/* Header */}
        <header className="kscook-header">
          <button
            className="kscook-icon-button"
            onClick={onClose}
            aria-label="Close recipe"
          >
            <X size={22} />
          </button>

          <strong>Recipe Details</strong>

          <ChefHat size={24} className="kscook-green" />
        </header>

        <div className="kscook-scroll">
          {/* Recipe artwork */}
          <div className="kscook-image">
            {image && !imageFailed ? (
              <img
                src={image}
                alt={recipe.name}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <span>{recipeIcon(recipe)}</span>
            )}
          </div>

          <div className="kscook-content">
            <span className="kscook-category">
              {recipe.category}
            </span>

            <h1>{recipe.name}</h1>

            <div className="kscook-meta">
              <span>
                <Clock3 size={16} />
                {recipe.minutes} min
              </span>

              <span>
                <UsersRound size={16} />
                {eaters} people
              </span>

              <span>
                <Flame size={16} />
                ~{Math.round(
                  recipe.calories_per_serving
                )} kcal/serving
              </span>
            </div>

            {/* Serving counter */}
            <div className="kscook-serving-card">
                
                {cookingTimeline && (
                <button
                    type="button"
                    className="w-full mb-5 flex items-center justify-center gap-3 rounded-2xl bg-[#287b50] px-4 py-4 text-white font-bold shadow-md"
                    onClick={() => {
                    stopListening();
                    window.speechSynthesis?.cancel();
                    voiceRef.current = false;
                    setVoiceEnabled(false);
                    setTimedOpen(true);
                    }}
                >
                    <Clock3 size={20} />
                    Start Smart Timed Cooking
                </button>
                )}

              <div>
                <strong>People eating</strong>
                <small>Ingredients adjust automatically</small>
              </div>

              <div className="kscook-counter">
                <button
                  aria-label="Decrease servings"
                  disabled={eaters <= 1}
                  onClick={() =>
                    setEaters(value => Math.max(1, value - 1))
                  }
                >
                  <Minus size={17} />
                </button>

                <strong>{eaters}</strong>

                <button
                  aria-label="Increase servings"
                  disabled={eaters >= 30}
                  onClick={() =>
                    setEaters(value => Math.min(30, value + 1))
                  }
                >
                  <Plus size={17} />
                </button>
              </div>
            </div>

            {/* Ingredient list */}
            <div className="kscook-card">
              <div className="kscook-section-heading">
                <h2>Ingredients</h2>

                <span className={
                  missingCount === 0
                    ? "kscook-ready"
                    : "kscook-missing"
                }>
                  {missingCount === 0
                    ? "All available"
                    : `${missingCount} missing`}
                </span>
              </div>

              <div className="kscook-ingredients">
                {ingredientStatus.map(item => (
                  <div
                    className="kscook-ingredient"
                    key={item.name}
                  >
                    <span>{item.name}</span>

                    <div>
                      <strong>
                        {displayAmount(
                          item.quantity,
                          item.unit
                        )}
                      </strong>

                      {item.missing > 0 ? (
                        <small className="kscook-warning">
                          <AlertTriangle size={12} />
                          Short by {displayAmount(
                            item.missing,
                            item.unit
                          )}
                        </small>
                      ) : (
                        <small className="kscook-success">
                          <CheckCircle2 size={12} />
                          Available
                        </small>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cooking steps */}
            <div className="kscook-card kscook-guide">
              <div className="kscook-section-heading">
                <h2>Let's start cooking!</h2>
                <span className="kscook-step-count">
                  {steps.length
                    ? `Step ${step + 1}/${steps.length}`
                    : "No steps"}
                </span>
              </div>

              <div className="kscook-current-step">
                <span>STEP {step + 1}</span>
                <p>
                  {steps[step] || "No cooking steps available."}
                </p>
              </div>

              <div className="kscook-voice-actions">
                <button
                  className={voiceEnabled ? "active" : ""}
                  onClick={toggleVoice}
                >
                  {voiceEnabled
                    ? <VolumeX size={18} />
                    : <Volume2 size={18} />}
                  {voiceEnabled
                    ? "Stop voice"
                    : "Start voice"}
                </button>

                <button onClick={() => speakStep(step)}>
                  <RefreshCw size={17} />
                  Repeat
                </button>

                <button
                  className={listening ? "active" : ""}
                  onClick={
                    listening ? stopListening : startListening
                  }
                >
                  {listening
                    ? <MicOff size={18} />
                    : <Mic size={18} />}
                  {listening
                    ? "Stop listening"
                    : "Voice commands"}
                </button>
              </div>

              <p className="kscook-voice-hint">
                Supported browsers can recognize "next",
                "previous", "repeat", and "stop".
                Voice recognition may require internet access.
              </p>
            </div>

            {/* Complete steps */}
            <div className="kscook-all-steps">
              <h2>Complete instructions</h2>

              {steps.map((instruction, index) => (
                <button
                  key={index}
                  className={
                    index === step ? "selected" : ""
                  }
                  onClick={() => {
                    stepRef.current = index;
                    setStep(index);

                    if (voiceRef.current) {
                      speakStep(index);
                    }
                  }}
                >
                  <span>{index + 1}</span>
                  <p>{instruction}</p>
                </button>
              ))}
            </div>

            <p className="kscook-disclaimer">
              Recipe quantities and calorie values are
              estimates. Follow appropriate cooking and
              food-safety practices.
            </p>
          </div>
        </div>

        {/* Always-visible cooking controls */}
        <footer className="kscook-footer">
          <button
            className="kscook-previous"
            onClick={() => moveStep(-1)}
            disabled={step === 0}
          >
            <ChevronLeft size={20} />
            Previous
          </button>

          <button
            className="kscook-next"
            onClick={() => moveStep(1)}
            disabled={step >= steps.length - 1}
          >
            Next Step
            <ChevronRight size={20} />
          </button>
        </footer>
        
        {timedOpen && cookingTimeline && (
        <TimedCookingGuide
            recipeName={recipe.name}
            timeline={cookingTimeline}
            onClose={() => setTimedOpen(false)}
        />
        )}

      </section>
    </div>
  );
}
