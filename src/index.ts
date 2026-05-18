import { processarEnvios } from './processar-envios';

const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 30000);

let running = false;

async function tick() {
  console.log('Rodando ciclo do worker...', new Date().toISOString());

  if (running) {
    console.log('Worker ainda processando, pulando ciclo...');
    return;
  }

  try {
    running = true;
    await processarEnvios();
  } catch (error) {
    console.error('Erro geral no worker:', error);
  } finally {
    running = false;
  }
}

console.log('BiaBot Worker iniciado.');
console.log(`Intervalo: ${intervalMs}ms`);
console.log('Supabase configurado:', Boolean(process.env.SUPABASE_URL));
console.log('Evolution configurada:', Boolean(process.env.EVOLUTION_API_URL));

void tick();

setInterval(() => {
  void tick();
}, intervalMs);
