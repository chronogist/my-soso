# WhatsApp Templates

Wave 1 uses three pre-approved WhatsApp templates for messages that may be sent outside Meta's 24-hour customer-service window.

## Template Names

| Code name | Meta template name | Used by |
| --- | --- | --- |
| Digest | `digest` | Scheduled daily and weekly digests |
| Alert | `alert` | Price and news alert deliveries |
| Link confirmation | `link_confirmation` | Link success, invalid code, conflict, and unlinked prompts |

## Suggested Copy

### `digest`

Category: Utility

Body:

```text
Your My-Soso digest is ready. Open this chat to see the latest watchlist summary.
```

### `alert`

Category: Utility

Body:

```text
My-Soso found an alert update for your watchlist. Open this chat to view the details.
```

### `link_confirmation`

Category: Utility

Body:

```text
My-Soso has an account linking update for this WhatsApp chat. Open this chat to continue.
```

## Implementation Notes

- Runtime template names are validated by `WhatsAppTemplateNameSchema` in `@my-soso/queue`.
- The Worker attaches `digest` for WhatsApp digest jobs and `alert` for WhatsApp alert jobs.
- The Edge WhatsApp link flow attaches `link_confirmation` for link-related replies.
- Free-form text still goes through the normal 24-hour session message path.
