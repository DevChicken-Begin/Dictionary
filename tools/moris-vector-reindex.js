// Legacy URL remains usable, but indexing belongs exclusively to Vector Center.
// Navigation does not run a model or send a write request.
const target = new URL("./moris-vector-center.html", window.location.href);
target.search = window.location.search;
window.location.replace(target.href);
