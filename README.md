# Beat Vault — istwiesis

Beats von istwiesis zum Anhören, live auf **[istwiesis.com](https://istwiesis.com)**.

## Lokal starten

`start.bat` doppelklicken (oder `python tools/serve.py`) und die angezeigte Adresse im Browser öffnen.

## Neue Beats hinzufügen

1. WAV/MP3 in `Desktop/best` legen (BPM im Namen, z. B. `140darkbums.wav`).
2. `python -I tools/build_beats.py` ausführen – erzeugt MP3s in `audio/` und aktualisiert `js/beats.js`.
3. Committen und pushen – GitHub Pages veröffentlicht automatisch.

WAV-Dateien werden nicht hochgeladen (siehe `.gitignore`).
