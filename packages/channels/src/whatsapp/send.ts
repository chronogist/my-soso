const GRAPH_API = 'https://graph.facebook.com/v23.0';

export async function sendWhatsAppMessage(opts: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  text: string;
  templateName?: string;
}): Promise<{ ok: true } | { ok: false; description: string }> {
  const body = opts.templateName
    ? {
        messaging_product: 'whatsapp',
        to: opts.to,
        type: 'template',
        template: {
          name: opts.templateName,
          language: { code: 'en_US' },
        },
      }
    : {
        messaging_product: 'whatsapp',
        to: opts.to,
        type: 'text',
        text: {
          body: opts.text,
          preview_url: false,
        },
      };

  const res = await fetch(`${GRAPH_API}/${opts.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return { ok: false, description: await res.text() };
  }

  return { ok: true };
}
