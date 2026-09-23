# Bestandskluis

Eigen bestandsopslag op een Strato VPS, met persoonlijke OneDrive als bewaarplaats.
Bedoeld als snellere vervanger van OneDrive voor dagelijks gebruik: bladeren, uploaden,
foto's en video's opnemen vanaf de telefoon, en bestanden delen via een link.

Werk en privé zijn gescheiden ruimtes binnen dezelfde app.

## Status

Nog niets gebouwd. Eerst wordt de opdracht vastgelegd.

## prompt-generator/

Een enkele HTML-pagina waarmee de bouwopdracht wordt samengesteld: 40 keuzes,
verdeeld over acht groepen, die samen een complete prompt opleveren.

Openen kan door `prompt-generator/index.html` in een browser te slepen — er is geen
server, build of installatie nodig.

## Uitgangspunt

Het doel is snelheid. Een mapweergave mag nooit op Microsoft wachten: alle bestandsnamen,
mappen, groottes en datums staan in een eigen index op de VPS, en de Graph API wordt alleen
aangesproken om die index bij te werken en om de bytes op te halen van een bestand dat
daadwerkelijk geopend wordt. Wordt dat losgelaten, dan wordt de app even traag als OneDrive nu is.

## Opslag

Bestanden horen in OneDrive, niet in deze repo. Hier staat alleen code.
