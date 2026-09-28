// OmniFM: the dashboard's preview with example data (#432). /dashboard?demo
// opens it for anyone, without signing in; /dashboard?demo=tour is the same
// preview inside the start page's tour. Small on purpose: the dashboard
// asks this on every request, the example data load only in the preview.

function pageSearch() {
  return typeof window === 'undefined' ? '' : window.location.search;
}

export function isDashboardDemo(search = pageSearch()) {
  return new URLSearchParams(search).has('demo');
}

export function isDashboardTour(search = pageSearch()) {
  return new URLSearchParams(search).get('demo') === 'tour';
}
