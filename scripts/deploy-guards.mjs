// Build-time guards for a production frontend deploy. Without a backend URL the app silently becomes the
// frontend-only demo (mock data, no real sign-in), and with the dev bypass on it signs everyone in as an
// admin, so neither may ship from a production deploy. next.config.mjs runs this on Vercel production
// builds (VERCEL_ENV=production) or whenever ENFORCE_DEPLOY_GUARDS=true.
function backendOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash || /[\s\\?#]/.test(value)) return null;
    return url;
  } catch {
    return null;
  }
}

export function publicBackendUrl(env) {
  const value = (env.BACKEND_API_URL || env.NEXT_PUBLIC_API_URL || "").trim();
  if (!value) return "";
  const url = backendOrigin(value);
  if (!url) throw new Error("BACKEND_API_URL must be an HTTP(S) origin without credentials, path, query, or fragment.");
  return url.origin;
}

export function deployProblems(env) {
  const backend = (env.BACKEND_API_URL || env.NEXT_PUBLIC_API_URL || "").trim();
  const problems = [];
  if ((env.NEXT_PUBLIC_DEV_BYPASS_AUTH || "").trim().toLowerCase() === "true") {
    problems.push("NEXT_PUBLIC_DEV_BYPASS_AUTH=true signs every visitor in as an admin. Remove it from the production environment.");
  }
  if (!backend) {
    if ((env.ALLOW_FRONTEND_ONLY_DEMO || "").trim().toLowerCase() !== "true") {
      problems.push("BACKEND_API_URL is not set, so this build would be the frontend-only demo (mock data, no real sign-in, no server). Set it to the API's https URL, or set ALLOW_FRONTEND_ONLY_DEMO=true for a deliberate demo site.");
    }
  } else {
    if (backendOrigin(backend)?.protocol !== "https:") {
      problems.push("BACKEND_API_URL must be an https:// origin without credentials, path, query, or fragment in production.");
    }
    // The API accepts only requests this site signed (middleware.ts / backend/app/edge.py); without the secret the
    // site would proxy unsigned requests and an API running with REQUIRE_EDGE_PROOF=true would refuse every one.
    if ((env.EDGE_SHARED_SECRET || "").trim().length < 32 && (env.ALLOW_NO_EDGE_PROOF || "").trim().toLowerCase() !== "true") {
      problems.push("EDGE_SHARED_SECRET (at least 32 random characters, the same value as on the API) is not set, so proxied API requests would be unsigned. Set it, or set ALLOW_NO_EDGE_PROOF=true to knowingly skip the proof.");
    }
  }
  return problems;
}

export function enforceDeployGuards(env) {
  if (env.VERCEL_ENV !== "production" && env.ENFORCE_DEPLOY_GUARDS !== "true") return;
  const problems = deployProblems(env);
  if (problems.length) throw new Error("Refusing to build for production:\n - " + problems.join("\n - "));
}
