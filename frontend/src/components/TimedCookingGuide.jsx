
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChefHat,
  Clock3,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  Check,
  HelpCircle,
  TimerReset
} from "lucide-react";

import "./TimedCookingGuide.css";

// DEMO DATA: Replace with validated recipe-specific
// cooking timelines before production use.
const DEMO_TIMELINE = [
  {
    title: "Heat the oil",
    instruction:
      "Place a pan on medium heat and add the measured oil.",
    durationSeconds: 60,
    reminders: [],
    question:
      "Is the oil gently heated and ready for the onions?",
    hint:
      "The oil should look slightly fluid and shimmer gently. Avoid letting it smoke."
  },
  {
    title: "Cook the onions",
    instruction:
      "Add the chopped onions and stir occasionally.",
    durationSeconds: 180,
    reminders: [
      {
        at: 60,
        message:
          "Stir the onions so they cook evenly."
      },
      {
        at: 120,
        message:
          "Check that the onions are not sticking or burning."
      }
    ],
    question:
      "Have the onions softened and turned light golden?",
    hint:
      "Look for soft onions with light golden edges. If they are darkening too quickly, reduce the heat."
  },
  {
    title: "Add tomatoes and spices",
    instruction:
      "Add the prepared tomatoes and measured spices. Mix them into the onions.",
    durationSeconds: 180,
    reminders: [
      {
        at: 90,
        message:
          "Stir the tomato mixture and check the bottom of the pan."
      }
    ],
    question:
      "Have the tomatoes softened into the masala?",
    hint:
      "The tomatoes should be soft and easy to mash. Continue cooking gently if they are still firm."
  },
  {
    title: "Simmer the gravy",
    instruction:
      "Add the measured water from your recipe and bring the gravy to a gentle simmer.",
    durationSeconds: 240,
    reminders: [
      {
        at: 90,
        message:
          "Stir the gravy gently."
      },
      {
        at: 180,
        message:
          "Check the gravy consistency and stir if necessary."
      }
    ],
    question:
      "Has the gravy reached the consistency you want?",
    hint:
      "The gravy should be evenly mixed and gently simmering. Follow the recipe's measurements; avoid adding unnecessary water."
  },
  {
    title: "Add the paneer",
    instruction:
      "Add the prepared paneer cubes to the gravy and stir gently.",
    durationSeconds: 180,
    reminders: [
      {
        at: 90,
        message:
          "Gently stir the paneer so it is coated in the gravy."
      }
    ],
    question:
      "Is the paneer heated through and the gravy ready?",
    hint:
      "Check that the paneer is heated through and the gravy is gently simmering. Do not rely on the timer alone."
  }
];

const RETRY_SECONDS = 60;

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return `${String(mins).padStart(2, "0")}:${String(
    secs
  ).padStart(2, "0")}`;
}

export default function TimedCookingGuide({
  recipeName = "Paneer Masala",
  onClose
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [timeLimit, setTimeLimit] = useState(
    DEMO_TIMELINE[0].durationSeconds
  );
  const [status, setStatus] = useState("idle");
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState("");

  const mutedRef = useRef(false);
  const firedReminders = useRef(new Set());
  const recognitionRef = useRef(null);

  const current = DEMO_TIMELINE[stepIndex];
  const remaining = Math.max(0, timeLimit - elapsed);
  const progress =
    timeLimit > 0
      ? Math.min(100, (elapsed / timeLimit) * 100)
      : 100;

  function speak(message) {
    if (
      mutedRef.current ||
      !("speechSynthesis" in window)
    ) {
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(
      message
    );

    utterance.lang = "en-IN";
    utterance.rate = 0.9;
    utterance.pitch = 1;

    window.speechSynthesis.speak(utterance);
  }

  function stopRecognition() {
    const recognition = recognitionRef.current;

    if (!recognition) return;

    recognitionRef.current = null;
    recognition.onend = null;

    try {
      recognition.stop();
    } catch {
      // Recognition may have stopped already.
    }

    setListening(false);
  }

  function begin() {
    firedReminders.current.clear();
    setStepIndex(0);
    setElapsed(0);
    setTimeLimit(DEMO_TIMELINE[0].durationSeconds);
    setNotice("");
    setStatus("running");

    speak(DEMO_TIMELINE[0].instruction);
  }

  function advance() {
    if (status !== "question") return;

    const nextIndex = stepIndex + 1;

    firedReminders.current.clear();
    setNotice("");

    if (nextIndex >= DEMO_TIMELINE.length) {
      setStatus("done");
      speak(
        "All guided cooking steps are complete. Check that the food is properly cooked and safe before serving."
      );
      return;
    }

    const nextStep = DEMO_TIMELINE[nextIndex];

    setStepIndex(nextIndex);
    setElapsed(0);
    setTimeLimit(nextStep.durationSeconds);
    setStatus("running");

    speak(
      `Great. Next step: ${nextStep.title}. ${nextStep.instruction}`
    );
  }

  function extendTimer() {
    if (status !== "question") return;

    setTimeLimit(elapsed + RETRY_SECONDS);
    setNotice("Continuing this step for another minute.");
    setStatus("running");

    speak(
      "Okay. Continue this cooking step. I will check again in one minute."
    );
  }

  function explainCondition() {
    if (status !== "question") return;

    setNotice(current.hint);
    speak(current.hint);
  }

  function togglePause() {
    if (status === "running") {
      setStatus("paused");
      window.speechSynthesis?.cancel();
    } else if (status === "paused") {
      setStatus("running");
      speak(`Resuming: ${current.title}`);
    }
  }

  function toggleSound() {
    const nextMuted = !mutedRef.current;

    mutedRef.current = nextMuted;
    setMuted(nextMuted);

    if (nextMuted) {
      window.speechSynthesis?.cancel();
    } else {
      speak(current.instruction);
    }
  }

  function listenForAnswer() {
    if (status !== "question") return;

    const Recognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!Recognition) {
      setNotice(
        "Speech recognition is unavailable in this browser. Please use the buttons."
      );
      return;
    }

    if (recognitionRef.current) return;

    window.speechSynthesis?.cancel();

    const recognition = new Recognition();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = event => {
      const transcript =
        event.results[0][0].transcript.toLowerCase();

      if (
        /\b(not yet|not ready|no|wait|more time)\b/.test(
          transcript
        )
      ) {
        extendTimer();
      } else if (
        /\b(yes|ready|done|finished)\b/.test(
          transcript
        )
      ) {
        advance();
      } else if (
        /\b(unsure|don't know|not sure|help)\b/.test(
          transcript
        )
      ) {
        explainCondition();
      } else {
        setNotice(
          `I heard "${transcript}". Try saying "ready", "not yet", or "not sure".`
        );
      }
    };

    recognition.onerror = event => {
      setNotice(
        `Microphone could not recognize the response (${event.error}). Please use the buttons.`
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
      setNotice("Listening for your answer...");
    } catch {
      setNotice(
        "Could not start the microphone. Please use the buttons."
      );
    }
  }

  function closeGuide() {
    stopRecognition();
    window.speechSynthesis?.cancel();
    onClose();
  }

  // Run the timer only while the cooking stage is active.
  useEffect(() => {
    if (status !== "running") return;

    const timer = window.setInterval(() => {
      setElapsed(value =>
        Math.min(value + 1, timeLimit)
      );
    }, 1000);

    return () => window.clearInterval(timer);
  }, [status, timeLimit]);

  // Deliver reminders and stop at checkpoints.
  useEffect(() => {
    if (status !== "running") return;

    for (const reminder of current.reminders) {
      const reminderId =
        `${stepIndex}-${reminder.at}`;

      if (
        elapsed >= reminder.at &&
        !firedReminders.current.has(reminderId)
      ) {
        firedReminders.current.add(reminderId);
        setNotice(reminder.message);
        speak(reminder.message);
      }
    }

    if (elapsed >= timeLimit) {
      setStatus("question");
      setNotice(current.question);
      speak(
        `${current.question} Say ready, not yet, or not sure.`
      );
    }
  }, [elapsed, timeLimit, status, stepIndex]);

  // Timers shouldn't continue silently when the page is hidden.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) {
        setStatus(value =>
          value === "running" ? "paused" : value
        );
        window.speechSynthesis?.cancel();
      }
    }

    document.addEventListener(
      "visibilitychange",
      onVisibilityChange
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );
    };
  }, []);

  // Clean up microphone and speech on unmount.
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();

      const recognition = recognitionRef.current;

      if (recognition) {
        recognition.onend = null;

        try {
          recognition.stop();
        } catch {
          // Already stopped.
        }
      }
    };
  }, []);

  return (
    <div className="ktc-overlay">
      <section
        className="ktc-screen"
        role="dialog"
        aria-modal="true"
        aria-label="Timed cooking guide"
      >
        <header className="ktc-header">
          <button
            onClick={closeGuide}
            aria-label="Close timed cooking"
          >
            <ArrowLeft size={22} />
          </button>

          <div>
            <small>KITCHENSYNC · VOICE CHEF</small>
            <strong>{recipeName}</strong>
          </div>

          <ChefHat size={25} />
        </header>

        <div className="ktc-content">
          <div className="ktc-card">
            <div className="ktc-step-label">
              Step {stepIndex + 1} of{" "}
              {DEMO_TIMELINE.length}
            </div>

            <h1>{current.title}</h1>

            <div className="ktc-timer">
              <div
                className="ktc-ring"
                style={{
                  "--progress": `${progress}%`
                }}
              >
                <div className="ktc-ring-inner">
                  <span>{formatTime(remaining)}</span>
                  <small>
                    {status === "question"
                      ? "Check food"
                      : status === "paused"
                      ? "Paused"
                      : "Remaining"}
                  </small>
                </div>
              </div>
            </div>

            <p className="ktc-instruction">
              {current.instruction}
            </p>

            {status === "idle" && (
              <button
                className="ktc-primary"
                onClick={begin}
              >
                <Play size={18} />
                Start Cooking
              </button>
            )}

            {(status === "running" ||
              status === "paused") && (
              <button
                className="ktc-primary"
                onClick={togglePause}
              >
                {status === "running" ? (
                  <>
                    <Pause size={18} />
                    Pause Timer
                  </>
                ) : (
                  <>
                    <Play size={18} />
                    Resume Timer
                  </>
                )}
              </button>
            )}

            <button
              className="ktc-sound-button"
              onClick={toggleSound}
            >
              {muted ? (
                <VolumeX size={17} />
              ) : (
                <Volume2 size={17} />
              )}
              {muted ? "Voice off" : "Voice on"}
            </button>
          </div>

          {status === "question" && (
            <div className="ktc-checkpoint">
              <div className="ktc-checkpoint-title">
                <HelpCircle size={22} />
                Cooking checkpoint
              </div>

              <p>{current.question}</p>

              <div className="ktc-answers">
                <button
                  className="ktc-ready"
                  onClick={advance}
                >
                  <Check size={17} />
                  Yes, ready
                </button>

                <button
                  className="ktc-not-yet"
                  onClick={extendTimer}
                >
                  <TimerReset size={17} />
                  Not yet
                </button>
              </div>

              <button
                className="ktc-help"
                onClick={explainCondition}
              >
                <HelpCircle size={17} />
                I'm not sure
              </button>

              <button
                className="ktc-microphone"
                onClick={listenForAnswer}
                disabled={listening}
              >
                <Mic size={18} />
                {listening
                  ? "Listening..."
                  : "Answer by voice"}
              </button>
            </div>
          )}

          {status === "done" && (
            <div className="ktc-finished">
              <Check size={28} />
              <h2>Guided steps complete!</h2>
              <p>
                Confirm that your food is properly
                cooked and ready to serve.
              </p>
              <button onClick={closeGuide}>
                Finish Cooking Guide
              </button>
            </div>
          )}

          {notice && status !== "done" && (
            <div
              className="ktc-notice"
              role="status"
              aria-live="polite"
            >
              {notice}
            </div>
          )}

          <div className="ktc-upcoming">
            <h2>
              <Clock3 size={18} />
              Cooking timeline
            </h2>

            {DEMO_TIMELINE.map((item, index) => (
              <div
                key={item.title}
                className={
                  `ktc-upcoming-step ${
                    index === stepIndex ? "current" : ""
                  }`
                }
              >
                <span>{index + 1}</span>

                <div>
                  <strong>{item.title}</strong>
                  <small>
                    ~{Math.ceil(
                      item.durationSeconds / 60
                    )} min
                  </small>
                </div>

                {index < stepIndex && (
                  <Check size={17} />
                )}
              </div>
            ))}
          </div>

          <p className="ktc-footnote">
            Demo recipe timings are approximate.
            Reminders cannot detect food readiness.
            Always verify cooking conditions and
            follow food-safety guidance.
          </p>
        </div>
      </section>
    </div>
  );
}
