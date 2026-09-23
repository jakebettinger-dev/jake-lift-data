import { resolve } from "node:path";

// Persoonlijke Microsoft-accounts hebben geen tenant; de authority is altijd 'consumers'.
// Zie docs/entra-instellen.md voor waarom.
const AUTHORITY = "https://login.microsoftonline.com/consumers";

export const SCOPES = ["Files.ReadWrite.All", "offline_access"];

export function leesConfig(env = process.env) {
  const dataMap = resolve(env.DATA_MAP ?? "./data");
  return {
    clientId: env.GRAPH_CLIENT_ID ?? "",
    clientSecret: env.GRAPH_CLIENT_SECRET ?? "",
    redirectUri: env.GRAPH_REDIRECT_URI ?? "http://localhost:3000/auth/callback",
    authorizeUrl: `${AUTHORITY}/oauth2/v2.0/authorize`,
    tokenUrl: `${AUTHORITY}/oauth2/v2.0/token`,
    graphBasis: env.GRAPH_BASIS ?? "https://graph.microsoft.com/v1.0",
    dataMap,
    dbPad: resolve(dataMap, "kluis.db"),
    poort: Number(env.POORT ?? 3000),
    ruimtes: [
      { naam: "werk", pad: env.RUIMTE_WERK ?? "Bestandskluis/Werk" },
      { naam: "prive", pad: env.RUIMTE_PRIVE ?? "Bestandskluis/Prive" },
    ],
  };
}

/**
 * Controleert bij het opstarten of alles er is, met een bruikbare foutmelding
 * in plaats van een crash halverwege.
 */
export function controleerConfig(config) {
  const ontbreekt = [];
  if (!config.clientId) ontbreekt.push("GRAPH_CLIENT_ID");
  if (!config.clientSecret) ontbreekt.push("GRAPH_CLIENT_SECRET");
  if (!config.redirectUri) ontbreekt.push("GRAPH_REDIRECT_URI");

  if (ontbreekt.length) {
    throw new Error(
      `Deze instellingen ontbreken: ${ontbreekt.join(", ")}.\n` +
        `Kopieer .env.example naar .env en vul ze in. ` +
        `Hoe je aan de waarden komt staat in docs/entra-instellen.md.`,
    );
  }
  if (!config.redirectUri.includes("/auth/callback")) {
    throw new Error(
      `GRAPH_REDIRECT_URI moet eindigen op /auth/callback, nu: ${config.redirectUri}`,
    );
  }
}
