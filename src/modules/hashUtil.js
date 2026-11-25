export async function formatLoginPassword(password, mode = "auto") {
  const cleanMode = String(mode || "auto").toLowerCase().trim();
  if (!password || cleanMode === "plain" || cleanMode === "raw") {
    return password;
  }

  if (cleanMode === "auto" && /^[a-f0-9]{32}$|^[a-f0-9]{64}$/i.test(password.trim())) {
    return password.trim();
  }

  const algo = cleanMode.startsWith("sha256") ? "SHA-256" : "MD5";
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest(algo, bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return cleanMode.endsWith("upper") ? hex.toUpperCase() : hex;
}
