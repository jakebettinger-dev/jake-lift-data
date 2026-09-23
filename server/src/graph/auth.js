import { SCOPES } from "../config.js";

/** Als het refresh token niet meer werkt, moet je één keer opnieuw koppelen. */
export class KoppelingVerlopen extends Error {
  constructor(reden) {
    super(
      `De koppeling met OneDrive is niet meer geldig (${reden}).\n` +
        `Draai 'npm run koppelen' om opnieuw in te loggen.`,
    );
    this.name = "KoppelingVerlopen";
  }
}

const nuSec = () => Math.floor(Date.now() / 1000);

/**
 * Beheert de koppeling met Microsoft.
 *
 * Persoonlijke accounts kennen geen 'application permissions': de app kan niet
 * zelfstandig bij de bestanden. Je logt één keer in, en daarna draait alles op
 * een refresh token dat hier wordt bewaard en telkens ververst.
 */
export class Koppeling {
  #db;
  #config;
  #fetch;
  #nu;

  constructor(db, config, { fetchImpl = fetch, nu = nuSec } = {}) {
    this.#db = db;
    this.#config = config;
    this.#fetch = fetchImpl;
    this.#nu = nu;
  }

  /** De URL waar je één keer naartoe moet om toestemming te geven. */
  autorisatieUrl(state = "") {
    const p = new URLSearchParams({
      client_id: this.#config.clientId,
      response_type: "code",
      redirect_uri: this.#config.redirectUri,
      response_mode: "query",
      scope: SCOPES.join(" "),
      state,
    });
    return `${this.#config.authorizeUrl}?${p}`;
  }

  /** Wisselt de code uit de callback om voor tokens en bewaart die. */
  async wisselCode(code) {
    const tokens = await this.#vraagTokens({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.#config.redirectUri,
    });
    this.#bewaar(tokens);
    return tokens;
  }

  /**
   * Geeft een geldig access token. Ververst automatisch als het bijna verloopt.
   * Met forceer=true wordt sowieso ververst (na een 401).
   */
  async accessToken(forceer = false) {
    const rij = this.#rij();
    if (!rij) throw new KoppelingVerlopen("er is nog niet gekoppeld");

    const marge = 120; // ruim voor het verloopt vernieuwen
    if (!forceer && rij.access_token && rij.verloopt && rij.verloopt - marge > this.#nu()) {
      return rij.access_token;
    }

    const tokens = await this.#vraagTokens({
      grant_type: "refresh_token",
      refresh_token: rij.refresh_token,
    });
    this.#bewaar(tokens, rij.refresh_token);
    return tokens.access_token;
  }

  status() {
    const rij = this.#rij();
    if (!rij) return { gekoppeld: false };
    return {
      gekoppeld: true,
      account: rij.account,
      verloopt: rij.verloopt,
      geldig: rij.verloopt ? rij.verloopt > this.#nu() : false,
    };
  }

  /** Slaat op bij welk account is gekoppeld, puur ter herkenning. */
  zetAccount(account) {
    this.#db.prepare("UPDATE koppeling SET account = ? WHERE id = 1").run(account);
  }

  ontkoppel() {
    this.#db.prepare("DELETE FROM koppeling").run();
  }

  #rij() {
    return this.#db.prepare("SELECT * FROM koppeling WHERE id = 1").get();
  }

  async #vraagTokens(extra) {
    const body = new URLSearchParams({
      client_id: this.#config.clientId,
      client_secret: this.#config.clientSecret,
      scope: SCOPES.join(" "),
      ...extra,
    });

    const res = await this.#fetch(this.#config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const code = json.error ?? String(res.status);
      // invalid_grant = wachtwoord gewijzigd, toestemming ingetrokken, of te lang niet gebruikt.
      if (code === "invalid_grant") throw new KoppelingVerlopen(code);
      throw new Error(
        `Inloggen bij Microsoft mislukt (${code}): ${json.error_description ?? res.statusText}`,
      );
    }
    return json;
  }

  /**
   * Microsoft geeft soms een nieuw refresh token mee en soms niet. Bij het
   * ontbreken ervan houden we het oude, anders verliezen we de koppeling.
   */
  #bewaar(tokens, vorigRefresh = null) {
    const refresh = tokens.refresh_token ?? vorigRefresh;
    if (!refresh) throw new Error("Microsoft gaf geen refresh token terug.");
    const verloopt = this.#nu() + Number(tokens.expires_in ?? 3600);

    this.#db
      .prepare(
        `INSERT INTO koppeling (id, refresh_token, access_token, verloopt, bijgewerkt)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           refresh_token = excluded.refresh_token,
           access_token  = excluded.access_token,
           verloopt      = excluded.verloopt,
           bijgewerkt    = excluded.bijgewerkt`,
      )
      .run(refresh, tokens.access_token ?? null, verloopt, this.#nu());
  }
}
