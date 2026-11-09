# API platform review

Home, Models, model detail, Dashboard (keys, usage/CSV, credits, deployments and settings), Search and owner supply console use the AI platform APIs in the companion PR. Arena reads and writes use the authenticated Exchange bridge and Report hosts the page. Arena and supply navigation use permanent redirects.

The Chat compare move (Chat #419 / Exchange #136) is not merged. Persona and private-chat migration and their redirects must follow it; they are not implemented here. These changes should remain in review until that dependency and the library releases are coordinated. No production changes or provider purchases were performed.

## Screenshots

The 16 images in `screenshots/` exercise home, Models, model detail and Dashboard Keys at 390 and 1280 pixels in light and dark themes. They use local fake catalogue/account data, not production measurements. `checks.json` records the actual painted mode, document width and browser errors. No horizontal overflow or uncaught page errors were observed. Shared Network theme/frame requests report localhost CORS failures (and some unavailable remote resources); these screenshots are layout checks, not evidence of live cross-service integration.

## Validation

`node --check` on changed JavaScript; `ov test` full suite once, followed by focused fixes for intended redirects, Arena fragments, legacy pools and Dashboard CSV escaping. Final focused Arena and Dashboard tests pass. API keys, search and supply backend validation is recorded in the AI PR.
