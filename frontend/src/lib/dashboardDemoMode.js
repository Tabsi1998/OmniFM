// OmniFM: the dashboard's preview with example data (#432). /dashboard?demo
// opens it for anyone, without signing in; the start page's tour shows the
// same preview inside the page and switches it on with enableDashboardDemo().
// Small on purpose: the dashboard asks this on every request, the example
// data load only in the preview.

let switchedOn = '';

function pageSearch() {
  return typeof window === 'undefined' ? '' : window.location.search;
}

/** The start page's tour: the dashboard on that page answers from the example data. */
export function enableDashboardDemo(kind = 'tour') {
  switchedOn = kind;
}

export function isDashboardDemo(search = pageSearch()) {
  return Boolean(switchedOn) || new URLSearchParams(search).has('demo');
}

export function isDashboardTour(search = pageSearch()) {
  return switchedOn === 'tour' || new URLSearchParams(search).get('demo') === 'tour';
}
