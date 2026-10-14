# Email templates

## launch-email ("Deposits are open")

- `launch-email.html` — table-based, inline-CSS HTML (600px max, dark background, Outlook VML button fallback).
- `launch-email.txt` — plain-text alternative. Send both as multipart.

### Variables

| Variable | Required | Notes |
|---|---|---|
| `{{cta_url}}` | yes | Per-contact link (MiniPay deep link for MiniPay signups, `/app?connect=1` otherwise), with source tag. |
| `{{unsubscribe_url}}` | yes | Per-contact unsubscribe link. |
| `{{first_line}}` | no | Optional personal opener. Replace with an empty string if unused. |

Final copy is in place.
Logo is hosted at `https://nairaguard-vert.vercel.app/icon.png`.
