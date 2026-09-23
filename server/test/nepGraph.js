/**
 * Een nagemaakte Graph API, zodat de synchronisatie te testen is zonder
 * Microsoft-account en zonder netwerk.
 */
export class NepGraph {
  constructor() {
    this.antwoorden = new Map(); // url -> antwoord of rij antwoorden
    this.verzoeken = [];
  }

  /** antwoord mag een object zijn, of een rij die bij elke aanroep opschuift. */
  zet(url, antwoord) {
    this.antwoorden.set(url, antwoord);
    return this;
  }

  get fetch() {
    return async (url) => {
      this.verzoeken.push(url);
      let a = this.antwoorden.get(url);
      if (a === undefined) return maakAntwoord(404, { error: { code: "itemNotFound", message: `geen nep-antwoord voor ${url}` } });
      if (Array.isArray(a)) {
        a = a.length > 1 ? a.shift() : a[0];
      }
      if (typeof a === "function") a = a();
      if (a.status) return maakAntwoord(a.status, a.body, a.headers);
      return maakAntwoord(200, a);
    };
  }
}

function maakAntwoord(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (naam) => headers[naam] ?? headers[naam.toLowerCase()] ?? null },
    json: async () => body,
  };
}

/** Bouwt een item zoals de Graph API het teruggeeft. */
export function nepItem({ id, naam, ouderPad, ouderId, map = false, grootte = 0, hash = null, gewijzigd = "2026-09-01T10:00:00Z" }) {
  const item = {
    id,
    name: naam,
    size: grootte,
    lastModifiedDateTime: gewijzigd,
    createdDateTime: "2026-08-01T09:00:00Z",
    parentReference: { path: `/drive/root:${ouderPad}`, id: ouderId },
  };
  if (map) item.folder = { childCount: 0 };
  else item.file = { mimeType: "application/pdf", hashes: hash ? { sha256Hash: hash } : {} };
  return item;
}

export const nepVerwijderd = (id) => ({ id, deleted: { state: "deleted" } });
