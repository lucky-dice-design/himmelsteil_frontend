const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
const menuLabel = menuToggle?.querySelector(".sr-only");

const setMenuState = (isOpen) => {
  mainNav?.classList.toggle("is-open", isOpen);
  menuToggle?.setAttribute("aria-expanded", String(isOpen));
  if (menuLabel) menuLabel.textContent = isOpen ? menuToggle.dataset.closeLabel || "Menü schließen" : menuToggle.dataset.openLabel || "Menü öffnen";
};

menuToggle?.addEventListener("click", () => {
  setMenuState(!mainNav?.classList.contains("is-open"));
});

mainNav?.addEventListener("click", (event) => {
  if (event.target instanceof HTMLAnchorElement) {
    setMenuState(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setMenuState(false);
  }
});

const filters = document.querySelectorAll("[data-filter]");
const galleryCards = document.querySelectorAll("[data-category]");
const galleryStatus = document.querySelector("[data-gallery-status]");

filters.forEach((filter) => {
  filter.setAttribute("aria-pressed", String(filter.classList.contains("is-active")));
});

filters.forEach((filter) => {
  filter.addEventListener("click", () => {
    const category = filter.getAttribute("data-filter");

    filters.forEach((item) => {
      item.classList.remove("is-active");
      item.setAttribute("aria-pressed", "false");
    });
    filter.classList.add("is-active");
    filter.setAttribute("aria-pressed", "true");

    let visibleCount = 0;
    galleryCards.forEach((card) => {
      const shouldShow = category === "all" || card.getAttribute("data-category") === category;
      card.hidden = !shouldShow;
      if (shouldShow) visibleCount += 1;
    });

    if (galleryStatus) {
      galleryStatus.textContent = (galleryStatus.dataset.resultsMessage || "{count} Arbeiten werden angezeigt.").replaceAll("{count}", String(visibleCount));
    }
  });
});

const contactForm = document.querySelector("[data-contact-form]");
const contactStatus = document.querySelector("[data-form-status]");
let contactStartedAt = Date.now();
let contactRequestId = crypto.randomUUID();

contactForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!contactForm.reportValidity()) return;

  const submitButton = contactForm.querySelector('button[type="submit"]');
  const formData = new FormData(contactForm);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  submitButton.disabled = true;
  contactForm.setAttribute("aria-busy", "true");
  contactStatus.textContent = contactForm.dataset.sendingMessage;
  contactStatus.className = "form-status";

  try {
    const response = await fetch(contactForm.action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        occasion: formData.get("occasion"),
        timeframe: formData.get("timeframe"),
        message: formData.get("message"),
        website: formData.get("website"),
        consent: formData.get("consent") === "on",
        startedAt: contactStartedAt,
        requestId: contactRequestId,
      }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Die Anfrage konnte nicht gesendet werden.");
    contactStatus.textContent = contactForm.dataset.successMessage;
    contactStatus.classList.add("is-success");
    contactForm.reset();
    contactStartedAt = Date.now();
    contactRequestId = crypto.randomUUID();
  } catch (error) {
    contactStatus.textContent = error.name === "AbortError"
      ? contactForm.dataset.timeoutMessage || contactForm.dataset.errorMessage
      : error instanceof TypeError ? contactForm.dataset.errorMessage : error.message || contactForm.dataset.errorMessage;
    contactStatus.classList.add("is-error");
  } finally {
    window.clearTimeout(timeout);
    submitButton.disabled = false;
    contactForm.removeAttribute("aria-busy");
  }
});
