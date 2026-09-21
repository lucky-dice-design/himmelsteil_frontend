const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
const menuLabel = menuToggle?.querySelector(".sr-only");

const setMenuState = (isOpen) => {
  mainNav?.classList.toggle("is-open", isOpen);
  menuToggle?.setAttribute("aria-expanded", String(isOpen));
  if (menuLabel) menuLabel.textContent = isOpen ? "Menü schließen" : "Menü öffnen";
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
      galleryStatus.textContent = `${visibleCount} Arbeiten werden angezeigt.`;
    }
  });
});
