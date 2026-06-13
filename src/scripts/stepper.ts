function clampNum(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function stepDecimals(step) {
  const part = String(step).split(".")[1];
  return part ? part.length : 0;
}

function roundToStep(n, step) {
  const places = stepDecimals(step);
  if (!places) return Math.round(n);
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function formatStepperValue(n, step) {
  const places = stepDecimals(step);
  return places ? n.toFixed(places) : String(n);
}

function parseStepperValue(raw, fallback, step) {
  const parsed = stepDecimals(step) ? parseFloat(raw) : parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function syncNumberStepper(root, { value, min, max, step = 1 }) {
  root.dataset.value = String(value);
  const input = root.querySelector(".drawer-stepper-input");
  const dec = root.querySelector(".drawer-stepper-dec");
  const inc = root.querySelector(".drawer-stepper-inc");
  if (input && document.activeElement !== input) {
    input.value = formatStepperValue(value, step);
  }
  if (dec) dec.disabled = value <= min;
  if (inc) inc.disabled = value >= max;
}

export function buildNumberStepper({
  label,
  fieldLabel = label,
  value,
  min,
  max,
  step = 1,
  scrub = false,
  className = "",
  onChange,
}) {
  const root = document.createElement("div");
  root.className = className ? `drawer-stepper ${className}` : "drawer-stepper";
  root.dataset.value = String(value);
  root.dataset.min = String(min);
  root.dataset.max = String(max);
  root.dataset.step = String(step);

  const field = document.createElement("div");
  field.className = "drawer-stepper-field";

  const labelEl = document.createElement("span");
  labelEl.className = "drawer-stepper-label";
  labelEl.textContent = fieldLabel;
  if (scrub) labelEl.dataset.scrub = "";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "drawer-stepper-input";
  input.inputMode = "numeric";
  input.setAttribute("aria-label", label);
  input.value = formatStepperValue(value, step);

  const emit = (next) => {
    const clamped = roundToStep(clampNum(next, min, max), step);
    const current = parseStepperValue(root.dataset.value, value, step);
    if (clamped === current) return;
    onChange(clamped);
    syncNumberStepper(root, { value: clamped, min, max, step });
  };

  const readValue = () =>
    parseStepperValue(input.value, parseStepperValue(root.dataset.value, value, step), step);

  const commitInput = () => {
    const parsed = parseStepperValue(input.value, NaN, step);
    if (!Number.isFinite(parsed)) {
      syncNumberStepper(root, {
        value: parseStepperValue(root.dataset.value, value, step),
        min,
        max,
        step,
      });
      return;
    }
    emit(parsed);
  };

  input.addEventListener("change", commitInput);
  input.addEventListener("blur", commitInput);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
  });

  const dec = document.createElement("button");
  dec.type = "button";
  dec.className = "drawer-stepper-btn drawer-stepper-dec";
  dec.setAttribute("aria-label", `Decrease ${label}`);
  dec.textContent = "−";
  dec.addEventListener("click", () => emit(readValue() - step));

  const inc = document.createElement("button");
  inc.type = "button";
  inc.className = "drawer-stepper-btn drawer-stepper-inc";
  inc.setAttribute("aria-label", `Increase ${label}`);
  inc.textContent = "+";
  inc.addEventListener("click", () => emit(readValue() + step));

  if (scrub) {
    labelEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startValue = readValue();
      const onMove = (ev) => {
        const delta = Math.round((ev.clientX - startX) / 2) * step;
        emit(startValue + delta);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  field.append(labelEl, dec, input, inc);
  root.append(field);
  syncNumberStepper(root, { value, min, max, step });
  return root;
}
