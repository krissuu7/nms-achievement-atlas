# No Man's Sky — Achievement Atlas

Interaktywny, polskojęzyczny tracker osiągnięć (27) dla gry No Man's Sky.

Aplikacja działa jako statyczna strona PWA (Progressive Web App) — z kosmicznym tłem, animowanymi orbitami, interfejsem "Liquid Glass", panelem ukończonych osiągnięć, miejscem na notatki i wyszukiwarką.

Live demo

- Strona (jeśli Pages jest włączone): https://krissuu7.github.io/nms-achievement-atlas/

Funkcje

- Pełna lista 27 osiągnięć ze statusem ukończenia.
- Lokalny zapis postępu i notatek w przeglądarce.
- Eksport / import postępu w formacie JSON.
- Działa offline dzięki service workerowi.
- Możliwość dodania jako aplikacja na ekranie głównym (iPhone/Android).

Szybkie uruchomienie

1. Otwórz `index.html` lokalnie w przeglądarce lub odwiedź stronę opublikowaną na GitHub Pages.
2. (Opcjonalnie) Dodaj jako aplikację na telefonie: Udostępnij → "Dodaj do ekranu początkowego" (Safari/Chrome).

Dane i prywatność

- Wszystkie dane (postęp, notatki) przechowywane są lokalnie w przeglądarce użytkownika — nie wysyłamy danych do zewnętrznych serwisów.
- Przed zmianą urządzenia lub wyczyszczeniem pamięci przeglądarki wykonaj eksport JSON.

Publikacja (GitHub Pages)

- W repo jest workflow `.github/workflows/pages.yml`, który publikuje zawartość repo przy pushu do `main`.
- Jeśli GitHub Pages nie jest włączone, w ustawieniach repo przejdź do: Settings → Pages → Build and deployment → Source → GitHub Actions.
- Uwaga: obecny workflow wysyła całe repo (`path: '.'`). Rozważ najpierw dodanie kroku build i wysyłanie tylko katalogu z wygenerowaną stroną (np. `public/` lub `dist/`).

Pliki w repozytorium

- `index.html` — główna aplikacja.
- `manifest.webmanifest` — metadane PWA.
- `service-worker.js` — obsługa offline.
- `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` — ikony aplikacji.
- `.github/workflows/pages.yml` — automatyczne wdrożenie na GitHub Pages.

Chcesz, żebym:
- zmienił workflow, żeby automatycznie włączał Pages (enablement: true) i/lub uploadował tylko katalog wynikowy?
- dodał sekcję "Contributing" i szablony issue/pr?
- dodał plik LICENSE (np. MIT)?

Autor

krissuu7 — https://github.com/krissuu7
