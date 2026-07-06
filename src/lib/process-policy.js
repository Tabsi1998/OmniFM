function resolveUnhandledRejectionPolicy(env = process.env) {
  const value = String(env.UNHANDLED_REJECTION_POLICY || "log").trim().toLowerCase();
  if (["exit", "crash", "restart"].includes(value)) return "exit";
  return "log";
}

export {
  resolveUnhandledRejectionPolicy,
};
