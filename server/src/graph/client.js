/** Fout van de Graph API, met genoeg context om te kunnen zien wat er mis is. */
export class GraphFout extends Error {
  constructor(status, code, bericht, url) {
    super(`Graph ${status}${code ? ` (${code})` : ""}: ${bericht}`);
    this.name = "GraphFout";
    this.status = status;
    this.code = code;
    this.url = url;
  }
  /** 410 betekent: je deltaLink is verlopen, lees de ruimte opnieuw in. */
  get vraagtOmVolledigeSync() {
    return this.status === 410 || this.code === "resyncRequired";
  }
}

const slaap = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Dunne laag om fetch heen die drie dingen regelt:
 *  - het token erbij zetten, en één keer vernieuwen bij een 401
 *  - wachten en opnieuw proberen bij 429 (Microsoft knijpt af) en bij 5xx
 *  - nooit meer dan een paar verzoeken tegelijk
 */
export class GraphClient {
  #haalToken;
  #fetch;
  #wacht;
  #maxPogingen;

  constructor({ basis, haalToken, fetchImpl = fetch, wacht = slaap, maxPogingen = 5 }) {
    this.basis = basis;
    this.#haalToken = haalToken;
    this.#fetch = fetchImpl;
    this.#wacht = wacht;
    this.#maxPogingen = maxPogingen;
  }

  async get(padOfUrl) {
    return this.#verzoek("GET", padOfUrl);
  }

  async #verzoek(methode, padOfUrl) {
    const url = padOfUrl.startsWith("http") ? padOfUrl : this.basis + padOfUrl;
    let tokenVernieuwd = false;

    for (let poging = 1; poging <= this.#maxPogingen; poging++) {
      const token = await this.#haalToken();
      const res = await this.#fetch(url, {
        method: methode,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });

      if (res.status === 401 && !tokenVernieuwd) {
        // Token net verlopen: één keer vernieuwen en opnieuw proberen.
        tokenVernieuwd = true;
        await this.#haalToken(true);
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        if (poging === this.#maxPogingen) {
          throw new GraphFout(res.status, null, "blijft mislukken na meerdere pogingen", url);
        }
        const naHeader = Number(res.headers?.get?.("Retry-After"));
        const wachttijd = Number.isFinite(naHeader) && naHeader > 0
          ? naHeader * 1000
          : Math.min(2 ** poging * 500, 30_000);
        await this.#wacht(wachttijd);
        continue;
      }

      if (!res.ok) {
        let code = null;
        let bericht = res.statusText;
        try {
          const body = await res.json();
          code = body?.error?.code ?? null;
          bericht = body?.error?.message ?? bericht;
        } catch {
          // geen json-body; statusText is dan het beste wat we hebben
        }
        throw new GraphFout(res.status, code, bericht, url);
      }

      return res.json();
    }
  }
}

/** Zet een pad als 'Bestandskluis/Werk' om naar iets dat in een Graph-URL mag. */
export function codeerPad(pad) {
  return pad
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}
