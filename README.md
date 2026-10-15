# FRAME / Still & Motion

A camera-inspired archive of photography, films and festival records. Built with HTML, CSS and native JavaScript, with no build step or external runtime dependencies.

Live site: <https://kevin43420.github.io/frame-photography/>.

## The experience

- Turn the viewfinder dial between stills and motion. Film previews loop silently; the full player opens on request.
- Browse 15 coherent visual series across six photographic disciplines. Each series preserves a consistent tone, setting and visual rhythm; navigation and auto-browse remain within the selected series.
- 73 photographs are displayed from 74 source files. A second, more heavily compressed export of one boxing photograph is excluded from the display.
- Adjust photographic exposure, toggle the composition grid and hold the shutter to focus before saving. A personal roll stores up to 12 photographs or film versions in the current browser.
- Five motion works offer five selected sequences: three new 20-second, ten-shot nonlinear montages and two original 8-second animated fashion collages. The new film edits use hard cuts across widely separated moments, including original titles and available ending cards; complete narrative excerpts are no longer offered in the interface. Large original films are not uploaded.
- Motion respects the system's reduced-motion preference and can be paused manually.
- All interface copy, photograph titles and collection labels are in English.

## Files and local use

Download the repository and open `index.html`. Keep `styles.css`, `app.js`, `archive-data.js`, `样片/` and `media/` at their existing relative paths. No dependency installation or build is required.

`archive-data.js` contains the photographic taxonomy, motion versions and verified festival records. Full photographs remain under `样片/`; optimized thumbnails, videos, original laurel crops, posters and film stills are under `media/`.

GitHub Pages publishes directly from the root of the `main` branch. `.nojekyll` preserves direct static-file delivery.

## Festival records

The supplied original laurels and the festival poster establish five distinct records for **150,000 SHOTS**, a documentary by **Xiaobo He**:

- WorldFest-Houston: REMI WINNER, 2025.
- Robinson Film Awards: SEMI-FINALIST, 2024.
- London Director Awards: NOMINEE, 2025.
- Toronto International Nollywood Film Festival: WINNER, 2025.
- Boden International Film Festival: FINALIST; no year is shown on the supplied mark.

The black and white TINFF files are variants of the same record. No award category, Remi level or missing year is inferred. Private contact details in the source festival application are not published.

**150,000 SHOTS** retains its supplied English title and credit. **We Still Have Fish Here** retains its onscreen English title. **Haiyue Garden** is an English rendering of the supplied Chinese title. The two untitled fashion clips use descriptive display names.

## V3 refinement

The overlaid sky caption on **Statues and Cranes** is removed in a separate display asset; the original photograph is retained. Player and preview versions of each film montage share the same cuts. Fashion pieces retain their existing source animation, with no additional cuts claimed. All montage sound comes from the source films; no music is added.

The ending credits in **We Still Have Fish Here** are presented in English in both player and preview versions: “Cinematography, Editing & Direction / Xiaobo He / Thank You for Watching”. The translated card holds for two seconds within the existing 20-second montage; the original audio is retained.
