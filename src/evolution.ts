type EvolutionRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
};

export async function evolutionFetch<T>(
  path: string,
  options: EvolutionRequestOptions = {},
): Promise<T> {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;

  if (!baseUrl) {
    throw new Error('EVOLUTION_API_URL não configurada.');
  }

  if (!apiKey) {
    throw new Error('EVOLUTION_API_KEY não configurada.');
  }

  const url = `${baseUrl.replace(/\/$/, '')}${path}`;

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();

  let data: unknown = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    console.error('Erro Evolution API:', {
      status: response.status,
      path,
      url,
      data,
    });

    const message =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: unknown }).message)
        : typeof data === 'string'
          ? data
          : `Erro na Evolution API: ${response.status}`;

    throw new Error(message);
  }

  return data as T;
}

export async function sendTextMessage(params: {
  instanceName: string;
  number: string;
  text: string;
}) {
  return evolutionFetch(`/message/sendText/${params.instanceName}`, {
    method: 'POST',
    body: {
      number: params.number,
      text: params.text,
    },
  });
}

export async function sendMediaMessage(params: {
  instanceName: string;
  number: string;
  mediatype: 'image' | 'video' | 'document';
  media: string;
  mimetype?: string | null;
  fileName?: string | null;
  caption?: string | null;
}) {
  return evolutionFetch(`/message/sendMedia/${params.instanceName}`, {
    method: 'POST',
    body: {
      number: params.number,
      mediatype: params.mediatype,
      media: params.media,
      mimetype: params.mimetype ?? undefined,
      fileName: params.fileName ?? undefined,
      caption: params.caption ?? undefined,
    },
  });
}

export async function sendAudioMessage(params: {
  instanceName: string;
  number: string;
  audio: string;
}) {
  return evolutionFetch(`/message/sendWhatsAppAudio/${params.instanceName}`, {
    method: 'POST',
    body: {
      number: params.number,
      audio: params.audio,
    },
  });
}
