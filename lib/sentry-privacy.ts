// Privacy baseline for every Sentry SDK in the website (browser, server, edge). Sentry 11 collects MORE by default than v10
// (cookies, user info, request bodies, query data), so nothing is left to defaults: only the error, its stack and the page
// URL without query string are sent. No cookies, no headers, no request/response bodies, no user, no local variables.
// Events are also scrubbed in beforeSend as a second line of defence. What this cannot prove locally (needs a real DSN
// and a staging error): see docs/npm-advisories.md.
import type { ErrorEvent } from "@sentry/nextjs";

export const sentryPrivacy = {
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: false, response: false },
    httpBodies: [] as never[],
    urlQueryParams: false,
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    graphQL: { document: false, variables: false },
  },
  sendDefaultPii: false,
};

/** Drops anything personal that slipped into an event: user, request body/cookies/headers/query, breadcrumb payload text. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split("?")[0].split("#")[0];
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => {
      const { data: _data, message: _message, ...rest } = b;
      void _data; void _message;
      return rest;
    });
  }
  if (event.contexts) delete (event.contexts as Record<string, unknown>).user;
  return event;
}
