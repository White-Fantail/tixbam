# Admin editing and regional date/time entry

The admin dashboard's **Artists**, **Concerts & fan meetings**, and **Ticket sales** sections now each provide **Edit** on existing rows. Choosing **+ New** switches the form back to creation. All three editor forms are authenticated server actions backed by API `PUT` endpoints.

## What time to enter

- **Events**: enter the published *venue's wall clock* in the date/time picker. Choose the event city, country code, and **IANA time zone** (for example, Hong Kong uses `Asia/Hong_Kong`). Leave date/time blank for TBA.
- **Ticket sales**: enter the on-sale *reference region's wall clock*. Its city, country and time zone initially come from the selected event but can be overridden independently. This matters when a fanclub presale is advertised in Korea time for an event in Hong Kong.
- The form suggests a zone for common cities and countries. The list includes other IANA zones; check the suggested region, especially in multi-zone countries. Location is not automatically geocoded.
- The directory shows the event/sale location's time with the IANA zone and also **Your local**, calculated in the admin's browser time zone. A timezone-less legacy record is marked as inferred or UTC until confirmed in the edit form.

For example, enter **15 January 2027, 20:00** with `Asia/Hong_Kong`. The API stores **2027-01-15T12:00:00Z**. A viewer in Auckland during January sees **16 January 2027, 01:00** locally.

## Validation and storage

The API accepts `starts_at_local` or `sale_at_local` together with `timezone`. It resolves the IANA zone on the **server**, converts the wall-clock time to UTC, and rejects local timestamps that fall in a daylight-saving gap or repeated hour. Invalid/missing time zones return HTTP 422. Clients using `starts_at` / `sale_at` directly must supply an explicit UTC offset; old API contract fields and UTC timestamps remain in public responses. Creating or editing TBA records does not require a date.

Updates use `PUT /v1/admin/artists/{id}`, `PUT /v1/admin/events/{id}`, and `PUT /v1/admin/sales/{id}`. The new optional event `timezone` and ticket-sale `city`, `country`, `timezone` columns are added at API startup using an additive migration. Existing timestamps and associated sales are preserved; missing timezone metadata remains NULL rather than being silently backfilled. Migrating an existing production database should be done with a recent backup and the API deployed before the admin app.

## Limitations

Location suggestions cover common ticketing markets, not every city. They are editable selections and must be checked before saving. For pre-existing UTC records, zone inference is only a display fallback; verify against the official event listing, especially where older entries had no venue time zone. The admin directory currently loads up to **500 events**, consistent with the API's public per-request limit.
