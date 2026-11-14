// Build-time guards for a production frontend deploy. Without a backend URL the app silently becomes the
// frontend-only demo (mock data, no real sign-in), and with the dev bypass on it signs everyone in as an
// admin, so neither may ship from a production deploy. next.config.mjs runs this on Vercel production
// builds (VERCEL_ENV=production) or whenever ENFORCE_DEPLOY_GUARDS=true.
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
  } else if (!/^https:\/\/[^/\s]+/i.test(backend)) {
    problems.push(`BACKEND_API_URL must be an https:// URL in production (got ${backend.replace(/\/\/[^@/]*@/, "//")}).`);
  }
  return problems;
}

export function enforceDeployGuards(env) {
  if (env.VERCEL_ENV !== "production" && env.ENFORCE_DEPLOY_GUARDS !== "true") return;
  const problems = deployProblems(env);
  if (problems.length) throw new Error("Refusing to build for production:\n - " + problems.join("\n - "));
}
