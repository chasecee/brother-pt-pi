function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function validRect(rect) {
  if (!rect) return false;
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.w) &&
    Number.isFinite(rect.h) &&
    rect.w > 0 &&
    rect.h > 0
  );
}

function fitRect(width, height, aspect) {
  if (width / height >= aspect) {
    const h = height;
    const w = h * aspect;
    return { x: (width - w) / 2, y: 0, w, h };
  }
  const w = width;
  const h = w / aspect;
  return { x: 0, y: (height - h) / 2, w, h };
}

function clampRect(rect, width, height, aspect) {
  const minW = Math.max(24, Math.min(width, height * aspect) * 0.08);
  let w = clamp(rect.w, minW, width);
  let h = w / aspect;
  if (h > height) {
    h = height;
    w = h * aspect;
  }
  let x = clamp(rect.x, 0, width - w);
  let y = clamp(rect.y, 0, height - h);
  return { x, y, w, h };
}

export function openCropDialog({ imageUrl, aspect, initial }) {
  const a = Number(aspect);
  if (!imageUrl || !Number.isFinite(a) || a <= 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "crop-modal";
    modal.innerHTML = `
      <div class="crop-modal__backdrop"></div>
      <div class="crop-modal__panel" role="dialog" aria-modal="true" aria-label="Crop image">
        <div class="crop-modal__stage">
          <div class="crop-modal__frame">
            <img alt="" />
            <div class="crop-modal__rect">
              <button type="button" class="crop-modal__handle" aria-label="Resize crop"></button>
            </div>
          </div>
        </div>
        <div class="crop-modal__actions">
          <button type="button" class="btn btn-sm crop-cancel">Cancel</button>
          <button type="button" class="btn btn-sm btn-primary crop-save">Save crop</button>
        </div>
      </div>
    `;
    document.body.append(modal);

    const img = modal.querySelector("img");
    const frame = modal.querySelector(".crop-modal__frame");
    const rectEl = modal.querySelector(".crop-modal__rect");
    const handle = modal.querySelector(".crop-modal__handle");
    const cancelBtn = modal.querySelector(".crop-cancel");
    const saveBtn = modal.querySelector(".crop-save");
    const resizeObserver = new ResizeObserver(() => {
      if (!rect) return;
      const { width, height } = frameSize();
      const prevW = Number(rectEl.dataset.w) || width || 1;
      const prevH = Number(rectEl.dataset.h) || height || 1;
      const nx = rect.x / prevW;
      const ny = rect.y / prevH;
      const nw = rect.w / prevW;
      const nh = rect.h / prevH;
      rectEl.dataset.w = String(width || 1);
      rectEl.dataset.h = String(height || 1);
      rect = clampRect(
        { x: nx * width, y: ny * height, w: nw * width, h: nh * height },
        width,
        height,
        a,
      );
      render();
    });

    let rect = null;
    let pointer = null;
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onKey);
      resizeObserver.disconnect();
      modal.remove();
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === "Escape") finish(null);
    };
    window.addEventListener("keydown", onKey);

    const render = () => {
      rectEl.style.left = `${rect.x}px`;
      rectEl.style.top = `${rect.y}px`;
      rectEl.style.width = `${rect.w}px`;
      rectEl.style.height = `${rect.h}px`;
    };

    const frameSize = () => ({
      width: img.clientWidth,
      height: img.clientHeight,
    });

    const normalized = () => {
      const { width, height } = frameSize();
      if (width < 1 || height < 1) return null;
      return {
        x: rect.x / width,
        y: rect.y / height,
        w: rect.w / width,
        h: rect.h / height,
      };
    };

    const initRect = () => {
      const { width, height } = frameSize();
      if (width < 1 || height < 1) return;
      if (validRect(initial)) {
        rect = clampRect(
          {
            x: initial.x * width,
            y: initial.y * height,
            w: initial.w * width,
            h: initial.h * height,
          },
          width,
          height,
          a,
        );
      } else {
        rect = fitRect(width, height, a);
      }
      render();
    };

    const onPointerMove = (e) => {
      if (!pointer) return;
      const { width, height } = frameSize();
      if (pointer.mode === "move") {
        const x = clamp(pointer.startRect.x + e.clientX - pointer.startX, 0, width - rect.w);
        const y = clamp(pointer.startRect.y + e.clientY - pointer.startY, 0, height - rect.h);
        rect = { ...rect, x, y };
        render();
        return;
      }
      let w = Math.max(pointer.minW, pointer.startRect.w + e.clientX - pointer.startX);
      if (pointer.startRect.x + w > width) w = width - pointer.startRect.x;
      let h = w / a;
      if (pointer.startRect.y + h > height) {
        h = height - pointer.startRect.y;
        w = h * a;
      }
      rect = {
        x: pointer.startRect.x,
        y: pointer.startRect.y,
        w,
        h,
      };
      render();
    };

    const onPointerUp = () => {
      pointer = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    rectEl.addEventListener("pointerdown", (e) => {
      if (e.target === handle) return;
      e.preventDefault();
      pointer = {
        mode: "move",
        startX: e.clientX,
        startY: e.clientY,
        startRect: { ...rect },
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pointer = {
        mode: "resize",
        startX: e.clientX,
        startY: e.clientY,
        startRect: { ...rect },
        minW: Math.max(24, Math.min(img.clientWidth, img.clientHeight * a) * 0.08),
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });

    modal.querySelector(".crop-modal__backdrop").addEventListener("click", () => finish(null));
    cancelBtn.addEventListener("click", () => finish(null));
    saveBtn.addEventListener("click", () => {
      const out = normalized();
      if (!out) {
        finish(null);
        return;
      }
      const x = clamp(out.x, 0, 1);
      const y = clamp(out.y, 0, 1);
      const w = clamp(out.w, 0.001, 1 - x);
      const h = clamp(out.h, 0.001, 1 - y);
      finish({ x, y, w, h });
    });

    resizeObserver.observe(frame);

    img.addEventListener("load", () => {
      rectEl.dataset.w = String(img.clientWidth || 1);
      rectEl.dataset.h = String(img.clientHeight || 1);
      initRect();
    });
    img.addEventListener("error", () => finish(null));
    img.src = imageUrl;
  });
}
