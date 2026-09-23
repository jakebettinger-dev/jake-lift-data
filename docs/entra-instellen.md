# Microsoft Entra instellen

Eenmalig. Hierna kan de bestandskluis bij je OneDrive, zonder dat je telkens opnieuw hoeft in
te loggen.

Doe dit op een computer, niet op je telefoon — je moet een waarde kopiëren die maar één keer
zichtbaar is.

---

## Wat je aan het eind hebt

Vier waarden. Die komen later in `.env` op de VPS te staan, nooit in deze repo.

| Waarde | Waar vandaan |
|---|---|
| `GRAPH_CLIENT_ID` | stap 3 |
| `GRAPH_CLIENT_SECRET` | stap 5 |
| `GRAPH_REDIRECT_URI` | stap 4, kies je zelf |
| `GRAPH_AUTHORITY` | staat vast: `consumers` — zie hieronder |

---

## Belangrijk vooraf: persoonlijk account

Jouw OneDrive hangt aan een persoonlijk Microsoft-account (outlook.com), niet aan een zakelijke
omgeving. Dat heeft drie gevolgen:

1. **Je hebt geen tenant ID nodig.** Een persoonlijk account heeft geen eigen organisatie. De
   app praat met het adres `https://login.microsoftonline.com/consumers/...`. Kom je ergens een
   instructie tegen die om een *Directory (tenant) ID* vraagt: die is voor zakelijke accounts.
2. **Alleen gedelegeerde rechten werken.** De variant waarbij een app volledig op eigen houtje
   bij bestanden kan (*application permissions*) bestaat niet voor persoonlijke accounts. Je logt
   dus één keer zelf in; de app onthoudt daarna een refresh token en blijft daarmee werken.
3. **Je moet bij het registreren het juiste accounttype kiezen.** Kies je verkeerd, dan kun je
   straks niet inloggen en moet je opnieuw beginnen. Zie stap 2.

---

## Stap 1 — Aanmelden

Ga naar **[portal.azure.com](https://portal.azure.com)** en log in met het Microsoft-account waar
je OneDrive aan hangt. Dus het account met de bestanden.

> **Niet naar entra.microsoft.com.** Dat adres accepteert uitsluitend zakelijke accounts. Log je
> daar in met een outlook.com-adres, dan kom je in een tenant genaamd *Microsoft Services* terecht
> waar je account niet bestaat, en krijg je de melding *"Geselecteerde gebruikersaccount bestaat
> niet in tenant..."*. Via portal.azure.com werkt het wel: Azure maakt bij de eerste keer inloggen
> vanzelf een lege directory voor je persoonlijke account aan. Je hebt hiervoor **geen** Azure-
> abonnement nodig en er wordt niets in rekening gebracht.

Zit je browser nog ingelogd met een werkaccount, open portal.azure.com dan in een **privévenster**.
Anders pakt Azure die sessie en krijg je dezelfde foutmelding.

## Stap 2 — App registreren

Typ boven in de zoekbalk **App registrations** en open dat. (Het staat ook onder
*Microsoft Entra ID* → *App registrations*.) Klik dan op **New registration**.

Vul in:

- **Name:** `Bestandskluis`
- **Supported account types:** kies

  > **Accounts in any organizational directory (Any Microsoft Entra ID tenant – Multitenant) and
  > personal Microsoft accounts (e.g. Skype, Xbox)**

  Dit is de enige optie die persoonlijke accounts toelaat. De standaardkeuze *Single tenant* werkt
  níet voor jouw OneDrive.
- **Redirect URI:** laat leeg, die doen we in stap 4.

Klik **Register**.

## Stap 3 — Client ID overnemen

Je komt op de **Overview**-pagina. Kopieer **Application (client) ID**.

→ dit wordt `GRAPH_CLIENT_ID`

De *Directory (tenant) ID* die er daaronder staat heb je niet nodig.

## Stap 4 — Redirect URI instellen

**Manage** → **Authentication** → **Add a platform** → **Web**.

Vul twee adressen in:

```
http://localhost:3000/auth/callback
https://kluis.jouwdomein.nl/auth/callback
```

De eerste is om de koppeling straks vanaf je eigen computer te leggen, nog voordat er iets op de
VPS draait. Microsoft staat `http://localhost` bewust toe. De tweede is voor later; pas het domein
aan als je een ander adres kiest.

→ het adres dat je gebruikt wordt `GRAPH_REDIRECT_URI`

## Stap 5 — Client secret aanmaken

**Manage** → **Certificates & secrets** → tabblad **Client secrets** → **New client secret**.

- **Description:** `bestandskluis-vps`
- **Expires:** 24 maanden

Klik **Add**. Kopieer nu meteen de kolom **Value** — niet *Secret ID*, maar *Value*. Zodra je
wegklikt is hij niet meer op te vragen en moet je een nieuwe maken.

→ dit wordt `GRAPH_CLIENT_SECRET`

> Zet een herinnering in je agenda een maand voor de vervaldatum. Als het secret verloopt, stopt
> de synchronisatie zonder duidelijke melding.

## Stap 6 — Rechten toekennen

**Manage** → **API permissions** → **Add a permission** → **Microsoft Graph** →
**Delegated permissions**.

Zoek en vink aan:

- `Files.ReadWrite.All` — bestanden lezen en schrijven
- `offline_access` — zonder dit krijg je geen refresh token, en moet je elke keer opnieuw inloggen

Klik **Add permissions**.

Je hoeft hier géén *Grant admin consent* te doen; dat is voor zakelijke omgevingen. Je geeft zelf
toestemming bij de eerste keer inloggen.

---

## Klaar

Je hebt nu drie waarden opgeschreven plus een redirect-URI. Bewaar ze even in je wachtwoordmanager;
ze gaan straks rechtstreeks in `.env` op de VPS.

De eerste koppeling — één keer inloggen zodat de app een refresh token krijgt — is onderdeel van
stap 1 van de bouw. Daar hoef je nu niets voor te doen.

---

## Als er iets misgaat

| Melding | Wat er aan de hand is |
|---|---|
| *"account bestaat niet in tenant Microsoft Services"* (AADSTS50020) | je zit op entra.microsoft.com; ga naar portal.azure.com — zie stap 1 |
| dezelfde melding op portal.azure.com | je browser gebruikt nog een werkaccount; open een privévenster |
| *unauthorized_client* of *AADSTS50194* | bij stap 2 het verkeerde accounttype gekozen; opnieuw registreren |
| geen refresh token terug | `offline_access` vergeten bij stap 6 |
| *redirect_uri_mismatch* | het adres in stap 4 wijkt af van wat de app gebruikt, tot en met de schuine streep |
| *invalid_client* | het secret is verlopen, of *Secret ID* gekopieerd in plaats van *Value* |
