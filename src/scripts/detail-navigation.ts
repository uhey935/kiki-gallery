console.log("detail-navigation loaded");

const navigations = document.querySelectorAll(".detail-navigation");

console.log("navigation count:", navigations.length);

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  },
  {
    rootMargin: "0px 0px -80px 0px",
  },
);

navigations.forEach((navigation) => {
  observer.observe(navigation);
});