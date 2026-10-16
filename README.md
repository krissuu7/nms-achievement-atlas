# No Man's Sky Achievement Atlas

Interaktywny, polskojęzyczny tracker 27 osiągnięć Steam do *No Man's Sky*. Zawiera kosmiczne tło, animowane orbity, interfejs Liquid Glass, panel ukończonych osiągnięć, notatki, wyszukiwarkę i eksport/import postępu. Strona jest przygotowana także jako PWA do dodania do ekranu początkowego iPhone'a.

## Automatyczne publikowanie na GitHub Pages

Repozytorium docelowe: https://github.com/krissuu7/nms-achievement-atlas

Workflow w `.github/workflows/pages.yml` publikuje zawartość repozytorium po każdym pushu do `main`. Jeżeli GitHub Pages nie zostało jeszcze włączone, najpierw ustaw **Settings → Pages → Build and deployment → Source → GitHub Actions**.

Po wgraniu plików:
1. Otwórz repozytorium → **Actions** i sprawdź przebieg `Deploy Achievement Atlas to GitHub Pages`.
2. Po sukcesie strona będzie dostępna pod adresem https://krissuu7.github.io/nms-achievement-atlas/.
3. Jeśli GitHub poprosi o wybór źródła publikacji, przejdź do **Settings → Pages → Build and deployment → Source** i wybierz **GitHub Actions**.

## Dodanie jako aplikacji na iPhonie

1. Otwórz https://krissuu7.github.io/nms-achievement-atlas/ w Safari.
2. Wybierz **Udostępnij → Dodaj do ekranu początkowego**.
3. Włącz **Otwórz jako aplikację internetową** i dodaj ikonę.

## Dane i tryb offline

Postęp i notatki są zapisywane lokalnie w przeglądarce/aplikacji. Zrób eksport JSON przed zmianą przeglądarki lub urządzenia. Service worker cache'uje pliki aplikacji i ikony Steam po ich pobraniu; pierwsze ładowanie zewnętrznych ikon wymaga internetu.

## Pliki

- `index.html` — aplikacja ze wszystkimi 27 osiągnięciami.
- `manifest.webmanifest` — metadane PWA.
- `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` — ikony aplikacji.
- `service-worker.js` — cache offline.
- `.github/workflows/pages.yml` — automatyczne wdrożenie na GitHub Pages.
