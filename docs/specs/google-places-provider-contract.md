# Google Places provider contract

FullCircle's Google Places provider gives e2e tests deterministic fixtures for Google Places API calls used by location creation flows, plus a safe browser sink for the Google Maps JavaScript API.

## Scope

- Text Search (New): `POST https://places.googleapis.com/v1/places:searchText`.
- Place Details (New): `GET https://places.googleapis.com/v1/places/{place_id}`.
- Browser Maps script: `GET https://places.googleapis.com/maps/api/js`.

The provider intentionally models the Places API (New) JSON surface. Google requires callers to send a field mask for Text Search and Details; the provider can assert the `X-Goog-FieldMask` header so test fixtures stay close to production billing and latency best practices.

References:

- Google Places Text Search (New): https://developers.google.com/maps/documentation/places/web-service/text-search
- Google Places field masks: https://developers.google.com/maps/documentation/places/web-service/choose-fields
- Google Places Details (New): https://developers.google.com/maps/documentation/places/web-service/place-details

## API

```ts
import {fullcircle, googlePlacesProvider} from '@fullcircle/harness';

await using fc = await fullcircle({listenAddress: null, defaultDestination: 'places.googleapis.com'});
await using harness = fc.harness('places.googleapis.com');

const places = googlePlacesProvider(harness);

places.searchText({
  match: {
    textQuery: /Soundspace/i,
    includedType: 'music_school',
    fieldMask: 'places.id,places.displayName,places.formattedAddress',
  },
  reply: [
    {
      id: 'places/soundspace-hq',
      displayName: {text: 'Soundspace HQ'},
      formattedAddress: '1 Music Way, Nashville, TN',
    },
  ],
});

places.details({
  match: {
    name: 'places/soundspace-hq',
    fieldMask: /displayName/,
  },
  reply: {
    id: 'places/soundspace-hq',
    displayName: {text: 'Soundspace HQ'},
  },
});

places.mapsJavaScript({body: 'window.google={maps:{}};'});
```

## Fixture shapes

### `searchText`

- Route: `POST /v1/places:searchText`.
- Matchers:
  - `textQuery`: string, `RegExp`, or predicate.
  - `includedType`: string, `RegExp`, or predicate.
  - `fieldMask`: string, `RegExp`, or predicate matched against `X-Goog-FieldMask`.
- Success response: `{ places: reply }`.
- Empty response: `{ places: [] }`.
- Error response: supplied Google-style error object and status.

### `details`

- Route: `GET /v1/places/{place_id}`.
- Matchers:
  - `name`: full resource name such as `places/soundspace-hq`.
  - `fieldMask`: matched against `X-Goog-FieldMask`.
- Success response: supplied place object.
- Error response: supplied Google-style error object and status.

### `mapsJavaScript`

- Route: `GET /maps/api/js`.
- Returns deterministic JavaScript so browser flows can load a Maps script without calling Google.
- Use this for script-loading flows only. Interactions with Places data should be asserted through `searchText` or `details` fixtures.

## Estimated fixtures

- `places.searchText.single.json` — one matching place with stable id, display name, and address.
- `places.searchText.empty.json` — no places found.
- `places.searchText.error.json` — quota/auth failure from Google.
- `places.details.basic.json` — details for a selected location.
- `maps.javascript.stub.js` — deterministic browser script stub.

## E2E guidance

1. Add a FullCircle seam at the app's Google Places client boundary.
2. Fixture location search results with `searchText` instead of hitting Google during CI.
3. Assert field masks so tests catch accidental expansion to expensive fields.
4. Use `mapsJavaScript` only to unblock browser code that requires `window.google.maps`.
5. Keep real Google Places API smoke tests optional and separately gated behind sandbox credentials.
