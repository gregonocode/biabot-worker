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

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
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
    console.error('Erro Evolution:', {
      status: response.status,
      path,
      data,
    });

    throw new Error(`Erro Evolution API: ${response.status}`);
  }

  return data as T;
}