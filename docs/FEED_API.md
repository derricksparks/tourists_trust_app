# Tour feed API (v1)

For tour operators who keep their tours in their own system and want them on the platform without
retyping. Each tour is identified by **your own reference** (`external_ref`), so sending a tour again
updates it instead of creating a copy. Tours added this way appear in the partner portal like any
other, and follow the same rules.

- Base URL: `https://partners.example.org/api/feed/v1` (your partner portal's address + `/api/feed/v1`)
- Authentication: `Authorization: Bearer ttp_live_…`. Create the key in the partner portal under
  **Integrations**. It is shown only once, and you can revoke it there at any time.
- Format: JSON, UTF-8.
- Limit: 120 requests a minute per key. Above that you get `429`.

There is no payment or booking in this API. Prices are indicative, shown to travellers and travel
companies, who confirm the price with you.

## Create or update a tour

```
PUT /packages/{external_ref}
```

`external_ref`: letters, digits and `. _ : -`, up to 100 characters (e.g. `GOR-4D`).

```json
{
  "title": "Gorilla trek 4 days",
  "titleRu": "Трекинг к гориллам, 4 дня",
  "descriptionRu": "Встреча в Энтеббе, трекинг в Бвинди с рейнджерами.",
  "descriptionEn": "Meet in Entebbe, trek in Bwindi with rangers.",
  "countryCode": "UG",
  "durationDays": 4,
  "price": 2450,
  "currency": "USD",
  "priceBasis": "PER_PERSON",
  "capacity": 6,
  "inclusions": ["gorilla permit", "transport", "lodges"],
  "exclusions": ["flights", "visa"],
  "dates": [{ "startDate": "2027-02-10", "endDate": "2027-02-13", "capacity": 4 }],
  "published": true
}
```

| Field | Required | Notes |
|---|---|---|
| `title` | yes | 3–150 characters |
| `countryCode` | yes | a country we list operators in (e.g. `UG`, `TZ`, `KE`, `RW`) |
| `durationDays` | yes | 1–60 |
| `titleRu`, `descriptionRu`, `descriptionEn` | no | `descriptionRu` is required to publish |
| `price`, `currency`, `priceBasis` | no | `PER_PERSON` (default) or `PER_GROUP`; currency `USD`, `EUR`, … |
| `capacity` | no | default maximum group size |
| `inclusions`, `exclusions` | no | up to 30 short texts each |
| `dates` | no | replaces all dates of the tour; past dates are kept but not shown |
| `published` | no | `true` to make the tour live. This only works once your application is approved and the tour has a Russian description; otherwise it is saved as a draft and `warnings` says why. |

The whole tour is replaced: a field you leave out is cleared or reset to its default.

Response `200`:

```json
{
  "action": "create",
  "warnings": [],
  "package": { "externalRef": "GOR-4D", "slug": "gorilla-trek-4-days-pearl-gorilla", "status": "PUBLISHED",
               "publicUrl": "https://example.org/tours/gorilla-trek-4-days-pearl-gorilla", "...": "…" }
}
```

`action` is `create` or `update`. Sending the same body twice changes nothing.

## Read

```
GET /packages               → { "items": [ …all your tours… ] }
GET /packages/{external_ref} → one tour, same shape as "package" above
```

## Take a tour off sale

```
DELETE /packages/{external_ref}
```

This archives the tour. It disappears from the site and from travel companies' catalogue, but quote
history stays. To bring it back, `PUT` it again.

## Errors

| Status | Meaning |
|---|---|
| `400` | the body or reference is invalid; `errors` lists each field |
| `401` | missing, unknown or revoked key |
| `403` | your listing is suspended or rejected, so the feed is paused |
| `404` | no tour with that reference |
| `429` | over 120 requests a minute |

## Example

```bash
curl -X PUT https://partners.example.org/api/feed/v1/packages/GOR-4D \
  -H "Authorization: Bearer $TTP_KEY" -H "Content-Type: application/json" \
  -d '{"title":"Gorilla trek 4 days","countryCode":"UG","durationDays":4,"descriptionRu":"…","published":true}'
```

In development, the seed creates the key `ttp_demo_0000000000000000000000000000000000000000` for
"Pearl Gorilla Treks (demo)". Use it against `http://localhost:3000/feed/v1`.

## Spreadsheet import

The same rules apply to the CSV import in the portal (**Integrations → Spreadsheet import**). The
column names are listed in the downloadable template. Lists inside a cell (inclusions, dates) are
separated by `|`, and date ranges are written `2027-02-10/2027-02-13`. The portal checks the whole
file first, and imports only when every row is valid.
